/**
 * Worker de Scraping — Sincronização automática de processos
 *
 * Responsável por:
 * - Buscar processos que precisam de atualização
 * - Consultar o DataJud e futuramente scrapers de tribunal
 * - Detectar novas movimentações
 * - Disparar cálculo de prazos e notificações
 */

import { prisma } from '../config/database.js';
import { getQueue, type Job } from './task-queue.js';
import { datajudClient } from '../scrapers/datajud/datajud.client.js';
import {
  parseProcessoDatajud,
  parseMovimentacoesDatajud,
} from '../scrapers/datajud/datajud.parser.js';
import { randomDelay } from '../shared/utils/retry.js';
import { env } from '../config/env.js';

// ─── Types ──────────────────────────────────────────────────

interface ScrapingJobData {
  processoId: string;
  numeroCnj: string;
  tribunal: string;
  tipo: 'DATAJUD' | 'EPROC' | 'PJE';
}

interface ScrapingResult {
  processoId: string;
  novasMovimentacoes: number;
  sucesso: boolean;
  tempoMs: number;
}

// ─── Fila de Scraping ───────────────────────────────────────

const scrapingQueue = getQueue<ScrapingJobData>('scraping', {
  concurrency: env.SCRAPING_CONCURRENCY,
  maxRetries: 2,
  retryDelayMs: 10000,
});

/**
 * Processa um job de scraping (atualmente via DataJud)
 */
async function processScrapingJob(job: Job<ScrapingJobData>): Promise<ScrapingResult> {
  const { processoId, numeroCnj, tribunal } = job.data;
  const startTime = Date.now();

  console.log(`🔍 [Scraping] Sincronizando ${numeroCnj} (${tribunal})...`);

  try {
    // Delay aleatório para evitar rate limiting
    await randomDelay(env.SCRAPING_DELAY_MIN, env.SCRAPING_DELAY_MAX);

    // Consultar DataJud
    const dadosDatajud = await datajudClient.consultarProcesso(numeroCnj, tribunal);
    const tempoMs = Date.now() - startTime;

    if (!dadosDatajud) {
      // Processo não encontrado no DataJud, registrar e seguir
      await registrarLogScraping(tribunal, 'consulta_publica', processoId, true, tempoMs);

      await prisma.processo.update({
        where: { id: processoId },
        data: {
          ultimaVerif: new Date(),
          proximaVerif: calcularProximaVerificacao(360),
        },
      });

      return { processoId, novasMovimentacoes: 0, sucesso: true, tempoMs };
    }

    // Atualizar dados do processo
    const dadosParsed = parseProcessoDatajud(dadosDatajud);
    await prisma.processo.update({
      where: { id: processoId },
      data: {
        ...dadosParsed,
        numeroCnj, // Não sobrescrever
        ultimaVerif: new Date(),
        proximaVerif: calcularProximaVerificacao(360),
        status: 'ATIVO',
      },
    });

    // Salvar novas movimentações
    let novasMovimentacoes = 0;

    if (dadosDatajud.movimentos?.length) {
      const movimentacoes = parseMovimentacoesDatajud(dadosDatajud.movimentos, processoId);

      for (const mov of movimentacoes) {
        try {
          await prisma.movimentacao.create({ data: mov as any });
          novasMovimentacoes++;
        } catch (error: any) {
          // Ignora duplicatas (hash_conteudo unique constraint)
          if (!error.message?.includes('Unique constraint')) {
            console.warn(`⚠️ Erro ao salvar movimentação: ${error.message}`);
          }
        }
      }
    }

    // Registrar log de sucesso
    await registrarLogScraping(tribunal, 'consulta_publica', processoId, true, tempoMs, null, {
      novasMovimentacoes,
      totalMovimentacoes: dadosDatajud.movimentos?.length || 0,
    });

    // Se encontrou novas movimentações, disparar workers de prazo e notificação
    if (novasMovimentacoes > 0) {
      console.log(`✅ [Scraping] ${numeroCnj}: ${novasMovimentacoes} nova(s) movimentação(ões)`);
      await dispararPrazosENotificacoes(processoId, numeroCnj);
    } else {
      console.log(`✅ [Scraping] ${numeroCnj}: sem novidades`);
    }

    return { processoId, novasMovimentacoes, sucesso: true, tempoMs };
  } catch (error) {
    const tempoMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    await registrarLogScraping(tribunal, 'consulta_publica', processoId, false, tempoMs, errorMsg);

    // Marcar processo com erro se falhou definitivamente
    if (job.attempts >= job.maxAttempts) {
      await prisma.processo.update({
        where: { id: processoId },
        data: {
          status: 'ERRO_SYNC',
          ultimaVerif: new Date(),
          proximaVerif: calcularProximaVerificacao(720), // Retry em 12h
        },
      });
    }

    throw error;
  }
}

