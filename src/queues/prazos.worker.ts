/**
 * Worker de Prazos — Cálculo automático de prazos processuais
 *
 * Responsável por:
 * - Analisar novas movimentações e calcular prazos CPC
 * - Verificar prazos que estão próximos do vencimento
 * - Atualizar status de prazos vencidos
 * - Disparar alertas para prazos urgentes
 */

import { prisma } from '../config/database.js';
import { getQueue, type Job } from './task-queue.js';
import {
  calcularPrazosMovimentacao,
  deveAlertarPrazo,
} from '../modules/prazos/prazos.calculator.js';
import { diasUteisRestantes } from '../shared/utils/date-utils.js';

// ─── Types ──────────────────────────────────────────────────

interface PrazoJobData {
  processoId: string;
  numeroCnj: string;
  tipo?: 'CALCULAR_NOVOS' | 'VERIFICAR_VENCIMENTOS';
}

// ─── Fila de Prazos ─────────────────────────────────────────

const prazosQueue = getQueue<PrazoJobData>('prazos', {
  concurrency: 5,
  maxRetries: 2,
  retryDelayMs: 5000,
});

/**
 * Processa um job de cálculo/verificação de prazos
 */
async function processPrazoJob(job: Job<PrazoJobData>): Promise<void> {
  const { processoId, numeroCnj, tipo } = job.data;

  if (tipo === 'VERIFICAR_VENCIMENTOS') {
    await verificarPrazosVencidos();
    return;
  }

  // Tipo padrão: CALCULAR_NOVOS
  console.log(`📅 [Prazos] Calculando prazos para ${numeroCnj}...`);

  // Buscar movimentações recentes sem prazo associado
  const movimentacoesRecentes = await prisma.movimentacao.findMany({
    where: {
      processoId,
      tipo: { in: ['INTIMACAO', 'CITACAO', 'SENTENCA', 'DECISAO', 'ACORDAO', 'DESPACHO'] },
      // Apenas movimentações recentes (últimos 30 dias)
      data: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { data: 'desc' },
    take: 10,
  });

  let prazosCalculados = 0;

  for (const mov of movimentacoesRecentes) {
    // Verificar se já existe prazo para esta movimentação
    const prazoExistente = await prisma.prazo.findFirst({
      where: {
        processoId,
        movimentacaoOrigemId: mov.id,
      },
    });

    if (prazoExistente) continue;

    // Calcular prazos baseados no tipo de movimentação
    const prazos = calcularPrazosMovimentacao(mov.tipo, mov.data);

    for (const prazo of prazos) {
      // Só criar se o prazo ainda não venceu
      if (prazo.diasRestantes < 0) continue;

      try {
        await prisma.prazo.create({
          data: {
            processoId,
            tipo: prazo.tipo as any,
            descricao: prazo.descricao,
            dataInicio: prazo.dataInicio,
            dataFim: prazo.dataFim,
            diasUteis: prazo.diasUteis,
            status: 'PENDENTE',
            observacao: `Calculado automaticamente. ${prazo.fundamentacao}`,
            movimentacaoOrigemId: mov.id,
          },
        });
        prazosCalculados++;
      } catch (error: any) {
        console.warn(`⚠️ [Prazos] Erro ao criar prazo: ${error.message}`);
      }
    }
  }

  if (prazosCalculados > 0) {
    console.log(`✅ [Prazos] ${numeroCnj}: ${prazosCalculados} prazo(s) calculado(s)`);
  }
}

// ─── Verificação de vencimentos ─────────────────────────────

/**
 * Verifica todos os prazos pendentes e:
 * - Marca como PERDIDO os que já venceram
 * - Dispara alertas para os que estão próximos
 */
async function verificarPrazosVencidos(): Promise<void> {
  const agora = new Date();

  // 1. Marcar prazos vencidos
  const vencidos = await prisma.prazo.updateMany({
    where: {
      status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
      dataFim: { lt: agora },
    },
    data: { status: 'PERDIDO' },
  });

  if (vencidos.count > 0) {
    console.log(`⚠️ [Prazos] ${vencidos.count} prazo(s) marcado(s) como PERDIDO`);

    // Notificar prazos vencidos
    const prazosVencidos = await prisma.prazo.findMany({
      where: {
        status: 'PERDIDO',
        // Apenas prazos recém-marcados (última hora)
        atualizadoEm: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      include: {
        processo: {
          include: {
            advogados: { select: { advogadoId: true } },
          },
        },
      },
    });

    const notificacoesQueue = getQueue('notificacoes');
    for (const prazo of prazosVencidos) {
      for (const { advogadoId } of prazo.processo.advogados) {
        await notificacoesQueue.add({
          tipo: 'PRAZO_VENCIDO',
          advogadoId,
          processoId: prazo.processoId,
          prazoId: prazo.id,
          numeroCnj: prazo.processo.numeroCnj,
        });
      }
    }
  }

  // 2. Alertar prazos próximos (próximos 3 dias úteis)
  const prazosProximos = await prisma.prazo.findMany({
    where: {
      status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
      dataFim: {
        gte: agora,
        lte: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 dias corridos
      },
    },
    include: {
      processo: {
        include: {
          advogados: { select: { advogadoId: true } },
        },
      },
    },
  });

  const notificacoesQueue = getQueue('notificacoes');

  for (const prazo of prazosProximos) {
    const diasRestantes = diasUteisRestantes(prazo.dataFim);

    if (diasRestantes <= 3 && diasRestantes >= 0) {
      for (const { advogadoId } of prazo.processo.advogados) {
        await notificacoesQueue.add({
          tipo: diasRestantes <= 2 ? 'PRAZO_CRITICO' : 'PRAZO_PROXIMO',
          advogadoId,
          processoId: prazo.processoId,
          prazoId: prazo.id,
          numeroCnj: prazo.processo.numeroCnj,
          diasRestantes,
        });
      }
    }
  }

  if (prazosProximos.length > 0) {
    console.log(`📅 [Prazos] ${prazosProximos.length} prazo(s) próximo(s) verificado(s)`);
  }
}

// ─── Funções públicas ───────────────────────────────────────

/**
 * Enfileira verificação geral de vencimentos
 */
export async function enfileirarVerificacaoPrazos(): Promise<void> {
  await prazosQueue.add({
    processoId: 'global',
    numeroCnj: 'global',
    tipo: 'VERIFICAR_VENCIMENTOS',
  });
}

/**
 * Inicializa o worker de prazos
 */
export function iniciarWorkerPrazos(): void {
  prazosQueue.process(processPrazoJob);

  prazosQueue.on('completed', (job: Job<PrazoJobData>) => {
    if (job.data.tipo !== 'VERIFICAR_VENCIMENTOS') {
      console.log(`✅ [Prazos] Job ${job.id} finalizado`);
    }
  });

  prazosQueue.on('failed', (job: Job<PrazoJobData>, error: Error) => {
    console.error(`❌ [Prazos] Job ${job.id} falhou: ${error.message}`);
  });

  console.log('📅 Worker de prazos inicializado');
}
