/**
 * Client HTTP para consulta processual do TJMG — Sem Playwright
 *
 * Estratégia API-first:
 * 1. Consulta Processual via API REST do TJMG (www4.tjmg.jus.br)
 * 2. Busca por OAB via consulta pública do PJe (parsing HTML leve)
 *
 * Isso substitui o scraper Playwright (que era pesado demais para o Render)
 * por chamadas HTTP puras usando fetch().
 */

import { withRetry, sleep } from '../../shared/utils/retry.js';

// ─── Types ──────────────────────────────────────────────────

export interface TjmgProcessoInfo {
  numeroCnj: string;
  classe?: string;
  assunto?: string;
  comarca?: string;
  vara?: string;
  parteAutora?: string;
  parteRe?: string;
  movimentacoes: TjmgMovimentacao[];
}

export interface TjmgMovimentacao {
  data: Date;
  descricao: string;
  tipo: string;
  complemento?: string;
}

// ─── Rate limiter ───────────────────────────────────────────

let lastTjmgRequest = 0;
const MIN_INTERVAL = 1500; // 1.5s entre requisições

async function rateLimitTjmg(): Promise<void> {
  const elapsed = Date.now() - lastTjmgRequest;
  if (elapsed < MIN_INTERVAL) {
    await sleep(MIN_INTERVAL - elapsed);
  }
  lastTjmgRequest = Date.now();
}

// ─── Headers realistas ──────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

// ─── TJMG API Client ────────────────────────────────────────

export class TjmgApiClient {

