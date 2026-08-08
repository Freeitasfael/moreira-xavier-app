/**
 * Scraper TJMG Autenticado — Acesso ao PJe com credenciais de advogado
 *
 * Acessa o sistema PJe do TJMG com login e senha do advogado
 * para obter informações privilegiadas:
 * - Processos em segredo de justiça
 * - Detalhes de intimações
 * - Documentos e petições
 * - Prazos do advogado
 *
 * URL de Login: https://pje.tjmg.jus.br/pje/login.seam
 *
 * ⚠️ ÉTICA: O acesso é feito com as credenciais do próprio
 * advogado que representa a parte, não havendo qualquer
 * infração ética ou legal (Art. 7º, XIII, do Estatuto da OAB).
 */

import {
  BaseScraper,
  type ProcessoScraped,
  type MovimentacaoScraped,
  type ScrapingResult,
} from '../base/base-scraper.js';
import { decrypt } from '../../config/crypto.js';
import { prisma } from '../../config/database.js';
import type { SistemaOrigem } from '@prisma/client';

// ─── Constantes ─────────────────────────────────────────────

const URLS = {
  LOGIN: 'https://pje.tjmg.jus.br/pje/login.seam',
  PAINEL: 'https://pje.tjmg.jus.br/pje/Painel/painel_usuario/advogado.seam',
  PROCESSO_DETALHE: 'https://pje.tjmg.jus.br/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam',
};

// ─── Types ──────────────────────────────────────────────────

interface IntimacaoScraped {
  data: Date;
  processo: string;
  descricao: string;
  prazo?: string;
  lida: boolean;
}

interface PainelAdvogado {
  intimacoesPendentes: IntimacaoScraped[];
  processosRecentes: Array<{
    numeroCnj: string;
    ultimaMovimentacao?: string;
    dataUltimaMovimentacao?: Date;
  }>;
}

// ─── Scraper Autenticado ────────────────────────────────────

export class TjmgAutenticadoScraper extends BaseScraper {
  readonly tribunalSigla = 'TJMG';
  readonly sistemaOrigem: SistemaOrigem = 'EPROC_TJMG';
  readonly nomeCompleto = 'TJMG PJe - Acesso Autenticado';

  private loggedIn = false;

