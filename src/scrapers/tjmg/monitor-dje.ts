/**
 * Monitor DJE/DJEN — Diário de Justiça Eletrônico
 *
 * Monitora o Diário de Justiça Eletrônico do TJMG para
 * detectar publicações relacionadas aos processos do advogado.
 *
 * O DJE do TJMG é publicado diariamente (dias úteis) e contém:
 * - Intimações
 * - Citações por edital
 * - Decisões
 * - Sentenças
 * - Pautas de audiências
 *
 * URLs:
 * - DJEN: https://www.djeonline.tjmg.jus.br/
 * - DJE TJMG: https://dje.tjmg.jus.br/
 */

import {
  BaseScraper,
  type ScrapingResult,
} from '../base/base-scraper.js';
import { prisma } from '../../config/database.js';
import type { SistemaOrigem } from '@prisma/client';

// ─── Constantes ─────────────────────────────────────────────

const URLS = {
  DJE_TJMG: 'https://dje.tjmg.jus.br/',
  DJEN: 'https://www.djeonline.tjmg.jus.br/',
};

// ─── Types ──────────────────────────────────────────────────

export interface PublicacaoDJE {
  data: Date;
  caderno: string;           // Ex: "Caderno 1 - Diário do Executivo"
  pagina?: number;
  conteudo: string;          // Trecho da publicação
  processosRelacionados: string[]; // Números CNJ encontrados no texto
  termosBuscados: string[];  // Termos que deram match
}

// ─── Monitor ────────────────────────────────────────────────

export class MonitorDJE extends BaseScraper {
  readonly tribunalSigla = 'TJMG';
  readonly sistemaOrigem: SistemaOrigem = 'DJEN';
  readonly nomeCompleto = 'Diário de Justiça Eletrônico - TJMG';

  /**
   * Busca publicações do DJE por termos (nome do advogado, OAB, etc.)
   */
  async buscarPublicacoes(
    termos: string[],
    data?: Date,
  ): Promise<ScrapingResult<PublicacaoDJE[]>> {
    return this.executar(
      async () => {
        console.log(`📰 [DJE/TJMG] Buscando publicações para ${termos.length} termo(s)...`);

        await this.navegarPara(URLS.DJE_TJMG);
        await this.delayHumano(2000, 4000);

        const publicacoes: PublicacaoDJE[] = [];

        for (const termo of termos) {
          try {
            // Preencher campo de busca
            await this.esperarElemento('input[type="text"], input[name*="pesquisa"], #txtPesquisa', 10000);
            await this.preencherCampo(
              'input[type="text"], input[name*="pesquisa"], #txtPesquisa',
              termo,
            );

            // Se houver campo de data, preencher
            if (data) {
              const dataFormatada = data.toLocaleDateString('pt-BR');
              const campoData = await this.page!.$('input[type="date"], input[name*="data"], #txtData');
              if (campoData) {
                await campoData.fill(dataFormatada);
              }
            }

            // Clicar em pesquisar
            await this.delayHumano(500, 1200);
            await this.clicar('button[type="submit"], input[type="submit"], #btnPesquisar');
            await this.delayHumano(3000, 5000);

            // Extrair resultados
            const resultados = await this.page!.$$('.resultado, .resultado-item, .publicacao, tr.resultado');

            for (const resultado of resultados) {
              try {
                const conteudo = await resultado.textContent();
                if (!conteudo?.trim()) continue;

                // Extrair números CNJ do texto
                const processosCnj = this.extrairNumerosCnj(conteudo);

                // Extrair data da publicação
                const dataMatch = conteudo.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                const dataPub = dataMatch
                  ? new Date(parseInt(dataMatch[3]), parseInt(dataMatch[2]) - 1, parseInt(dataMatch[1]))
                  : data || new Date();

                // Extrair caderno
                const cadernoMatch = conteudo.match(/Caderno\s+\d+[^,\n]*/i);
                const caderno = cadernoMatch ? cadernoMatch[0] : 'Diário da Justiça';

                publicacoes.push({
                  data: dataPub,
                  caderno,
                  conteudo: conteudo.trim().substring(0, 1000), // Limitar tamanho
                  processosRelacionados: processosCnj,
                  termosBuscados: [termo],
                });
              } catch {
                // Pular resultado com problema
              }
            }

            // Delay entre buscas
            await this.delayHumano(2000, 4000);
          } catch (e) {
            console.warn(`⚠️ [DJE/TJMG] Erro ao buscar "${termo}": ${e}`);
          }
        }

        console.log(`✅ [DJE/TJMG] ${publicacoes.length} publicação(ões) encontrada(s)`);
        return publicacoes;
      },
      'busca_dje',
    );
  }

  /**
   * Monitora o DJE para um advogado específico
   * Busca por nome completo e número da OAB
   */
  async monitorarAdvogado(
    advogadoId: string,
  ): Promise<ScrapingResult<PublicacaoDJE[]>> {
    // Buscar dados do advogado
    const advogado = await prisma.advogado.findUnique({
      where: { id: advogadoId },
    });

    if (!advogado) {
      return { sucesso: false, erro: 'Advogado não encontrado', tempoMs: 0 };
    }

    // Termos de busca: nome completo + OAB
    const termos = [
      advogado.nome,
      `OAB/${advogado.oabUf} ${advogado.oabNumero}`,
    ];

    return this.buscarPublicacoes(termos, new Date());
  }

  // ─── Utilitários ────────────────────────────────────────

  /**
   * Extrai números de processo no formato CNJ de um texto
   */
  private extrairNumerosCnj(texto: string): string[] {
    const regex = /\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}/g;
    const matches = texto.match(regex);
    return matches ? [...new Set(matches)] : [];
  }
}

// ─── Singleton ──────────────────────────────────────────────

export const monitorDJE = new MonitorDJE();
