/**
 * Worker de Notificações — Disparo de alertas para advogados
 *
 * Responsável por:
 * - Criar notificações no banco (canal SISTEMA)
 * - Disparar emails (quando SMTP configurado)
 * - Evitar notificações duplicadas
 * - Controlar prioridade de alertas
 */

import { prisma } from '../config/database.js';
import { getQueue, type Job } from './task-queue.js';
import { formatarData } from '../shared/utils/date-utils.js';
import {
  enviarEmail,
  isEmailConfigured,
  templateAlertaPrazo,
  templateNovaMovimentacao,
} from '../modules/notificacoes/email.provider.js';

// ─── Types ──────────────────────────────────────────────────

interface NotificacaoJobData {
  tipo: 'NOVA_MOVIMENTACAO' | 'PRAZO_PROXIMO' | 'PRAZO_CRITICO' | 'PRAZO_VENCIDO' | 'RESUMO_DIARIO';
  advogadoId?: string;
  processoId: string;
  prazoId?: string;
  numeroCnj: string;
  diasRestantes?: number;
  descricaoMovimentacao?: string;
}

// ─── Fila de Notificações ───────────────────────────────────

const notificacoesQueue = getQueue<NotificacaoJobData>('notificacoes', {
  concurrency: 10,
  maxRetries: 2,
  retryDelayMs: 3000,
});

/**
 * Processa um job de notificação
 */
async function processNotificacaoJob(job: Job<NotificacaoJobData>): Promise<void> {
  const { tipo, processoId, advogadoId, numeroCnj, diasRestantes, prazoId } = job.data;

  // Se advogadoId não foi fornecido, buscar todos os advogados do processo
  const advogadoIds = advogadoId
    ? [advogadoId]
    : await buscarAdvogadosDoProcesso(processoId);

  if (advogadoIds.length === 0) return;

  for (const advId of advogadoIds) {
    // Verificar se já existe notificação similar recente (evitar duplicatas)
    const duplicata = await prisma.notificacao.findFirst({
      where: {
        advogadoId: advId,
        processoId,
        tipo,
        criadoEm: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) }, // Últimas 4 horas
      },
    });

    if (duplicata) continue;

    // Construir título e mensagem baseados no tipo
    const { titulo, mensagem, prioridade } = construirNotificacao(tipo, numeroCnj, diasRestantes);

    try {
      await prisma.notificacao.create({
        data: {
          advogadoId: advId,
          processoId,
          tipo,
          canal: 'SISTEMA',
          prioridade,
          titulo,
          mensagem,
        },
      });

      console.log(`🔔 [Notificações] ${tipo} → Advogado ${advId.substring(0, 8)}... (${numeroCnj})`);

      // Enviar email se SMTP estiver configurado
      if (isEmailConfigured()) {
        try {
          const advogado = await prisma.advogado.findUnique({ where: { id: advId } });
          if (advogado?.email) {
            const dashboardUrl = `http://localhost:3000`;
            let html = '';

            if (tipo === 'NOVA_MOVIMENTACAO') {
              html = templateNovaMovimentacao({
                nomeAdvogado: advogado.nome,
                numeroCnj,
                classe: 'Processo',
                descricaoMov: mensagem,
                dataMov: new Date(),
                dashboardUrl,
              });
            } else if (tipo === 'PRAZO_PROXIMO' || tipo === 'PRAZO_CRITICO' || tipo === 'PRAZO_VENCIDO') {
              html = templateAlertaPrazo({
                nomeAdvogado: advogado.nome,
                numeroCnj,
                classe: 'Processo',
                descricaoPrazo: mensagem,
                dataVencimento: new Date(),
                diasRestantes: diasRestantes || 0,
                prioridade: prioridade === 'URGENTE' ? 'URGENTE' : prioridade === 'ALTA' ? 'ALTA' : 'NORMAL',
                dashboardUrl,
              });
            }

            if (html) {
              await enviarEmail({ to: advogado.email, subject: titulo, html });
            }
          }
        } catch (emailErr) {
          console.warn(`⚠️ [Notificações] Falha ao enviar email: ${emailErr}`);
        }
      }
    } catch (error: any) {
      console.error(`❌ [Notificações] Erro ao criar: ${error.message}`);
    }
  }
}

// ─── Construção de notificações ─────────────────────────────

