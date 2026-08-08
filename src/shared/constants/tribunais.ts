/**
 * Mapa de tribunais brasileiros com metadados para scraping
 */

export interface TribunalInfo {
  sigla: string;
  nome: string;
  uf: string;
  segmento: 'estadual' | 'federal' | 'trabalho' | 'eleitoral' | 'militar' | 'superior';
  sistema: 'EPROC' | 'PJE' | 'ESAJ' | 'PROJUDI' | 'OUTROS';
  datajudAlias: string;
  urlConsultaPublica?: string;
  urlLogin?: string;
  suportaScraping: boolean;
}

export const TRIBUNAIS_MAP: Record<string, TribunalInfo> = {
  TJMG: {
    sigla: 'TJMG',
    nome: 'Tribunal de Justiça de Minas Gerais',
    uf: 'MG',
    segmento: 'estadual',
    sistema: 'EPROC',
    datajudAlias: 'api_publica_tjmg',
    urlConsultaPublica:
      'https://eproc-consulta-publica-1g.tjmg.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica',
    urlLogin: 'https://eproc-1g.tjmg.jus.br/eproc/',
    suportaScraping: true,
  },
  TJSP: {
    sigla: 'TJSP',
    nome: 'Tribunal de Justiça de São Paulo',
    uf: 'SP',
    segmento: 'estadual',
    sistema: 'ESAJ',
    datajudAlias: 'api_publica_tjsp',
    urlConsultaPublica: 'https://esaj.tjsp.jus.br/cpopg/open.do',
    suportaScraping: false, // Fase futura
  },
  TJRJ: {
    sigla: 'TJRJ',
    nome: 'Tribunal de Justiça do Rio de Janeiro',
    uf: 'RJ',
    segmento: 'estadual',
    sistema: 'PJE',
    datajudAlias: 'api_publica_tjrj',
    suportaScraping: false,
  },
  TRF1: {
    sigla: 'TRF1',
    nome: 'Tribunal Regional Federal da 1ª Região',
    uf: 'DF',
    segmento: 'federal',
    sistema: 'PJE',
    datajudAlias: 'api_publica_trf1',
    suportaScraping: false,
  },
  TRF6: {
    sigla: 'TRF6',
    nome: 'Tribunal Regional Federal da 6ª Região',
    uf: 'MG',
    segmento: 'federal',
    sistema: 'EPROC',
    datajudAlias: 'api_publica_trf6',
    urlConsultaPublica:
      'https://eproc.trf6.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica',
    suportaScraping: true,
  },
  TRT3: {
    sigla: 'TRT3',
    nome: 'Tribunal Regional do Trabalho da 3ª Região',
    uf: 'MG',
    segmento: 'trabalho',
    sistema: 'PJE',
    datajudAlias: 'api_publica_trt3',
    suportaScraping: false,
  },
};

/**
 * Retorna informações de um tribunal pela sigla
 */
export function getTribunalInfo(sigla: string): TribunalInfo | undefined {
  return TRIBUNAIS_MAP[sigla.toUpperCase()];
}

/**
 * Retorna todos os tribunais que suportam scraping
 */
export function getTribunaisComScraping(): TribunalInfo[] {
  return Object.values(TRIBUNAIS_MAP).filter((t) => t.suportaScraping);
}

/**
 * Retorna todos os tribunais de um estado
 */
export function getTribunaisPorUf(uf: string): TribunalInfo[] {
  return Object.values(TRIBUNAIS_MAP).filter((t) => t.uf === uf.toUpperCase());
}
