/**
 * Base de feriados nacionais e estaduais (Minas Gerais)
 * para cálculo de prazos processuais em dias úteis.
 *
 * Inclui:
 * - Feriados nacionais fixos
 * - Feriados nacionais móveis (Páscoa, Corpus Christi, Carnaval)
 * - Feriados estaduais de MG
 * - Feriados forenses
 */

import { getYear, isEqual, startOfDay } from 'date-fns';

interface Feriado {
  data: Date;
  nome: string;
  tipo: 'nacional' | 'estadual' | 'forense';
}

// ─── Feriados Fixos Nacionais ───────────────────────────────

function feriadosFixosNacionais(ano: number): Feriado[] {
  return [
    { data: new Date(ano, 0, 1), nome: 'Confraternização Universal', tipo: 'nacional' },
    { data: new Date(ano, 3, 21), nome: 'Tiradentes', tipo: 'nacional' },
    { data: new Date(ano, 4, 1), nome: 'Dia do Trabalho', tipo: 'nacional' },
    { data: new Date(ano, 8, 7), nome: 'Independência do Brasil', tipo: 'nacional' },
    { data: new Date(ano, 9, 12), nome: 'Nossa Sra. Aparecida', tipo: 'nacional' },
    { data: new Date(ano, 10, 2), nome: 'Finados', tipo: 'nacional' },
    { data: new Date(ano, 10, 15), nome: 'Proclamação da República', tipo: 'nacional' },
    { data: new Date(ano, 10, 20), nome: 'Dia da Consciência Negra', tipo: 'nacional' },
    { data: new Date(ano, 11, 25), nome: 'Natal', tipo: 'nacional' },
  ];
}

// ─── Feriados Estaduais de Minas Gerais ─────────────────────

function feriadosEstaduaisMG(ano: number): Feriado[] {
  return [
    { data: new Date(ano, 6, 8), nome: 'Emancipação Política de MG (Data Magna)', tipo: 'estadual' },
  ];
}

// ─── Feriados Forenses ──────────────────────────────────────

function feriadosForenses(ano: number): Feriado[] {
  return [
    { data: new Date(ano, 0, 11), nome: 'Dia do Judiciário (forense)', tipo: 'forense' },
    { data: new Date(ano, 7, 11), nome: 'Dia do Advogado (forense)', tipo: 'forense' },
    { data: new Date(ano, 9, 28), nome: 'Dia do Servidor Público (forense)', tipo: 'forense' },
    { data: new Date(ano, 11, 8), nome: 'Dia da Justiça (forense)', tipo: 'forense' },
  ];
}

// ─── Cálculo de Feriados Móveis ─────────────────────────────

/**
 * Calcula a data da Páscoa pelo algoritmo de Meeus/Jones/Butcher
 */
function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(ano, mes - 1, dia);
}

/**
 * Gera os feriados móveis baseados na data da Páscoa
 */
function feriadosMoveis(ano: number): Feriado[] {
  const pascoa = calcularPascoa(ano);
  const pascoaMs = pascoa.getTime();
  const umDia = 24 * 60 * 60 * 1000;

  return [
    {
      data: new Date(pascoaMs - 48 * umDia),
      nome: 'Carnaval (segunda)',
      tipo: 'nacional',
    },
    {
      data: new Date(pascoaMs - 47 * umDia),
      nome: 'Carnaval (terça)',
      tipo: 'nacional',
    },
    {
      data: new Date(pascoaMs - 46 * umDia),
      nome: 'Quarta-feira de Cinzas (ponto facultativo)',
      tipo: 'forense',
    },
    {
      data: new Date(pascoaMs - 2 * umDia),
      nome: 'Sexta-feira Santa',
      tipo: 'nacional',
    },
    {
      data: pascoa,
      nome: 'Páscoa',
      tipo: 'nacional',
    },
    {
      data: new Date(pascoaMs + 60 * umDia),
      nome: 'Corpus Christi',
      tipo: 'nacional',
    },
  ];
}

// ─── API Pública ────────────────────────────────────────────

// Cache de feriados por ano
const cacheAnual = new Map<number, Feriado[]>();

/**
 * Retorna todos os feriados de um ano (com cache)
 */
export function getFeriadosDoAno(ano: number): Feriado[] {
  if (cacheAnual.has(ano)) {
    return cacheAnual.get(ano)!;
  }

  const feriados = [
    ...feriadosFixosNacionais(ano),
    ...feriadosEstaduaisMG(ano),
    ...feriadosForenses(ano),
    ...feriadosMoveis(ano),
  ];

  cacheAnual.set(ano, feriados);
  return feriados;
}

/**
 * Verifica se uma data é feriado
 */
export function isFeriado(data: Date): boolean {
  const ano = getYear(data);
  const feriados = getFeriadosDoAno(ano);
  const dataStart = startOfDay(data);

  return feriados.some((f) => isEqual(startOfDay(f.data), dataStart));
}

/**
 * Retorna o nome do feriado se a data for feriado, null caso contrário
 */
export function getNomeFeriado(data: Date): string | null {
  const ano = getYear(data);
  const feriados = getFeriadosDoAno(ano);
  const dataStart = startOfDay(data);

  const feriado = feriados.find((f) => isEqual(startOfDay(f.data), dataStart));
  return feriado?.nome ?? null;
}
