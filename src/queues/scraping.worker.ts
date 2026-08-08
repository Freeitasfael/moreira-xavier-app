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

export interface OabSyncJobData {
  advogadoId: string;
  oabNumero: string;
  oabUf: string;
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

export const oabSyncQueue = getQueue<OabSyncJobData>('oab_sync', {
  concurrency: 1, // Limitar a 1 porque a busca por OAB é pesada
  maxRetries: 1,
  retryDelayMs: 30000,
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

    // Verificar se há um advogado associado para buscar credenciais
    const relacao = await prisma.processoAdvogado.findFirst({
      where: { processoId },
      select: { advogadoId: true }
    });

    let dadosParsed: any = null;
    let novasMovimentacoes = 0;
    let totalMovimentacoes = 0;
    let usouScraperPrivado = false;

    if (relacao && tribunal === 'TJMG') {
      const { authService } = await import('../modules/auth/auth.service.js');
      // Procura credencial EPROC_TJMG (nossa implementação atual)
      const credencial = await authService.obterCredencial(relacao.advogadoId, 'EPROC_TJMG');

      if (credencial) {
        console.log(`🔑 [Scraping] Credencial encontrada para ${numeroCnj}. Usando scraper privado Eproc...`);
        const { EprocTjmgPrivadoScraper } = await import('../scrapers/eproc/eproc-tjmg-privado.js');
        const scraper = new EprocTjmgPrivadoScraper(credencial.login, credencial.senha);
        
        const resultado = await scraper.buscarProcessoLogado(numeroCnj);
        
        if (resultado.sucesso && resultado.dados) {
          dadosParsed = resultado.dados;
          usouScraperPrivado = true;
          totalMovimentacoes = resultado.dados.movimentacoes.length;
          
          // Salvar novas movimentações
          for (const mov of resultado.dados.movimentacoes) {
            try {
              await prisma.movimentacao.create({ 
                data: {
                  ...mov,
                  processoId,
                  hashConteudo: `${processoId}-${mov.data.toISOString()}-${mov.descricao}`.substring(0, 255)
                }
              });
              novasMovimentacoes++;
            } catch (error: any) {
              // Ignora duplicatas
            }
          }
        } else {
          console.warn(`⚠️ [Scraping] Scraper privado falhou para ${numeroCnj}. Erro: ${resultado.erro}. Caindo para fallback (DataJud).`);
        }
      }
    }

    if (!usouScraperPrivado) {
      // Fallback: Consultar DataJud
      console.log(`🌐 [Scraping] Usando fallback DataJud para ${numeroCnj}...`);
      const dadosDatajud = await datajudClient.consultarProcesso(numeroCnj, tribunal);
      
      if (!dadosDatajud) {
        // Processo não encontrado no DataJud, registrar e seguir
        await registrarLogScraping(tribunal, 'consulta_publica', processoId, true, Date.now() - startTime);

        await prisma.processo.update({
          where: { id: processoId },
          data: {
            ultimaVerif: new Date(),
            proximaVerif: calcularProximaVerificacao(360),
          },
        });

        return { processoId, novasMovimentacoes: 0, sucesso: true, tempoMs: Date.now() - startTime };
      }

      dadosParsed = parseProcessoDatajud(dadosDatajud);
      
      if (dadosDatajud.movimentos?.length) {
        totalMovimentacoes = dadosDatajud.movimentos.length;
        const movimentacoesDatajud = parseMovimentacoesDatajud(dadosDatajud.movimentos, processoId);
        for (const mov of movimentacoesDatajud) {
          try {
            await prisma.movimentacao.create({ data: mov as any });
            novasMovimentacoes++;
          } catch (error: any) {
            // Ignora duplicatas
          }
        }
      }
    }

    const tempoMs = Date.now() - startTime;

    // Atualizar dados do processo (Capa)
    await prisma.processo.update({
      where: { id: processoId },
      data: {
        classe: dadosParsed.classe,
        assunto: dadosParsed.assunto,
        comarca: dadosParsed.comarca,
        vara: dadosParsed.vara,
        parteAutora: dadosParsed.parteAutora,
        parteRe: dadosParsed.parteRe,
        valorCausa: dadosParsed.valorCausa,
        numeroCnj, // Não sobrescrever
        ultimaVerif: new Date(),
        proximaVerif: calcularProximaVerificacao(360),
        status: 'ATIVO',
      },
    });

    // Registrar log de sucesso
    await registrarLogScraping(tribunal, usouScraperPrivado ? 'scraping_logado' : 'consulta_datajud', processoId, true, tempoMs, null, {
      novasMovimentacoes,
      totalMovimentacoes,
      usouScraperPrivado
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

/**
 * Processa um job de sincronização por OAB
 */
async function processOabSyncJob(job: Job<OabSyncJobData>): Promise<number> {
  const { advogadoId, oabNumero, oabUf } = job.data;
  console.log(`🔍 [OAB Sync] Iniciando busca para OAB ${oabNumero}/${oabUf}...`);

  const { tjmgConsultaPublica } = await import('../scrapers/tjmg/tjmg-consulta-publica.js');
  
  try {
    const cnjs = await tjmgConsultaPublica.buscarProcessosPorOab(oabNumero, oabUf);
    let novosCount = 0;

    for (const numeroCnj of cnjs) {
      // Formatar CNJ
      const cnjFormatado = numeroCnj.replace(/^(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
      
      // Tentar encontrar o processo
      let processo = await prisma.processo.findUnique({
        where: { numeroCnj: cnjFormatado }
      });

      // Se não existir, criar com dados mínimos
      if (!processo) {
        processo = await prisma.processo.create({
          data: {
            numeroCnj: cnjFormatado,
            tribunal: 'TJMG',
            status: 'ATIVO',
          }
        });
        novosCount++;
      }

      // Vincular ao advogado
      await prisma.processoAdvogado.upsert({
        where: {
          advogadoId_processoId: {
            advogadoId,
            processoId: processo.id
          }
        },
        update: {},
        create: {
          advogadoId,
          processoId: processo.id
        }
      });

      // Se foi recém criado ou nunca verificado, mandar para a fila de scraping
      if (!processo.ultimaVerif) {
        await enfileirarProcessoUnico(processo.id, processo.numeroCnj, processo.tribunal);
      }
    }

    console.log(`✅ [OAB Sync] OAB ${oabNumero}/${oabUf} processada. ${cnjs.length} totais, ${novosCount} novos.`);
    return cnjs.length;
  } catch (error) {
    console.error(`❌ [OAB Sync] Erro ao buscar processos da OAB ${oabNumero}:`, error);
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

  oabSyncQueue.process(processOabSyncJob);

  oabSyncQueue.on('completed', (job: Job<OabSyncJobData>) => {
    console.log(`✅ [OAB Sync] Job ${job.id} finalizado`);
  });

  oabSyncQueue.on('failed', (job: Job<OabSyncJobData>, error: Error) => {
    console.error(`❌ [OAB Sync] Job ${job.id} falhou: ${error.message}`);
  });

  console.log('🤖 Worker de scraping inicializado');
}