  /**
   * Consulta um processo na Consulta Processual do TJMG (sistema legado)
   * URL: https://www4.tjmg.jus.br/juridico/sf/proc_resultado2.jsp
   */
  async consultarProcesso(numeroCnj: string): Promise<TjmgProcessoInfo | null> {
    const numeroLimpo = numeroCnj.replace(/\D/g, '');

    return withRetry(async () => {
      await rateLimitTjmg();

      console.log(`🔍 [TJMG API] Consultando ${numeroCnj} via consulta processual...`);

      // 1. Fazer a consulta via POST
      const formData = new URLSearchParams({
        listaProcessos: numeroLimpo,
        natureza: '0', // Todas as naturezas
        tipoConsulta: '1',
      });

      const res = await fetch('https://www4.tjmg.jus.br/juridico/sf/proc_resultado2.jsp', {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://www4.tjmg.jus.br/juridico/sf/proc_complemento.jsp',
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        throw new Error(`TJMG consulta retornou ${res.status}`);
      }

      const html = await res.text();

      // 2. Fazer parse do HTML de resultado
      return this.parseResultadoConsulta(html, numeroCnj);
    }, {
      maxRetries: 2,
      baseDelayMs: 3000,
      onRetry: (err, attempt) => {
        console.warn(`⚠️ [TJMG API] Retry ${attempt}: ${err.message}`);
      },
    });
  }

  /**
   * Busca processos vinculados a uma OAB no TJMG.
   * Usa a consulta processual por advogado.
   */
  async buscarProcessosPorOab(oabNumero: string, oabUf: string): Promise<string[]> {
    try {
      await rateLimitTjmg();

      console.log(`🔍 [TJMG API] Buscando processos para OAB ${oabNumero}/${oabUf}...`);

      // Consulta por advogado/OAB no sistema legado do TJMG
      const formData = new URLSearchParams({
        numeroOAB: oabNumero,
        ufOAB: oabUf.toUpperCase(),
        tipoConsulta: '3', // Consulta por OAB
        natureza: '0',
      });

      const res = await fetch('https://www4.tjmg.jus.br/juridico/sf/proc_resultado2.jsp', {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://www4.tjmg.jus.br/juridico/sf/proc_complemento.jsp',
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        throw new Error(`TJMG OAB consulta retornou ${res.status}`);
      }

      const html = await res.text();
      return this.extrairCnjsDaListagem(html);
    } catch (error) {
      console.error(`❌ [TJMG API] Erro na busca OAB: ${error}`);
      return [];
    }
  }

  // ─── Parsers HTML ──────────────────────────────────────────

  /**
   * Extrai dados do processo a partir do HTML de resultado da consulta TJMG
   */
  private parseResultadoConsulta(html: string, numeroCnj: string): TjmgProcessoInfo | null {
    // Verificar se retornou "nenhum processo"
    if (
      html.includes('Nenhum processo encontrado') ||
      html.includes('nenhum registro encontrado') ||
      html.includes('Número do processo inválido')
    ) {
      console.log(`⚠️ [TJMG API] Processo ${numeroCnj} não encontrado`);
      return null;
    }

    const processo: TjmgProcessoInfo = {
      numeroCnj,
      movimentacoes: [],
    };

    // Extrair classe
    const classeMatch = html.match(/Classe[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i)
      || html.match(/classeProcessual[^>]*>([^<]+)/i);
    if (classeMatch) processo.classe = classeMatch[1].trim();

    // Extrair assunto
    const assuntoMatch = html.match(/Assunto[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i)
      || html.match(/assuntoProcessual[^>]*>([^<]+)/i);
    if (assuntoMatch) processo.assunto = assuntoMatch[1].trim();

    // Extrair comarca
    const comarcaMatch = html.match(/Comarca[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i);
    if (comarcaMatch) processo.comarca = comarcaMatch[1].trim();

    // Extrair vara
    const varaMatch = html.match(/Vara[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i)
      || html.match(/(?:Órgão|Orgao)\s*Julgador[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i);
    if (varaMatch) processo.vara = varaMatch[1].trim();

    // Extrair partes
    const autorMatch = html.match(/(?:Requerente|Autor|Exeq)[^:]*:[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i);
    if (autorMatch) processo.parteAutora = autorMatch[1].trim();

    const reuMatch = html.match(/(?:Requerido|Réu|Réa|Executado)[^:]*:[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i);
    if (reuMatch) processo.parteRe = reuMatch[1].trim();

    // Extrair movimentações da tabela
    // O TJMG legado usa tabelas com data | movimentação
    const movRegex = /(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    let movMatch;
    while ((movMatch = movRegex.exec(html)) !== null) {
      const dataStr = movMatch[1].trim();
      const descricao = movMatch[2].replace(/<[^>]+>/g, '').trim(); // Strip HTML tags

      if (descricao && descricao.length > 3) {
        const data = this.parseDataBr(dataStr);
        if (data) {
          processo.movimentacoes.push({
            data,
            descricao,
            tipo: this.classificarMovimentacao(descricao),
          });
        }
      }
    }

    console.log(`✅ [TJMG API] ${numeroCnj}: ${processo.movimentacoes.length} movimentação(ões)`);
    return processo;
  }

  /**
   * Extrai CNJs de uma listagem HTML de resultados
   */
  private extrairCnjsDaListagem(html: string): string[] {
    const cnjs = new Set<string>();

    // Padrão CNJ: 7 dígitos - 2 dígitos . 4 dígitos . 1 dígito . 2 dígitos . 4 dígitos
    const regex = /(\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4})/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      cnjs.add(match[1]);
    }

    // Também tentar formato sem pontuação (20 dígitos seguidos)
    const regexLimpo = /(?<!\d)(\d{20})(?!\d)/g;
    while ((match = regexLimpo.exec(html)) !== null) {
      const num = match[1];
      const formatted = `${num.slice(0,7)}-${num.slice(7,9)}.${num.slice(9,13)}.${num.slice(13,14)}.${num.slice(14,16)}.${num.slice(16,20)}`;
      cnjs.add(formatted);
    }

    const result = Array.from(cnjs);
    console.log(`✅ [TJMG API] Encontrados ${result.length} CNJs na listagem`);
    return result;
  }

  // ─── Utilitários ───────────────────────────────────────────

  private parseDataBr(texto: string): Date | null {
    const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!match) return null;
    const [, dia, mes, ano, hora, minuto] = match;
    return new Date(
      parseInt(ano), parseInt(mes) - 1, parseInt(dia),
      parseInt(hora || '0'), parseInt(minuto || '0')
    );
  }

  private classificarMovimentacao(descricao: string): string {
    const desc = descricao.toLowerCase();
    if (desc.includes('sentença') || desc.includes('sentenca')) return 'SENTENCA';
    if (desc.includes('decisão') || desc.includes('decisao') || desc.includes('interlocutória')) return 'DECISAO';
    if (desc.includes('despacho')) return 'DESPACHO';
    if (desc.includes('intimação') || desc.includes('intimacao') || desc.includes('intimado')) return 'INTIMACAO';
    if (desc.includes('citação') || desc.includes('citacao') || desc.includes('citado')) return 'CITACAO';
    if (desc.includes('petição') || desc.includes('peticao')) return 'PETICAO';
    if (desc.includes('juntada')) return 'JUNTADA';
    if (desc.includes('audiência') || desc.includes('audiencia')) return 'AUDIENCIA';
    if (desc.includes('distribuí') || desc.includes('distribui')) return 'DISTRIBUICAO';
    if (desc.includes('recurso') || desc.includes('apelação') || desc.includes('agravo')) return 'RECURSO';
    if (desc.includes('baixa') || desc.includes('arquiv')) return 'BAIXA';
    if (desc.includes('remessa') || desc.includes('remeti')) return 'REMESSA';
    if (desc.includes('acórdão') || desc.includes('acordao')) return 'ACORDAO';
    return 'OUTROS';
  }
}

// ─── Singleton ──────────────────────────────────────────────

export const tjmgApiClient = new TjmgApiClient();
