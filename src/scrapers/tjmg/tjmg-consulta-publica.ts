/**
 * Scraper TJMG — Consulta Pública (PJe 1ª e 2ª instância)
 *
 * Acessa o sistema de consulta pública do PJe do TJMG
 * para buscar informações de processos SEM autenticação.
 *
 * URLs:
 * - PJe Consulta Pública: https://pje.tjmg.jus.br/pje/ConsultaPublica/listView.seam
 * - Consulta Processual: https://www4.tjmg.jus.br/juridico/sf/proc_complemento.jsp
 *
 * Limitações da consulta pública:
 * - Não acessa processos em segredo de justiça
 * - Não mostra detalhes de intimações
 * - Não permite download de documentos
 */

import {
  BaseScraper,
  type ProcessoScraped,
  type MovimentacaoScraped,
  type ScrapingResult,
} from '../base/base-scraper.js';
import type { SistemaOrigem } from '@prisma/client';

// ─── Constantes ─────────────────────────────────────────────

const URLS = {
  PJE_CONSULTA: 'https://pje.tjmg.jus.br/pje/ConsultaPublica/listView.seam',
  CONSULTA_LEGADA: 'https://www4.tjmg.jus.br/juridico/sf/proc_complemento.jsp',
};

// ─── Scraper ────────────────────────────────────────────────

export class TjmgConsultaPublicaScraper extends BaseScraper {
  readonly tribunalSigla = 'TJMG';
  readonly sistemaOrigem: SistemaOrigem = 'EPROC_TJMG';
  readonly nomeCompleto = 'Tribunal de Justiça de Minas Gerais - Consulta Pública';

  /**
   * Consulta um processo pelo número CNJ na consulta pública do PJe TJMG
   */
  async consultarProcessoPje(numeroCnj: string): Promise<ScrapingResult<ProcessoScraped>> {
    return this.executar(
      async () => {
        // 1. Acessar página de consulta pública
        console.log(`🔍 [TJMG] Consultando ${numeroCnj} (PJe Consulta Pública)...`);
        await this.navegarPara(URLS.PJE_CONSULTA);

        // 2. Esperar formulário de pesquisa carregar
        await this.esperarElemento('#fPP\\:numProcesso-inputNumeroProcessoDecoration\\:numProcesso-inputNumeroProcesso', 15000);

        // 3. Preencher número do processo (apenas dígitos)
        const numeroLimpo = numeroCnj.replace(/\D/g, '');
        await this.preencherCampo(
          '#fPP\\:numProcesso-inputNumeroProcessoDecoration\\:numProcesso-inputNumeroProcesso',
          numeroLimpo,
        );

        // 4. Clicar em pesquisar
        await this.delayHumano(500, 1200);
        await this.clicar('#fPP\\:searchProcessos');

        // 5. Esperar resultados
        await this.delayHumano(2000, 4000);

        // 6. Verificar se há resultados
        const semResultado = await this.extrairTexto('.rich-messages-label');
        if (semResultado?.includes('Nenhum processo encontrado')) {
          console.log(`⚠️ [TJMG] Processo ${numeroCnj} não encontrado no PJe`);
          return {
            numeroCnj,
            movimentacoes: [],
          };
        }

        // 7. Clicar no primeiro resultado para ver detalhes
        try {
          await this.esperarElemento('.rich-table-row', 10000);
          await this.clicar('.rich-table-row td a');
          await this.delayHumano(2000, 4000);
        } catch {
          // Pode ter ido direto para a página do processo
        }

        // 8. Extrair dados do processo
        const processo = await this.extrairDadosProcesso(numeroCnj);

        console.log(
          `✅ [TJMG] ${numeroCnj}: ${processo.movimentacoes.length} movimentação(ões)`,
        );

        return processo;
      },
      'consulta_publica_pje',
    );
  }

  /**
   * Consulta um processo pelo sistema legado do TJMG
   */
  async consultarProcessoLegado(numeroCnj: string): Promise<ScrapingResult<ProcessoScraped>> {
    return this.executar(
      async () => {
        console.log(`🔍 [TJMG] Consultando ${numeroCnj} (Sistema Legado)...`);
        await this.navegarPara(URLS.CONSULTA_LEGADA);

        // Preencher número do processo
        const numeroLimpo = numeroCnj.replace(/\D/g, '');
        await this.esperarElemento('input[name="listaProcessos"]', 10000);
        await this.preencherCampo('input[name="listaProcessos"]', numeroLimpo);

        // Clicar em pesquisar
        await this.delayHumano(500, 1200);
        await this.clicar('input[type="submit"]');

        // Esperar resultado
        await this.delayHumano(2000, 4000);

        // Extrair movimentações da tabela de resultados
        const processo = await this.extrairDadosLegado(numeroCnj);

        console.log(
          `✅ [TJMG] ${numeroCnj} (legado): ${processo.movimentacoes.length} movimentação(ões)`,
        );

        return processo;
      },
      'consulta_publica_legado',
    );
  }

