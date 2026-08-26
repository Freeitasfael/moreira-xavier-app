/**
 * Parser para transformar dados do DataJud no formato interno
 */

import { createHash } from 'crypto';
import type { DatajudProcesso, DatajudMovimentacao } from './datajud.client.js';
import { formatCnjNumber } from '../../shared/utils/cnj-number.js';

// ─── Mapeamento de códigos de movimentação para tipos ───────

const CODIGO_TIPO_MAP: Record<number, string> = {
  // Distribuição
  26: 'DISTRIBUICAO',
  // Despachos
  11: 'DESPACHO',
  67: 'DESPACHO',
  // Decisões
  3: 'DECISAO',
  7: 'DECISAO',
  // Sentenças
  22: 'SENTENCA',
  193: 'SENTENCA',
  220: 'SENTENCA',
  // Julgamento
  56: 'ACORDAO',
  // Intimação
  12: 'INTIMACAO',
  60: 'INTIMACAO',
  // Citação
  14: 'CITACAO',
  // Petição
  85: 'PETICAO',
  152: 'PETICAO',
  // Juntada
  581: 'JUNTADA',
  // Audiência
  970: 'AUDIENCIA',
  // Remessa
  123: 'REMESSA',
  36: 'REMESSA',
  // Baixa / Arquivamento
  246: 'BAIXA',
  861: 'BAIXA',
  // Recurso
  198: 'RECURSO',
  218: 'RECURSO',
};

/**
 * Determina o tipo de movimentação pelo código CNJ/SGT
 */
function classificarMovimentacao(codigo: number | undefined, descricao: string): string {
  if (codigo && CODIGO_TIPO_MAP[codigo]) {
    return CODIGO_TIPO_MAP[codigo];
  }

  // Fallback por palavra-chave na descrição
  const desc = descricao.toLowerCase();
  if (desc.includes('sentença') || desc.includes('sentenca')) return 'SENTENCA';
  if (desc.includes('decisão') || desc.includes('decisao')) return 'DECISAO';
  if (desc.includes('despacho')) return 'DESPACHO';
  if (desc.includes('intimação') || desc.includes('intimacao')) return 'INTIMACAO';
  if (desc.includes('citação') || desc.includes('citacao')) return 'CITACAO';
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

/**
 * Gera hash único para uma movimentação (para detectar duplicatas)
 */
function gerarHashMovimentacao(mov: DatajudMovimentacao): string {
  const content = `${mov.dataHora}|${mov.codigo}|${mov.nome}`;
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Converte dados do DataJud para o formato de inserção no banco
 */
export function parseProcessoDatajud(raw: DatajudProcesso) {
  // Extrair comarca do nome do órgão julgador
  // Ex: "Vara de Família e de Sucessões e Ausências da Comarca de Teófilo Otôni"
  //  → comarca: "Teófilo Otôni"
  const nomeOrgao = raw.orgaoJulgador?.nome || '';
  let comarca: string | null = null;
  const comarcaMatch = nomeOrgao.match(/Comarca\s+(?:de\s+|d[aoe]\s+)?(.+?)$/i);
  if (comarcaMatch) {
    comarca = comarcaMatch[1].trim();
  }

  return {
    numeroCnj: formatCnjNumber(raw.numeroProcesso),
    tribunal: raw.tribunal || '',
    instancia: raw.grau === 'G1' ? 1 : raw.grau === 'G2' ? 2 : 1,
    classe: raw.classe?.nome || null,
    assunto: raw.assuntos?.map((a) => a.nome).join('; ') || null,
    vara: nomeOrgao || null,
    comarca,
    sistemaOrigem: 'DATAJUD' as const,
  };
}

/**
 * Converte movimentações do DataJud para o formato de inserção no banco
 */
export function parseMovimentacoesDatajud(
  movimentacoes: DatajudMovimentacao[],
  processoId: string,
) {
  return movimentacoes.map((mov) => {
    const complementos = mov.complementosTabelados
      ?.map((c) => `${c.nome}: ${c.descricao}`)
      .join('; ');

    return {
      processoId,
      data: new Date(mov.dataHora),
      codigo: mov.codigo || null,
      descricao: mov.nome,
      tipo: classificarMovimentacao(mov.codigo, mov.nome),
      complemento: complementos || null,
      fonte: 'DATAJUD' as const,
      hashConteudo: gerarHashMovimentacao(mov),
    };
  });
}

/**
 * Identifica movimentações que podem gerar prazos
 */
export function identificarMovimentacoesComPrazo(movimentacoes: DatajudMovimentacao[]) {
  const tipos_prazo = ['INTIMACAO', 'CITACAO', 'SENTENCA', 'DECISAO', 'ACORDAO'];

  return movimentacoes.filter((mov) => {
    const tipo = classificarMovimentacao(mov.codigo, mov.nome);
    return tipos_prazo.includes(tipo);
  });
}
