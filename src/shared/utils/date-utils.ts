/**
 * Utilitários de data para cálculo de prazos processuais
 *
 * Regras do CPC:
 * - Art. 219: contagem em dias úteis
 * - Art. 224: exclui dia de início, inclui dia de vencimento
 * - Art. 220: suspensão entre 20/dez e 20/jan (férias forenses)
 */

import {
  addDays,
  isWeekend,
  isSaturday,
  isSunday,
  format,
  parseISO,
  isBefore,
  isAfter,
  isEqual,
  differenceInDays,
  getYear,
  startOfDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getFeriadosDoAno, isFeriado } from '../constants/feriados.js';

/**
 * Verifica se uma data é dia útil forense
 * (não é fim de semana, feriado ou período de férias forenses)
 */
export function isDiaUtil(data: Date): boolean {
  if (isWeekend(data)) return false;
  if (isFeriado(data)) return false;
  if (isFeriasForenses(data)) return false;
  return true;
}

/**
 * Verifica se a data está no período de férias forenses
 * Art. 220, CPC: 20 de dezembro a 20 de janeiro
 */
export function isFeriasForenses(data: Date): boolean {
  const month = data.getMonth(); // 0-indexed
  const day = data.getDate();

  // Dezembro: a partir do dia 20
  if (month === 11 && day >= 20) return true;
  // Janeiro: até o dia 20
  if (month === 0 && day <= 20) return true;

  return false;
}

/**
 * Calcula a data de vencimento de um prazo em dias úteis
 *
 * Art. 224, CPC:
 * - Exclui o dia de início
 * - Inclui o dia de vencimento
 * - Se vencimento cair em dia não-útil, prorroga para próximo dia útil
 */
export function calcularVencimentoPrazo(dataInicio: Date, diasUteis: number): Date {
  let diasContados = 0;
  let dataAtual = startOfDay(new Date(dataInicio));

  while (diasContados < diasUteis) {
    dataAtual = addDays(dataAtual, 1);
    if (isDiaUtil(dataAtual)) {
      diasContados++;
    }
  }

  // Se cair em dia não-útil, prorroga para o próximo dia útil
  while (!isDiaUtil(dataAtual)) {
    dataAtual = addDays(dataAtual, 1);
  }

  return dataAtual;
}

/**
 * Conta quantos dias úteis restam até uma data
 */
export function diasUteisRestantes(dataFim: Date): number {
  const hoje = startOfDay(new Date());
  const fim = startOfDay(new Date(dataFim));

  if (isBefore(fim, hoje) || isEqual(fim, hoje)) return 0;

  let dias = 0;
  let dataAtual = new Date(hoje);

  while (isBefore(dataAtual, fim)) {
    dataAtual = addDays(dataAtual, 1);
    if (isDiaUtil(dataAtual)) {
      dias++;
    }
  }

  return dias;
}

/**
 * Conta dias úteis entre duas datas
 */
export function contarDiasUteis(dataInicio: Date, dataFim: Date): number {
  let dias = 0;
  let dataAtual = startOfDay(new Date(dataInicio));
  const fim = startOfDay(new Date(dataFim));

  while (isBefore(dataAtual, fim)) {
    dataAtual = addDays(dataAtual, 1);
    if (isDiaUtil(dataAtual)) {
      dias++;
    }
  }

  return dias;
}

/**
 * Retorna o próximo dia útil a partir de uma data
 */
export function proximoDiaUtil(data: Date): Date {
  let dataAtual = startOfDay(new Date(data));

  if (isDiaUtil(dataAtual)) return dataAtual;

  while (!isDiaUtil(dataAtual)) {
    dataAtual = addDays(dataAtual, 1);
  }

  return dataAtual;
}

/**
 * Formata data para exibição em pt-BR
 */
export function formatarData(data: Date | string, formatStr: string = 'dd/MM/yyyy'): string {
  const dateObj = typeof data === 'string' ? parseISO(data) : data;
  return format(dateObj, formatStr, { locale: ptBR });
}

/**
 * Formata data e hora para exibição
 */
export function formatarDataHora(data: Date | string): string {
  return formatarData(data, "dd/MM/yyyy 'às' HH:mm");
}

/**
 * Verifica o nível de urgência de um prazo
 */
export function nivelUrgenciaPrazo(dataFim: Date): 'normal' | 'atencao' | 'urgente' | 'vencido' {
  const diasRestantes = diasUteisRestantes(dataFim);
  const hoje = startOfDay(new Date());
  const fim = startOfDay(new Date(dataFim));

  if (isBefore(fim, hoje)) return 'vencido';
  if (diasRestantes <= 2) return 'urgente';
  if (diasRestantes <= 5) return 'atencao';
  return 'normal';
}
