/**
 * BaseScraper — Classe abstrata para scrapers de tribunais
 *
 * Fornece a infraestrutura comum para todos os scrapers:
 * - Gerenciamento de browser/contexto Playwright
 * - Rotação de User-Agent
 * - Delays aleatórios anti-detecção
 * - Captura de screenshots para debug
 * - Logging estruturado
 * - Tratamento de erros
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../../config/env.js';
import { randomDelay, sleep } from '../../shared/utils/retry.js';
import { prisma } from '../../config/database.js';
import type { SistemaOrigem } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────

export interface ScraperConfig {
  headless: boolean;
  timeout: number;        // Timeout geral (ms)
  delayMin: number;       // Delay mínimo entre ações (ms)
  delayMax: number;       // Delay máximo entre ações (ms)
  maxRetries: number;
  screenshotOnError: boolean;
}

export interface ScrapingResult<T = unknown> {
  sucesso: boolean;
  dados?: T;
  erro?: string;
  tempoMs: number;
  screenshots?: string[];
}

export interface MovimentacaoScraped {
  data: Date;
  descricao: string;
  tipo: string;
  complemento?: string;
  codigo?: number;
}

export interface ProcessoScraped {
  numeroCnj: string;
  classe?: string;
  assunto?: string;
  comarca?: string;
  vara?: string;
  parteAutora?: string;
  parteRe?: string;
  valorCausa?: number;
  status?: string;
  movimentacoes: MovimentacaoScraped[];
}

// ─── User-Agents realistas ──────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── BaseScraper ────────────────────────────────────────────

export abstract class BaseScraper {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected config: ScraperConfig;
  protected screenshots: string[] = [];

  // Subclasses devem definir:
  abstract readonly tribunalSigla: string;
  abstract readonly sistemaOrigem: SistemaOrigem;
  abstract readonly nomeCompleto: string;

  constructor(config?: Partial<ScraperConfig>) {
    this.config = {
      headless: env.SCRAPING_HEADLESS,
      timeout: 30000,
      delayMin: env.SCRAPING_DELAY_MIN,
      delayMax: env.SCRAPING_DELAY_MAX,
      maxRetries: 2,
      screenshotOnError: true,
      ...config,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────

  /**
   * Inicializa o browser e cria um contexto limpo
   */
  async iniciar(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: randomUserAgent(),
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      // Desabilitar webdriver flag para evitar detecção
      javaScriptEnabled: true,
    });

    // Remover sinal de automação
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeout);

    console.log(`🌐 [${this.tribunalSigla}] Browser inicializado`);
  }

  /**
   * Fecha o browser e limpa recursos
   */
  async finalizar(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;

    console.log(`🔌 [${this.tribunalSigla}] Browser finalizado`);
  }

  // ─── Helpers de navegação ───────────────────────────────

  /**
   * Navega para uma URL com delay humano
   */
  protected async navegarPara(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser não inicializado');

    await this.delayHumano();
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.timeout,
    });
  }

  /**
   * Preenche um campo com digitação humana (caractere por caractere)
   */
  protected async preencherCampo(selector: string, valor: string): Promise<void> {
    if (!this.page) throw new Error('Browser não inicializado');

    await this.page.waitForSelector(selector, { state: 'visible' });
    await this.page.click(selector);
    await this.page.fill(selector, ''); // Limpar campo
    // Digitar caractere por caractere com delay
    for (const char of valor) {
      await this.page.type(selector, char, { delay: 50 + Math.random() * 100 });
    }
  }

  /**
   * Clica em um elemento com delay humano
   */
  protected async clicar(selector: string): Promise<void> {
    if (!this.page) throw new Error('Browser não inicializado');

    await this.page.waitForSelector(selector, { state: 'visible' });
    await this.delayHumano(300, 800);
    await this.page.click(selector);
  }

  /**
   * Espera um seletor aparecer na página
   */
  protected async esperarElemento(selector: string, timeout?: number): Promise<void> {
    if (!this.page) throw new Error('Browser não inicializado');
    await this.page.waitForSelector(selector, {
      state: 'visible',
      timeout: timeout || this.config.timeout,
    });
  }

  /**
   * Extrai texto de um elemento
   */
  protected async extrairTexto(selector: string): Promise<string | null> {
    if (!this.page) throw new Error('Browser não inicializado');

    try {
      const element = await this.page.$(selector);
      if (!element) return null;
      const text = await element.textContent();
      return text?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai múltiplos textos de elementos
   */
  protected async extrairTextos(selector: string): Promise<string[]> {
    if (!this.page) throw new Error('Browser não inicializado');

    const elements = await this.page.$$(selector);
    const textos: string[] = [];

    for (const el of elements) {
      const text = await el.textContent();
      if (text?.trim()) textos.push(text.trim());
    }

    return textos;
  }

  // ─── Anti-detecção ──────────────────────────────────────

  /**
   * Delay aleatório simulando comportamento humano
   */
  protected async delayHumano(minMs?: number, maxMs?: number): Promise<void> {
    await randomDelay(
      minMs || this.config.delayMin,
      maxMs || this.config.delayMax,
    );
  }

  /**
   * Scroll suave para simular leitura
   */
  protected async scrollHumano(): Promise<void> {
    if (!this.page) return;

    const scrollAmount = 200 + Math.floor(Math.random() * 300);
    await this.page.evaluate((amount) => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);
    await sleep(500 + Math.random() * 1000);
  }

  // ─── Debug e logging ────────────────────────────────────

  /**
   * Captura screenshot para debug
   */
  protected async capturarScreenshot(nome: string): Promise<string | null> {
    if (!this.page) return null;

    try {
      const timestamp = Date.now();
      const filename = `screenshots/${this.tribunalSigla}_${nome}_${timestamp}.png`;
      await this.page.screenshot({ path: filename, fullPage: true });
      this.screenshots.push(filename);
      return filename;
    } catch {
      return null;
    }
  }

  /**
   * Registra log de scraping no banco
   */
  protected async registrarLog(
    acao: string,
    processoId: string | null,
    sucesso: boolean,
    tempoMs: number,
    erro?: string,
    detalhes?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await prisma.logScraping.create({
        data: {
          tribunal: this.tribunalSigla,
          sistema: this.sistemaOrigem,
          acao,
          processoId,
          sucesso,
          tempoMs,
          erro: erro || null,
          detalhes: detalhes ? JSON.stringify(detalhes) : null,
        },
      });
    } catch (e) {
      console.error(`[${this.tribunalSigla}] Erro ao registrar log:`, e);
    }
  }

  // ─── Execução com proteção ──────────────────────────────

  /**
   * Executa uma operação de scraping com tratamento de erros,
   * retry automático e gerenciamento do browser.
   */
  async executar<T>(
    operacao: () => Promise<T>,
    nomeOperacao: string,
    processoId?: string,
  ): Promise<ScrapingResult<T>> {
    const startTime = Date.now();
    this.screenshots = [];

    for (let tentativa = 1; tentativa <= this.config.maxRetries + 1; tentativa++) {
      try {
        await this.iniciar();
        const dados = await operacao();
        const tempoMs = Date.now() - startTime;

        await this.registrarLog(nomeOperacao, processoId || null, true, tempoMs);

        return {
          sucesso: true,
          dados,
          tempoMs,
          screenshots: this.screenshots,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Capturar screenshot do erro
        if (this.config.screenshotOnError) {
          await this.capturarScreenshot(`error_${nomeOperacao}_t${tentativa}`);
        }

        if (tentativa > this.config.maxRetries) {
          const tempoMs = Date.now() - startTime;
          await this.registrarLog(nomeOperacao, processoId || null, false, tempoMs, errorMsg);

          console.error(
            `❌ [${this.tribunalSigla}] ${nomeOperacao} falhou após ${tentativa} tentativas: ${errorMsg}`,
          );

          return {
            sucesso: false,
            erro: errorMsg,
            tempoMs,
            screenshots: this.screenshots,
          };
        }

        console.warn(
          `⚠️ [${this.tribunalSigla}] ${nomeOperacao} tentativa ${tentativa} falhou: ${errorMsg}`,
        );

        await this.delayHumano(5000, 10000);
      } finally {
        await this.finalizar();
      }
    }

    // Nunca deveria chegar aqui
    return { sucesso: false, erro: 'Erro desconhecido', tempoMs: Date.now() - startTime };
  }
}