  /**
   * Faz login no PJe TJMG com credenciais do advogado
   */
  async login(advogadoId: string): Promise<boolean> {
    // Buscar credenciais criptografadas
    const credencial = await prisma.credencialTribunal.findFirst({
      where: {
        advogadoId,
        tribunal: 'EPROC_TJMG',
        ativo: true,
      },
    });

    if (!credencial) {
      console.warn(`⚠️ [TJMG] Nenhuma credencial encontrada para o advogado`);
      return false;
    }

    // Descriptografar credenciais
    const login = decrypt(credencial.loginEnc);
    const senha = decrypt(credencial.senhaEnc);

    try {
      // Navegar para página de login
      await this.navegarPara(URLS.LOGIN);

      // Esperar formulário de login
      await this.esperarElemento('#username', 15000);

      // Preencher credenciais
      await this.preencherCampo('#username', login);
      await this.delayHumano(500, 1000);
      await this.preencherCampo('#password', senha);

      // Clicar em entrar
      await this.delayHumano(800, 1500);
      await this.clicar('#btnEntrar, button[type="submit"]');

      // Esperar redirecionamento para o painel
      await this.delayHumano(3000, 5000);

      // Verificar se login foi bem-sucedido
      const urlAtual = this.page?.url() || '';
      const erroLogin = await this.extrairTexto('.error-message, .mensagemErro, .alert-danger');

      if (erroLogin || urlAtual.includes('login')) {
        console.error(`❌ [TJMG] Falha no login: ${erroLogin || 'Credenciais inválidas'}`);

        // Atualizar status da credencial
        await prisma.credencialTribunal.update({
          where: { id: credencial.id },
          data: { ativo: false },
        });

        return false;
      }

      // Login bem-sucedido
      this.loggedIn = true;

      // Atualizar último acesso
      await prisma.credencialTribunal.update({
        where: { id: credencial.id },
        data: { ultimoAcesso: new Date() },
      });

      console.log(`✅ [TJMG] Login realizado com sucesso`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ [TJMG] Erro no login: ${msg}`);
      return false;
    }
  }

  /**
   * Coleta intimações pendentes do painel do advogado
   */
  async coletarIntimacoes(advogadoId: string): Promise<ScrapingResult<IntimacaoScraped[]>> {
    return this.executar(
      async () => {
        // Fazer login
        const logado = await this.login(advogadoId);
        if (!logado) throw new Error('Não foi possível fazer login no PJe TJMG');

        // Navegar para o painel
        await this.navegarPara(URLS.PAINEL);
        await this.delayHumano(2000, 4000);

        // Clicar na seção de intimações
        try {
          await this.clicar('[id*="intimacoes"], a[href*="intimac"]');
          await this.delayHumano(2000, 3000);
        } catch {
          console.log('ℹ️ [TJMG] Seção de intimações não encontrada, tentando extrair diretamente');
        }

        // Extrair intimações
        const intimacoes: IntimacaoScraped[] = [];

        const rows = await this.page!.$$('.intimacao-item, tr.intimacao, .list-group-item');

        for (const row of rows) {
          try {
            const dataText = await row.$eval(
              '.data, .dataIntimacao, td:first-child',
              (el) => el.textContent?.trim() || '',
            ).catch(() => '');

            const descText = await row.$eval(
              '.descricao, .textoIntimacao, td:nth-child(2)',
              (el) => el.textContent?.trim() || '',
            ).catch(() => '');

            const processoText = await row.$eval(
              '.processo, .numeroProcesso, a[href*="processo"]',
              (el) => el.textContent?.trim() || '',
            ).catch(() => '');

            if (dataText || descText) {
              const data = this.parseDataBr(dataText);
              intimacoes.push({
                data: data || new Date(),
                processo: processoText,
                descricao: descText,
                lida: false,
              });
            }
          } catch {
            // Pular linhas problemáticas
          }
        }

        console.log(`✅ [TJMG] ${intimacoes.length} intimação(ões) coletada(s)`);
        return intimacoes;
      },
      'coleta_intimacoes',
    );
  }

  /**
   * Consulta um processo autenticado (inclui processos em segredo de justiça)
   */
  async consultarProcessoAutenticado(
    advogadoId: string,
    numeroCnj: string,
  ): Promise<ScrapingResult<ProcessoScraped>> {
    return this.executar(
      async () => {
        // Fazer login
        const logado = await this.login(advogadoId);
        if (!logado) throw new Error('Não foi possível fazer login no PJe TJMG');

        console.log(`🔍 [TJMG/Auth] Consultando ${numeroCnj}...`);

        // Ir para busca de processos
        await this.navegarPara(URLS.PROCESSO_DETALHE);
        await this.delayHumano(1500, 3000);

        // Buscar o processo
        const numeroLimpo = numeroCnj.replace(/\D/g, '');

        await this.esperarElemento('[id*="numProcesso"], input[name*="processo"]', 10000);
        await this.preencherCampo(
          '[id*="numProcesso"], input[name*="processo"]',
          numeroLimpo,
        );

        await this.delayHumano(500, 1200);
        await this.clicar('[id*="pesquisar"], button[type="submit"]');
        await this.delayHumano(3000, 5000);

        // Extrair dados completos do processo
        const processo: ProcessoScraped = {
          numeroCnj,
          movimentacoes: [],
        };

        // Extrair metadados
        try {
          processo.classe = await this.extrairTexto('[id*="classeJudicial"]') || undefined;
          processo.assunto = await this.extrairTexto('[id*="assuntoProcesso"]') || undefined;
          processo.vara = await this.extrairTexto('[id*="orgaoJulgador"]') || undefined;
          processo.comarca = await this.extrairTexto('[id*="localidade"]') || undefined;

          // Partes (visão autenticada pode ter mais detalhes)
          const poloAtivo = await this.extrairTextos('[id*="poloAtivo"] .nome');
          if (poloAtivo.length > 0) processo.parteAutora = poloAtivo.join(', ');

          const poloPassivo = await this.extrairTextos('[id*="poloPassivo"] .nome');
          if (poloPassivo.length > 0) processo.parteRe = poloPassivo.join(', ');
        } catch (e) {
          console.warn(`⚠️ [TJMG/Auth] Extração parcial: ${e}`);
        }

        // Extrair movimentações (visão autenticada tem mais detalhes)
        try {
          // Clicar na aba de movimentações
          const abaMovs = await this.page!.$('[id*="timelineMovimentacoes"], [id*="movimentacao"]');
          if (abaMovs) {
            await abaMovs.click();
            await this.delayHumano(2000, 3000);
          }

          const movRows = await this.page!.$$('.movimentacao-item, .timeline-item, tr.movimentacao');

          for (const row of movRows) {
            try {
              const dataText = await row.$eval(
                '.data, time, td:first-child',
                (el) => el.textContent?.trim() || '',
              ).catch(() => '');

              const descText = await row.$eval(
                '.descricao, .conteudo, td:nth-child(2)',
                (el) => el.textContent?.trim() || '',
              ).catch(() => '');

              if (dataText && descText) {
                const data = this.parseDataBr(dataText);
                if (data) {
                  processo.movimentacoes.push({
                    data,
                    descricao: descText,
                    tipo: this.classificarMov(descText),
                  });
                }
              }
            } catch {
              // Pular
            }
          }
        } catch (e) {
          console.warn(`⚠️ [TJMG/Auth] Erro nas movimentações: ${e}`);
        }

        console.log(
          `✅ [TJMG/Auth] ${numeroCnj}: ${processo.movimentacoes.length} movimentação(ões)`,
        );

        return processo;
      },
      'consulta_autenticada',
    );
  }

  // ─── Utilitários ────────────────────────────────────────

  private parseDataBr(texto: string): Date | null {
    const match = texto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (!match) return null;
    const [, dia, mes, ano, hora, minuto] = match;
    return new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia), parseInt(hora || '0'), parseInt(minuto || '0'));
  }

  private classificarMov(descricao: string): string {
    const desc = descricao.toLowerCase();
    if (desc.includes('sentença') || desc.includes('sentenca')) return 'SENTENCA';
    if (desc.includes('decisão') || desc.includes('decisao')) return 'DECISAO';
    if (desc.includes('despacho')) return 'DESPACHO';
    if (desc.includes('intimação') || desc.includes('intimacao') || desc.includes('intimado')) return 'INTIMACAO';
    if (desc.includes('citação') || desc.includes('citacao')) return 'CITACAO';
    if (desc.includes('petição') || desc.includes('peticao')) return 'PETICAO';
    if (desc.includes('juntada')) return 'JUNTADA';
    if (desc.includes('audiência') || desc.includes('audiencia')) return 'AUDIENCIA';
    if (desc.includes('distribui')) return 'DISTRIBUICAO';
    if (desc.includes('recurso') || desc.includes('apelação') || desc.includes('agravo')) return 'RECURSO';
    if (desc.includes('baixa') || desc.includes('arquiv')) return 'BAIXA';
    if (desc.includes('remessa')) return 'REMESSA';
    if (desc.includes('acórdão') || desc.includes('acordao')) return 'ACORDAO';
    return 'OUTROS';
  }
}

// ─── Singleton ──────────────────────────────────────────────

export const tjmgAutenticado = new TjmgAutenticadoScraper();
