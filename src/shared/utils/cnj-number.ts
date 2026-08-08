/**
 * Validação e utilitários para número unificado do CNJ
 *
 * Formato: NNNNNNN-DD.AAAA.J.TR.OOOO
 * - NNNNNNN: Número sequencial (7 dígitos)
 * - DD: Dígito verificador (2 dígitos)
 * - AAAA: Ano de ajuizamento (4 dígitos)
 * - J: Segmento de justiça (1 dígito)
 * - TR: Tribunal (2 dígitos)
 * - OOOO: Origem/vara (4 dígitos)
 *
 * Referência: Resolução CNJ nº 65/2008
 */

const CNJ_REGEX = /^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/;
const CNJ_DIGITS_ONLY = /^\d{20}$/;

export interface NumeroCnjParsed {
  sequencial: string;
  digitoVerificador: string;
  ano: string;
  segmento: string;
  tribunal: string;
  origem: string;
  formatado: string;
  apenasDigitos: string;
}

/**
 * Segmentos de Justiça (campo J)
 */
export const SEGMENTOS_JUSTICA: Record<string, string> = {
  '1': 'Supremo Tribunal Federal',
  '2': 'Conselho Nacional de Justiça',
  '3': 'Superior Tribunal de Justiça',
  '4': 'Justiça Federal',
  '5': 'Justiça do Trabalho',
  '6': 'Justiça Eleitoral',
  '7': 'Justiça Militar da União',
  '8': 'Justiça Estadual',
  '9': 'Justiça Militar Estadual',
};

/**
 * Mapa de tribunais por código (campo TR)
 */
export const TRIBUNAIS: Record<string, string> = {
  // Justiça Estadual (segmento 8)
  '8.13': 'TJMG',
  '8.26': 'TJSP',
  '8.19': 'TJRJ',
  '8.06': 'TJCE',
  '8.16': 'TJMA',
  '8.05': 'TJBA',
  '8.08': 'TJDF',
  '8.09': 'TJES',
  '8.12': 'TJMG',
  '8.15': 'TJPB',
  '8.17': 'TJPE',
  '8.20': 'TJRN',
  '8.21': 'TJRS',
  '8.24': 'TJSC',
  '8.25': 'TJSE',
  // Justiça Federal
  '4.01': 'TRF1',
  '4.02': 'TRF2',
  '4.03': 'TRF3',
  '4.04': 'TRF4',
  '4.05': 'TRF5',
  '4.06': 'TRF6',
  // Justiça do Trabalho
  '5.01': 'TRT1',
  '5.02': 'TRT2',
  '5.03': 'TRT3',
  '5.04': 'TRT4',
  '5.05': 'TRT5',
  '5.15': 'TRT15',
};

/**
 * Valida se um número CNJ está no formato correto
 */
export function isValidCnjNumber(numero: string): boolean {
  const cleaned = numero.trim();
  return CNJ_REGEX.test(cleaned);
}

/**
 * Formata um número CNJ de apenas dígitos para o formato padrão
 */
export function formatCnjNumber(digits: string): string {
  const cleaned = digits.replace(/\D/g, '');
  if (cleaned.length !== 20) {
    throw new Error(`Número CNJ deve ter 20 dígitos, recebeu ${cleaned.length}`);
  }
  return `${cleaned.slice(0, 7)}-${cleaned.slice(7, 9)}.${cleaned.slice(9, 13)}.${cleaned.slice(13, 14)}.${cleaned.slice(14, 16)}.${cleaned.slice(16, 20)}`;
}

/**
 * Normaliza um número CNJ (aceita com ou sem formatação)
 */
export function normalizeCnjNumber(numero: string): string {
  const cleaned = numero.replace(/\D/g, '');
  if (cleaned.length !== 20) {
    throw new Error(`Número CNJ inválido: "${numero}"`);
  }
  return formatCnjNumber(cleaned);
}

/**
 * Faz o parse completo de um número CNJ
 */
export function parseCnjNumber(numero: string): NumeroCnjParsed {
  const formatted = normalizeCnjNumber(numero);
  const match = formatted.match(CNJ_REGEX);

  if (!match) {
    throw new Error(`Número CNJ inválido: "${numero}"`);
  }

  return {
    sequencial: match[1],
    digitoVerificador: match[2],
    ano: match[3],
    segmento: match[4],
    tribunal: match[5],
    origem: match[6],
    formatado: formatted,
    apenasDigitos: formatted.replace(/\D/g, ''),
  };
}

/**
 * Calcula o dígito verificador de um número CNJ
 * Algoritmo: módulo 97 (ISO 7064)
 */
export function calcularDigitoVerificador(
  sequencial: string,
  ano: string,
  segmento: string,
  tribunal: string,
  origem: string,
): string {
  // Remainder = (NNNNNNN * 10^13 + AAAA * 10^9 + J * 10^8 + TR * 10^6 + OOOO * 10^2) mod 97
  const numBig =
    BigInt(sequencial) * 10n ** 13n +
    BigInt(ano) * 10n ** 9n +
    BigInt(segmento) * 10n ** 8n +
    BigInt(tribunal) * 10n ** 6n +
    BigInt(origem) * 10n ** 2n;

  const remainder = numBig % 97n;
  const dv = 97n - remainder;

  return dv.toString().padStart(2, '0');
}

/**
 * Verifica se o dígito verificador do número CNJ está correto
 */
export function verificarDigitoVerificador(numero: string): boolean {
  const parsed = parseCnjNumber(numero);
  const dvCalculado = calcularDigitoVerificador(
    parsed.sequencial,
    parsed.ano,
    parsed.segmento,
    parsed.tribunal,
    parsed.origem,
  );
  return parsed.digitoVerificador === dvCalculado;
}

/**
 * Identifica o tribunal a partir do número CNJ
 */
export function identificarTribunal(numero: string): string {
  const parsed = parseCnjNumber(numero);
  const chave = `${parsed.segmento}.${parsed.tribunal}`;
  return TRIBUNAIS[chave] || `Tribunal ${parsed.segmento}.${parsed.tribunal}`;
}

/**
 * Retorna o alias do DataJud para um tribunal
 */
export function getDatajudAlias(numero: string): string {
  const tribunal = identificarTribunal(numero).toLowerCase();
  return `api_publica_${tribunal}`;
}
