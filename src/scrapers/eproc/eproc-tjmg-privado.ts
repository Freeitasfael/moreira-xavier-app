import { BaseScraper, type ScrapingResult, type ProcessoScraped } from '../base/base-scraper.js';
import type { SistemaOrigem } from '@prisma/client';

export class EprocTjmgPrivadoScraper extends BaseScraper {
  readonly tribunalSigla = 'TJMG';
  readonly sistemaOrigem: SistemaOrigem = 'EPROC_TJMG';
  readonly nomeCompleto = 'Tribunal de Justiça de Minas Gerais - eproc (Logado)';

  private loginUrl = 'https://eproc.tjmg.jus.br/eproc/';

  private loginName: string;
  private loginPass: string;

  constructor(login: string, pass: string) {
    super();
    this.loginName = login;
    this.loginPass = pass;
  }

  /**
   * Realiza o login na plataforma e busca as movimentações de um processo
   */
  async buscarProcessoLogado(numeroCnj: string): Promise<ScrapingResult<ProcessoScraped>> {
    return this.executar(
      async () => {
        console.log(`🔒 [Eproc TJMG] Iniciando busca autenticada para ${numeroCnj}...`);
        
        // 1. Acessar página de login
        await this.navegarPara(this.loginUrl);

        // 2. Preencher credenciais
        // O Eproc geralmente usa txtUsuario e pwdSenha, mas faremos seletores robustos
        await this.esperarElemento('input[type="text"], input[id*="Usu"]', 10000);
        
        // No Eproc, geralmente o id é txtUsuario e pwdSenha
        const userInput = await this.page?.$('input[id="txtUsuario"]') ? 'input[id="txtUsuario"]' : 'input[type="text"]:visible';
        const passInput = await this.page?.$('input[id="pwdSenha"]') ? 'input[id="pwdSenha"]' : 'input[type="password"]:visible';
        const submitBtn = await this.page?.$('button[id="sbmEntrar"]') ? 'button[id="sbmEntrar"]' : 'button[type="submit"], button:has-text("Entrar")';

        await this.preencherCampo(userInput, this.loginName);
        await this.preencherCampo(passInput, this.loginPass);

        // 3. Clicar em Entrar
        await this.clicar(submitBtn);

        // 4. Aguardar carregamento do painel (verificando se o login falhou)
        // Se houver uma mensagem de erro na tela de login
        try {
          await this.page?.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
        } catch (e) {
          // Verifica se não tem um alerta de senha incorreta
          const erroText = await this.extrairTexto('.infraMensagemErro, .alert-danger');
          if (erroText) {
            throw new Error(`Falha no login Eproc: ${erroText}`);
          }
        }

        console.log(`🔓 [Eproc TJMG] Login realizado com sucesso.`);

        // 5. Pesquisar pelo processo no painel logado
        // A busca rápida geralmente fica num input no header
        const searchInput = 'input[id="txtNumProcessoPesquisaRapida"], input[placeholder*="Número do Processo"]';
        
        // Se não houver campo de pesquisa rápida, teríamos que navegar para a tela de consulta.
        // Vamos supor que precisamos ir para a rota de consulta de processo.
        // O Eproc tem menus infraMenu, mas podemos usar a URL direta se soubermos, ou buscar a barra.
        const cnjLimpo = numeroCnj.replace(/\D/g, '');
        
        // Tentativa de usar a pesquisa rápida
        const searchExists = await this.page?.$(searchInput);
        if (searchExists) {
           await this.preencherCampo(searchInput, cnjLimpo);
           await this.page?.keyboard.press('Enter');
        } else {
           throw new Error('Campo de pesquisa rápida não encontrado no painel.');
        }

        // 6. Esperar a tela do processo carregar
        await this.page?.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // 7. Extrair dados
        // Este é um extrator simplificado para o exemplo, em um cenário real mapearíamos todos os IDs do Eproc
        const classeStr = await this.extrairTexto('td:has-text("Classe:") + td, span:has-text("Classe:") + span');
        const assuntoStr = await this.extrairTexto('td:has-text("Assunto:") + td, span:has-text("Assunto:") + span');
        
        // Extrair movimentações
        const movimentacoes = [];
        const linhasEventos = await this.page?.$$('tr[id^="trEvento"]');
        
        if (linhasEventos) {
          for (const linha of linhasEventos) {
            const cols = await linha.$$('td');
            if (cols.length >= 3) {
              const dataTexto = await cols[0].textContent(); // Ex: 01/01/2026 14:00
              const descTexto = await cols[2].textContent(); // Ex: Juntada de Petição
              
              if (dataTexto && descTexto) {
                // Parse simplificado
                const [dataStr, horaStr] = dataTexto.trim().split(' ');
                const [d, m, y] = (dataStr || '').split('/');
                const [hr, min] = (horaStr || '00:00').split(':');
                
                if (d && m && y) {
                  const dataMov = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hr), parseInt(min));
                  movimentacoes.push({
                    data: dataMov,
                    descricao: descTexto.trim(),
                    tipo: descTexto.trim().substring(0, 50)
                  });
                }
              }
            }
          }
        }

        console.log(`✅ [Eproc TJMG Privado] ${numeroCnj}: Extraídas ${movimentacoes.length} movimentações`);

        return {
          numeroCnj,
          classe: classeStr || 'N/A',
          assunto: assuntoStr || undefined,
          status: 'ATIVO',
          movimentacoes
        };
      },
      'eproc_busca_logada',
      undefined
    );
  }
}
