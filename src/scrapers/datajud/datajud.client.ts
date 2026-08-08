/**
 * Client REST para a API Pública do DataJud (CNJ)
 *
 * Base URL: https://api-publica.datajud.cnj.jus.br
 * Docs: https://datajud-wiki.cnj.jus.br/
 *
 * A API usa ElasticSearch por trás, então as queries
 * seguem o formato do ES Query DSL.
 */

import { env } from '../../config/env.js';
import { withRetry, sleep } from '../../shared/utils/retry.js';
import { identificarTribunal } from '../../shared/utils/cnj-number.js';

// ─── Types ──────────────────────────────────────────────────

export interface DatajudMovimentacao {
  codigo: number;
  nome: string;
  dataHora: string;
  complementosTabelados?: Array<{
    codigo: number;
    nome: string;
    descricao: string;
  }>;
}

export interface DatajudProcesso {
  numeroProcesso: string;
  classe: {
    codigo: number;
    nome: string;
  };
  assuntos: Array<{
    codigo: number;
    nome: string;
  }>;
  tribunal: string;
  dataAjuizamento: string;
  grau: string;
  nivelSigilo: number;
  orgaoJulgador: {
    codigo: number;
    nome: string;
  };
  movimentos: DatajudMovimentacao[];
  formato?: {
    nome: string;
  };
}

export interface DatajudResponse {
  hits: {
    total: {
      value: number;
    };
    hits: Array<{
      _source: DatajudProcesso;
    }>;
  };
}

// ─── Mapa de aliases dos tribunais ──────────────────────────

const TRIBUNAL_ALIASES: Record<string, string> = {
  // Justiça Estadual
  TJAC: 'api_publica_tjac', TJAL: 'api_publica_tjal', TJAM: 'api_publica_tjam',
  TJAP: 'api_publica_tjap', TJBA: 'api_publica_tjba', TJCE: 'api_publica_tjce',
  TJDF: 'api_publica_tjdft', TJES: 'api_publica_tjes', TJGO: 'api_publica_tjgo',
  TJMA: 'api_publica_tjma', TJMG: 'api_publica_tjmg', TJMS: 'api_publica_tjms',
  TJMT: 'api_publica_tjmt', TJPA: 'api_publica_tjpa', TJPB: 'api_publica_tjpb',
  TJPE: 'api_publica_tjpe', TJPI: 'api_publica_tjpi', TJPR: 'api_publica_tjpr',
  TJRJ: 'api_publica_tjrj', TJRN: 'api_publica_tjrn', TJRO: 'api_publica_tjro',
  TJRR: 'api_publica_tjrr', TJRS: 'api_publica_tjrs', TJSC: 'api_publica_tjsc',
  TJSE: 'api_publica_tjse', TJSP: 'api_publica_tjsp', TJTO: 'api_publica_tjto',
  // Justiça Federal
  TRF1: 'api_publica_trf1', TRF2: 'api_publica_trf2', TRF3: 'api_publica_trf3',
  TRF4: 'api_publica_trf4', TRF5: 'api_publica_trf5', TRF6: 'api_publica_trf6',
  // Justiça do Trabalho
  TRT1: 'api_publica_trt1', TRT2: 'api_publica_trt2', TRT3: 'api_publica_trt3',
  TRT4: 'api_publica_trt4', TRT5: 'api_publica_trt5', TRT6: 'api_publica_trt6',
  TRT7: 'api_publica_trt7', TRT8: 'api_publica_trt8', TRT9: 'api_publica_trt9',
  TRT10: 'api_publica_trt10', TRT11: 'api_publica_trt11', TRT12: 'api_publica_trt12',
  TRT13: 'api_publica_trt13', TRT14: 'api_publica_trt14', TRT15: 'api_publica_trt15',
  TRT16: 'api_publica_trt16', TRT17: 'api_publica_trt17', TRT18: 'api_publica_trt18',
  TRT19: 'api_publica_trt19', TRT20: 'api_publica_trt20', TRT21: 'api_publica_trt21',
  TRT22: 'api_publica_trt22', TRT23: 'api_publica_trt23', TRT24: 'api_publica_trt24',
  // Superiores
  STF: 'api_publica_stf', STJ: 'api_publica_stj', TST: 'api_publica_tst',
  TSE: 'api_publica_tse', STM: 'api_publica_stm',
};

// ─── Rate Limiter simples ───────────────────────────────────

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1000; // 1 requisição por segundo

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

// ─── Client ─────────────────────────────────────────────────

export class DatajudClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = env.DATAJUD_BASE_URL;
    this.apiKey = env.DATAJUD_API_KEY;
  }

  /**
   * Faz uma requisição à API do DataJud
   */
  private async request(endpoint: string, body: object): Promise<DatajudResponse> {
    await rateLimitWait();

    const url = `${this.baseUrl}/${endpoint}/_search`;

    const response = await withRetry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `APIKey ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`DataJud API error ${res.status}: ${errorText}`);
        }

        return res.json() as Promise<DatajudResponse>;
      },
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        onRetry: (error, attempt) => {
          console.warn(`⚠️ DataJud retry ${attempt}: ${error.message}`);
        },
      },
    );

    return response;
  }

  /**
   * Consulta um processo pelo número CNJ
   */
  async consultarProcesso(numeroCnj: string, tribunal?: string): Promise<DatajudProcesso | null> {
    // Determinar o tribunal pelo número CNJ se não fornecido
    const tribunalSigla = tribunal || identificarTribunal(numeroCnj);
    const alias = TRIBUNAL_ALIASES[tribunalSigla];

    if (!alias) {
      throw new Error(`Tribunal não suportado: ${tribunalSigla}`);
    }

    const query = {
      query: {
        match: {
          numeroProcesso: numeroCnj.replace(/\D/g, ''),
        },
      },
      size: 1,
    };

    const response = await this.request(alias, query);

    if (response.hits.total.value === 0) {
      return null;
    }

    return response.hits.hits[0]._source;
  }

  /**
   * Consulta movimentações de um processo
   */
  async consultarMovimentacoes(numeroCnj: string, tribunal?: string): Promise<DatajudMovimentacao[]> {
    const processo = await this.consultarProcesso(numeroCnj, tribunal);
    if (!processo) return [];
    return processo.movimentos || [];
  }

  /**
   * Busca processos por nome do advogado em um tribunal
   */
  async buscarPorAdvogado(
    nomeAdvogado: string,
    tribunalSigla: string,
    tamanho: number = 10,
  ): Promise<DatajudProcesso[]> {
    const alias = TRIBUNAL_ALIASES[tribunalSigla];
    if (!alias) {
      throw new Error(`Tribunal não suportado: ${tribunalSigla}`);
    }

    const query = {
      query: {
        match: {
          'movimentos.complementosTabelados.descricao': nomeAdvogado,
        },
      },
      size: tamanho,
    };

    const response = await this.request(alias, query);
    return response.hits.hits.map((hit) => hit._source);
  }

  /**
   * Verifica se a API está acessível
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Tenta buscar um processo fictício no TJMG
      const alias = TRIBUNAL_ALIASES['TJMG'];
      const query = { query: { match_all: {} }, size: 1 };
      await this.request(alias, query);
      return true;
    } catch {
      return false;
    }
  }
}

export const datajudClient = new DatajudClient();
