/**
 * Calculadora de Prazos Processuais (CPC)
 *
 * Implementa o cálculo de prazos conforme:
 * - Art. 219 CPC: contagem em dias úteis
 * - Art. 224 CPC: exclui dia de início, inclui vencimento
 * - Art. 1.003 CPC: prazo recursal de 15 dias
 * - Art. 335 CPC: contestação em 15 dias
 * - E demais prazos processuais
 */

import { calcularVencimentoPrazo, diasUteisRestantes } from '../../shared/utils/date-utils.js';

// ─── Tabela de Prazos Padrão (CPC) ─────────────────────────

export interface PrazoPadrao {
  tipo: string;
  diasUteis: number;
  descricao: string;
  fundamentacao: string;
}

export const PRAZOS_CPC: Record<string, PrazoPadrao[]> = {
  INTIMACAO: [
    {
      tipo: 'MANIFESTACAO',
      diasUteis: 15,
      descricao: 'Manifestação sobre intimação',
      fundamentacao: 'Art. 218, CPC',
    },
  ],
  CITACAO: [
    {
      tipo: 'CONTESTACAO',
      diasUteis: 15,
      descricao: 'Contestação',
      fundamentacao: 'Art. 335, CPC',
    },
  ],
  SENTENCA: [
    {
      tipo: 'RECURSO',
      diasUteis: 15,
      descricao: 'Apelação',
      fundamentacao: 'Art. 1.003, CPC',
    },
    {
      tipo: 'EMBARGOS',
      diasUteis: 5,
      descricao: 'Embargos de Declaração',
      fundamentacao: 'Art. 1.023, CPC',
    },
  ],
  DECISAO: [
    {
      tipo: 'RECURSO',
      diasUteis: 15,
      descricao: 'Agravo de Instrumento',
      fundamentacao: 'Art. 1.003, CPC',
    },
    {
      tipo: 'EMBARGOS',
      diasUteis: 5,
      descricao: 'Embargos de Declaração',
      fundamentacao: 'Art. 1.023, CPC',
    },
  ],
  ACORDAO: [
    {
      tipo: 'RECURSO',
      diasUteis: 15,
      descricao: 'Recurso Especial / Extraordinário',
      fundamentacao: 'Art. 1.003, CPC',
    },
    {
      tipo: 'EMBARGOS',
      diasUteis: 5,
      descricao: 'Embargos de Declaração',
      fundamentacao: 'Art. 1.023, CPC',
    },
  ],
  DESPACHO: [
    {
      tipo: 'CUMPRIMENTO',
      diasUteis: 5,
      descricao: 'Cumprimento de despacho',
      fundamentacao: 'Art. 218, §3º, CPC',
    },
  ],
};

// ─── Calculadora ────────────────────────────────────────────

export interface PrazoCalculado {
  tipo: string;
  descricao: string;
  diasUteis: number;
  dataInicio: Date;
  dataFim: Date;
  diasRestantes: number;
  fundamentacao: string;
}

/**
 * Calcula os prazos possíveis a partir de uma movimentação
 */
export function calcularPrazosMovimentacao(
  tipoMovimentacao: string,
  dataMovimentacao: Date,
): PrazoCalculado[] {
  const prazosPadrao = PRAZOS_CPC[tipoMovimentacao];

  if (!prazosPadrao) return [];

  return prazosPadrao.map((p) => {
    const dataFim = calcularVencimentoPrazo(dataMovimentacao, p.diasUteis);
    const diasRestantes = diasUteisRestantes(dataFim);

    return {
      tipo: p.tipo,
      descricao: p.descricao,
      diasUteis: p.diasUteis,
      dataInicio: dataMovimentacao,
      dataFim,
      diasRestantes,
      fundamentacao: p.fundamentacao,
    };
  });
}

/**
 * Calcula um prazo customizado
 */
export function calcularPrazoCustomizado(
  dataInicio: Date,
  diasUteis: number,
  descricao: string,
): PrazoCalculado {
  const dataFim = calcularVencimentoPrazo(dataInicio, diasUteis);
  const diasRestantes = diasUteisRestantes(dataFim);

  return {
    tipo: 'GENERICO',
    descricao,
    diasUteis,
    dataInicio,
    dataFim,
    diasRestantes,
    fundamentacao: 'Prazo customizado',
  };
}

/**
 * Determina se um prazo deve gerar alerta
 */
export function deveAlertarPrazo(dataFim: Date, diasAntecedencia: number = 2): boolean {
  const diasRestantes = diasUteisRestantes(dataFim);
  return diasRestantes <= diasAntecedencia && diasRestantes >= 0;
}