  /**
   * Busca processos associados a uma OAB na consulta pública do PJe TJMG.
   * Retorna uma lista de CNJs encontrados.
   */
  async buscarProcessosPorOab(oabNumero: string, oabUf: string): Promise<string[]> {
    const result = await this.executar(
      async () => {
        console.log(`🔍 [TJMG] Buscando processos para OAB ${oabNumero}/${oabUf}...`);
        await this.navegarPara(URLS.PJE_CONSULTA);

        // 1. Esperar o campo OAB carregar
        await this.esperarElemento('input[id*="numeroOAB"]', 15000);

        // 2. Preencher a OAB
        await this.preencherCampo('input[id*="numeroOAB"]', oabNumero);

        // 3. Preencher a UF da OAB
        const selectUfId = '[id*="estadoComboOAB"]';
        if (this.page) {
          // Precisamos encontrar o value correto para a UF no select. O Playwright tem o método selectOption.
          await this.page.selectOption(selectUfId, { label: oabUf.toUpperCase() }).catch(() => {
            console.warn(`⚠️ [TJMG] Não foi possível selecionar a UF ${oabUf} diretamente. Tentando pelo value.`);
          });
        }

        // 4. Clicar em pesquisar
        await this.delayHumano(500, 1200);
        await this.clicar('#fPP\\:searchProcessos');

        // 5. Esperar resultados carregarem (pode demorar bastante se houver muitos processos)
        await this.delayHumano(3000, 6000);

        // 6. Verificar se não encontrou nada
        const semResultado = await this.extrairTexto('.rich-messages-label');
        if (semResultado?.includes('Nenhum processo encontrado')) {
          console.log(`⚠️ [TJMG] Nenhum processo encontrado para a OAB ${oabNumero}/${oabUf}`);
          return [];
        }

        // 7. Extrair CNJs da tabela de resultados
        const cnjs = new Set<string>();
        
        try {
          await this.esperarElemento('.rich-table-row', 10000);
          if (this.page) {
            // No PJe, a lista de processos geralmente está em links na tabela.
            // O formato do texto do link geralmente é o número CNJ formatado.
            const links = await this.page.$$eval('.rich-table-row td a, .rich-table-row td span', elements => {
              return elements.map(el => el.textContent?.trim() || '')
                .filter(text => text.match(/\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}/));
            });
            
            for (const link of links) {
              cnjs.add(link.replace(/\D/g, ''));
            }
            
            // TODO: Paginação. A consulta pública geralmente limita a 30 resultados por página.
            // Se houver mais páginas, precisaríamos iterar clicando em 'Próximo'.
            // Como é um MVP e a ideia é pegar processos ativos/recentes, a primeira página
            // ou ajustar a query para ordenar por data é um bom começo.
          }
        } catch (e) {
           console.warn(`⚠️ [TJMG] Erro ao extrair lista de processos da OAB: ${e}`);
        }

        const cnjList = Array.from(cnjs);
        console.log(`✅ [TJMG] Encontrados ${cnjList.length} processos para a OAB ${oabNumero}/${oabUf}`);
        return cnjList;
      },
      'busca_oab_pje',
      undefined,
    );
    return result.sucesso && result.dados ? result.dados : [];
  }

  // ─── Extração de dados ──────────────────────────────────

  /**
   * Extrai dados de um processo a partir da página de detalhes do PJe
   */
  private async extrairDadosProcesso(numeroCnj: string): Promise<ProcessoScraped> {
    if (!this.page) throw new Error('Browser não inicializado');

    const processo: ProcessoScraped = {
      numeroCnj,
      movimentacoes: [],
    };

    // Tentar extrair metadados (seletores podem variar)
    try {
      processo.classe = await this.extrairTexto(
        '#processoTrfForm\\:classeProcesso, .dadosProcesso .classe, [id*="classeJudicial"]',
      ) || undefined;

      processo.assunto = await this.extrairTexto(
        '#processoTrfForm\\:assuntoProcesso, .dadosProcesso .assunto, [id*="assuntoProcesso"]',
      ) || undefined;

      processo.vara = await this.extrairTexto(
        '#processoTrfForm\\:orgaoJulgador, .dadosProcesso .vara, [id*="orgaoJulgador"]',
      ) || undefined;

      processo.comarca = await this.extrairTexto(
        '#processoTrfForm\\:localidade, .dadosProcesso .comarca, [id*="localidade"]',
      ) || undefined;

      // Partes
      const poloAtivo = await this.extrairTextos('[id*="poloAtivo"] .nomeParteEnvolvido, .poloAtivo .nome');
      if (poloAtivo.length > 0) processo.parteAutora = poloAtivo.join(', ');

      const poloPassivo = await this.extrairTextos('[id*="poloPassivo"] .nomeParteEnvolvido, .poloPassivo .nome');
      if (poloPassivo.length > 0) processo.parteRe = poloPassivo.join(', ');
    } catch (e) {
      console.warn(`⚠️ [TJMG] Erro parcial na extração de metadados: ${e}`);
    }

    // Extrair movimentações
    try {
      // Tentar clicar na aba de movimentações
      const abaMovs = await this.page.$('[id*="timelineMovimentacoes"], [id*="abaMovimentacoes"], a[href*="movimentacao"]');
      if (abaMovs) {
        await abaMovs.click();
        await this.delayHumano(1500, 3000);
      }

      // Extrair linhas de movimentação
      const movRows = await this.page.$$('.movimentacao-item, .timeline-item, table.movimentacoes tr, .movimentacao');

      for (const row of movRows) {
        try {
          const dataText = await row.$eval(
            '.data, .dataMovimentacao, td:first-child, time',
            (el) => el.textContent?.trim() || '',
          ).catch(() => '');

          const descText = await row.$eval(
            '.descricao, .tituloMovimentacao, td:nth-child(2), .conteudo',
            (el) => el.textContent?.trim() || '',
          ).catch(() => '');

          if (dataText && descText) {
            const data = this.parseDataBrasileira(dataText);
            if (data) {
              processo.movimentacoes.push({
                data,
                descricao: descText,
                tipo: this.classificarMovimentacao(descText),
              });
            }
          }
        } catch {
          // Pular linhas com problema
        }
      }
    } catch (e) {
      console.warn(`⚠️ [TJMG] Erro ao extrair movimentações: ${e}`);
    }

    return processo;
  }

  /**
   * Extrai dados do sistema legado do TJMG
   */
  private async extrairDadosLegado(numeroCnj: string): Promise<ProcessoScraped> {
    if (!this.page) throw new Error('Browser não inicializado');

    const processo: ProcessoScraped = {
      numeroCnj,
      movimentacoes: [],
    };

    try {
      // Buscar todas as linhas da tabela de resultado
      const rows = await this.page.$$('table tr');

      for (const row of rows) {
        try {
          const cells = await row.$$('td');
          if (cells.length >= 2) {
            const dataText = await cells[0].textContent();
            const descText = await cells[1].textContent();

            if (dataText?.trim() && descText?.trim()) {
              const data = this.parseDataBrasileira(dataText.trim());
              if (data) {
                processo.movimentacoes.push({
                  data,
                  descricao: descText.trim(),
                  tipo: this.classificarMovimentacao(descText.trim()),
                });
              }
            }
          }
        } catch {
          // Pular linhas com problema
        }
      }
    } catch (e) {
      console.warn(`⚠️ [TJMG] Erro ao extrair dados legados: ${e}`);
    }

    return processo;
  }

  // ─── Utilitários ────────────────────────────────────────

  /**
   * Faz parse de data no formato brasileiro (DD/MM/AAAA ou DD/MM/AAAA HH:mm)
   */
  private parseDataBrasileira(texto: string): Date | null {
    // Extrair data do texto (pode conter outros caracteres)
    const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!match) return null;

    const [, dia, mes, ano, hora, minuto] = match;
    return new Date(
      parseInt(ano),
      parseInt(mes) - 1,
      parseInt(dia),
      parseInt(hora || '0'),
      parseInt(minuto || '0'),
    );
  }

  /**
   * Classifica movimentação por palavras-chave na descrição
   */
  private classificarMovimentacao(descricao: string): string {
    const desc = descricao.toLowerCase();
    if (desc.includes('sentença') || desc.includes('sentenca')) return 'SENTENCA';
    if (desc.includes('decisão') || desc.includes('decisao') || desc.includes('interlocutória')) return 'DECISAO';
    if (desc.includes('despacho')) return 'DESPACHO';
    if (desc.includes('intimação') || desc.includes('intimacao') || desc.includes('intimado')) return 'INTIMACAO';
    if (desc.includes('citação') || desc.includes('citacao') || desc.includes('citado')) return 'CITACAO';
    if (desc.includes('petição') || desc.includes('peticao') || desc.includes('petição inicial')) return 'PETICAO';
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

export const tjmgConsultaPublica = new TjmgConsultaPublicaScraper();