// ─── Funções auxiliares ─────────────────────────────────────

function calcularProximaVerificacao(intervaloMinutos: number): Date {
  return new Date(Date.now() + intervaloMinutos * 60 * 1000);
}

async function registrarLogScraping(
  tribunal: string,
  acao: string,
  processoId: string | null,
  sucesso: boolean,
  tempoMs: number,
  erro?: string | null,
  detalhes?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.logScraping.create({
      data: {
        tribunal,
        sistema: 'DATAJUD',
        acao,
        processoId,
        sucesso,
        tempoMs,
        erro,
        detalhes: detalhes ? JSON.stringify(detalhes) : null,
      },
    });
  } catch (e) {
    console.error('Erro ao registrar log de scraping:', e);
  }
}

/**
 * Dispara cálculo de prazos e notificações para processos com novas movimentações
 */
async function dispararPrazosENotificacoes(processoId: string, numeroCnj: string): Promise<void> {
  // Adicionar na fila de prazos
  const prazosQueue = getQueue('prazos');
  await prazosQueue.add({ processoId, numeroCnj });

  // Adicionar na fila de notificações
  const notificacoesQueue = getQueue('notificacoes');
  await notificacoesQueue.add({ processoId, numeroCnj, tipo: 'NOVA_MOVIMENTACAO' });
}

// ─── Funções públicas ───────────────────────────────────────

/**
 * Enfileira processos que precisam de sincronização
 */
export async function enfileirarProcessosPendentes(): Promise<number> {
  const agora = new Date();

  const processos = await prisma.processo.findMany({
    where: {
      status: { in: ['ATIVO', 'ERRO_SYNC'] },
      OR: [
        { proximaVerif: null },
        { proximaVerif: { lte: agora } },
      ],
    },
    select: {
      id: true,
      numeroCnj: true,
      tribunal: true,
    },
    orderBy: { proximaVerif: 'asc' },
    take: 50, // Processar em lotes de 50
  });

  if (processos.length === 0) return 0;

  console.log(`📋 [Scraping] Enfileirando ${processos.length} processo(s) para sincronização...`);

  for (const processo of processos) {
    await scrapingQueue.add({
      processoId: processo.id,
      numeroCnj: processo.numeroCnj,
      tribunal: processo.tribunal,
      tipo: 'DATAJUD',
    });
  }

  return processos.length;
}

/**
 * Enfileira um processo específico para sincronização imediata
 */
export async function enfileirarProcessoUnico(
  processoId: string,
  numeroCnj: string,
  tribunal: string,
): Promise<void> {
  await scrapingQueue.add(
    {
      processoId,
      numeroCnj,
      tribunal,
      tipo: 'DATAJUD',
    },
    { priority: 10 }, // Alta prioridade para sincronização manual
  );
}

/**
 * Inicializa o worker de scraping
 */
export function iniciarWorkerScraping(): void {
  scrapingQueue.process(processScrapingJob);

  scrapingQueue.on('completed', (job: Job<ScrapingJobData>) => {
    console.log(`✅ [Scraping] Job ${job.id} finalizado`);
  });

  scrapingQueue.on('failed', (job: Job<ScrapingJobData>, error: Error) => {
    console.error(`❌ [Scraping] Job ${job.id} falhou: ${error.message}`);
  });

  console.log('🤖 Worker de scraping inicializado');
}
