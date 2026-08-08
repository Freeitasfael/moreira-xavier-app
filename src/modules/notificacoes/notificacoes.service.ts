/**
 * Serviço de Notificações — Orquestrador
 */

import { prisma } from '../../config/database.js';
import { formatarData, formatarDataHora } from '../../shared/utils/date-utils.js';
import type { Prazo, Processo, Notificacao } from '@prisma/client';

export class NotificacaoService {
  /**
   * Cria notificação de nova movimentação
   */
  async notificarNovaMovimentacao(
    advogadoId: string,
    processo: { id: string; numeroCnj: string; classe?: string | null },
    descricaoMovimentacao: string,
  ): Promise<Notificacao> {
    return prisma.notificacao.create({
      data: {
        advogadoId,
        processoId: processo.id,
        tipo: 'NOVA_MOVIMENTACAO',
        canal: 'SISTEMA',
        prioridade: 'NORMAL',
        titulo: `Nova movimentação - ${processo.numeroCnj}`,
        mensagem: `O processo ${processo.numeroCnj} (${processo.classe || 'N/A'}) teve uma nova movimentação:\n\n${descricaoMovimentacao}`,
      },
    });
  }

  /**
   * Cria notificação de prazo próximo
   */
  async notificarPrazoProximo(
    advogadoId: string,
    prazo: Prazo & { processo: Processo },
    diasRestantes: number,
  ): Promise<Notificacao> {
    const tipo = diasRestantes <= 2 ? 'PRAZO_CRITICO' : 'PRAZO_PROXIMO';
    const prioridade = diasRestantes <= 1 ? 'URGENTE' : diasRestantes <= 2 ? 'ALTA' : 'NORMAL';

    return prisma.notificacao.create({
      data: {
        advogadoId,
        processoId: prazo.processoId,
        tipo,
        canal: 'SISTEMA',
        prioridade,
        titulo: `⚠️ Prazo ${diasRestantes <= 2 ? 'CRÍTICO' : 'próximo'} - ${prazo.processo.numeroCnj}`,
        mensagem: `O prazo de "${prazo.descricao}" do processo ${prazo.processo.numeroCnj} vence em ${diasRestantes} dia(s) útil(eis) (${formatarData(prazo.dataFim)}).\n\nProcesso: ${prazo.processo.classe || 'N/A'}\nTipo: ${prazo.tipo}`,
      },
    });
  }

  /**
   * Lista notificações de um advogado
   */
  async listarNotificacoes(
    advogadoId: string,
    filtros?: { lidas?: boolean; limite?: number },
  ) {
    const where: any = { advogadoId };

    if (filtros?.lidas === false) {
      where.lidaEm = null;
    } else if (filtros?.lidas === true) {
      where.lidaEm = { not: null };
    }

    return prisma.notificacao.findMany({
      where,
      include: {
        processo: {
          select: { numeroCnj: true, classe: true },
        },
      },
      orderBy: { criadoEm: 'desc' },
      take: filtros?.limite || 50,
    });
  }

  /**
   * Marca notificação como lida
   */
  async marcarComoLida(notificacaoId: string) {
    return prisma.notificacao.update({
      where: { id: notificacaoId },
      data: { lidaEm: new Date() },
    });
  }

  /**
   * Marca todas as notificações como lidas
   */
  async marcarTodasComoLidas(advogadoId: string) {
    return prisma.notificacao.updateMany({
      where: { advogadoId, lidaEm: null },
      data: { lidaEm: new Date() },
    });
  }

  /**
   * Conta notificações não lidas
   */
  async contarNaoLidas(advogadoId: string): Promise<number> {
    return prisma.notificacao.count({
      where: { advogadoId, lidaEm: null },
    });
  }
}

export const notificacaoService = new NotificacaoService();