function construirNotificacao(
  tipo: NotificacaoJobData['tipo'],
  numeroCnj: string,
  diasRestantes?: number,
): { titulo: string; mensagem: string; prioridade: 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE' } {
  switch (tipo) {
    case 'NOVA_MOVIMENTACAO':
      return {
        titulo: `📋 Nova movimentação - ${numeroCnj}`,
        mensagem: `O processo ${numeroCnj} teve uma nova movimentação detectada pelo sistema de monitoramento automático. Acesse o painel para ver os detalhes.`,
        prioridade: 'NORMAL',
      };

    case 'PRAZO_PROXIMO':
      return {
        titulo: `⏰ Prazo próximo - ${numeroCnj}`,
        mensagem: `Atenção! O processo ${numeroCnj} possui um prazo que vence em ${diasRestantes} dia(s) útil(eis). Verifique as pendências no painel.`,
        prioridade: 'ALTA',
      };

    case 'PRAZO_CRITICO':
      return {
        titulo: `🚨 PRAZO CRÍTICO - ${numeroCnj}`,
        mensagem: `URGENTE! O processo ${numeroCnj} possui um prazo que vence em ${diasRestantes} dia(s) útil(eis). Ação imediata necessária!`,
        prioridade: 'URGENTE',
      };

    case 'PRAZO_VENCIDO':
      return {
        titulo: `❌ Prazo vencido - ${numeroCnj}`,
        mensagem: `O processo ${numeroCnj} teve um prazo que venceu. Verifique imediatamente se há ação corretiva necessária.`,
        prioridade: 'URGENTE',
      };

    case 'RESUMO_DIARIO':
      return {
        titulo: `📊 Resumo diário - ${new Date().toLocaleDateString('pt-BR')}`,
        mensagem: `Seu resumo diário está pronto. Acesse o painel para ver todas as atualizações do dia.`,
        prioridade: 'BAIXA',
      };

    default:
      return {
        titulo: `Atualização - ${numeroCnj}`,
        mensagem: `O processo ${numeroCnj} teve uma atualização.`,
        prioridade: 'NORMAL',
      };
  }
}

/**
 * Busca todos os advogados vinculados a um processo
 */
async function buscarAdvogadosDoProcesso(processoId: string): Promise<string[]> {
  const vinculos = await prisma.processoAdvogado.findMany({
    where: { processoId },
    select: { advogadoId: true },
  });
  return vinculos.map((v) => v.advogadoId);
}

// ─── Resumo diário ──────────────────────────────────────────

/**
 * Gera e envia resumos diários para todos os advogados ativos
 */
export async function gerarResumoDiario(): Promise<void> {
  console.log('📊 [Notificações] Gerando resumos diários...');

  const advogados = await prisma.advogado.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, email: true },
  });

  for (const advogado of advogados) {
    // Buscar dados do dia
    const [novasMovs, prazosProximos, prazosVencidos] = await Promise.all([
      prisma.movimentacao.count({
        where: {
          processo: { advogados: { some: { advogadoId: advogado.id } } },
          criadoEm: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.prazo.count({
        where: {
          processo: { advogados: { some: { advogadoId: advogado.id } } },
          status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
          dataFim: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.prazo.count({
        where: {
          processo: { advogados: { some: { advogadoId: advogado.id } } },
          status: 'PERDIDO',
          atualizadoEm: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    // Só enviar se houver algo a reportar
    if (novasMovs > 0 || prazosProximos > 0 || prazosVencidos > 0) {
      const mensagem = [
        `Olá, ${advogado.nome.split(' ')[0]}!`,
        '',
        `📋 Resumo do dia ${new Date().toLocaleDateString('pt-BR')}:`,
        `• ${novasMovs} nova(s) movimentação(ões)`,
        `• ${prazosProximos} prazo(s) próximo(s) (próximos 7 dias)`,
        prazosVencidos > 0 ? `• ⚠️ ${prazosVencidos} prazo(s) vencido(s)` : null,
        '',
        'Acesse o painel para mais detalhes.',
      ]
        .filter(Boolean)
        .join('\n');

      await prisma.notificacao.create({
        data: {
          advogadoId: advogado.id,
          tipo: 'RESUMO_DIARIO',
          canal: 'SISTEMA',
          prioridade: prazosVencidos > 0 ? 'ALTA' : 'NORMAL',
          titulo: `📊 Resumo diário - ${new Date().toLocaleDateString('pt-BR')}`,
          mensagem,
        },
      });
    }
  }

  console.log(`✅ [Notificações] Resumos diários enviados para ${advogados.length} advogado(s)`);
}

// ─── Funções públicas ───────────────────────────────────────

/**
 * Inicializa o worker de notificações
 */
export function iniciarWorkerNotificacoes(): void {
  notificacoesQueue.process(processNotificacaoJob);

  notificacoesQueue.on('completed', (job: Job<NotificacaoJobData>) => {
    // Log silencioso para notificações (evitar poluir console)
  });

  notificacoesQueue.on('failed', (job: Job<NotificacaoJobData>, error: Error) => {
    console.error(`❌ [Notificações] Job ${job.id} falhou: ${error.message}`);
  });

  console.log('🔔 Worker de notificações inicializado');
}
