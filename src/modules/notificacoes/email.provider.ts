/**
 * Provider de Email — Envio de notificações por email
 *
 * Responsável por:
 * - Templates HTML para emails de notificação
 * - Envio via SMTP (Gmail, Outlook, etc.)
 * - Resumo diário por email
 * - Alertas de prazos críticos
 */

import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';

// ─── Types ──────────────────────────────────────────────────

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  sucesso: boolean;
  messageId?: string;
  erro?: string;
}

// ─── Transporter ────────────────────────────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Verifica se o SMTP está configurado
 */
export function isEmailConfigured(): boolean {
  return !!(env.SMTP_USER && env.SMTP_PASS);
}

/**
 * Testa a conexão SMTP
 */
export async function testarConexaoEmail(): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    await getTransporter().verify();
    console.log('✅ Conexão SMTP verificada');
    return true;
  } catch (error) {
    console.error('❌ Falha na conexão SMTP:', error);
    return false;
  }
}

// ─── Envio ──────────────────────────────────────────────────

/**
 * Envia um email
 */
export async function enviarEmail(options: EmailOptions): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    return { sucesso: false, erro: 'SMTP não configurado' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.subject,
    });

    console.log(`📧 Email enviado para ${options.to}: ${info.messageId}`);
    return { sucesso: true, messageId: info.messageId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Erro ao enviar email para ${options.to}: ${msg}`);
    return { sucesso: false, erro: msg };
  }
}

// ─── Templates ──────────────────────────────────────────────

const BASE_STYLES = `
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
  .header h1 { color: #38bdf8; margin: 0; font-size: 22px; }
  .header p { color: #94a3b8; margin: 8px 0 0 0; font-size: 14px; }
  .content { background: #1e293b; padding: 24px; border-radius: 0 0 12px 12px; }
  .alert-box { padding: 16px; border-radius: 8px; margin: 16px 0; }
  .alert-urgente { background: rgba(239, 68, 68, 0.15); border-left: 4px solid #ef4444; }
  .alert-alta { background: rgba(251, 191, 36, 0.15); border-left: 4px solid #fbbf24; }
  .alert-normal { background: rgba(59, 130, 246, 0.15); border-left: 4px solid #3b82f6; }
  .alert-baixa { background: rgba(34, 197, 94, 0.15); border-left: 4px solid #22c55e; }
  .processo { font-family: monospace; color: #38bdf8; font-weight: bold; }
  .data { color: #94a3b8; font-size: 13px; }
  .btn { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 16px; }
  .footer { text-align: center; padding: 20px; color: #64748b; font-size: 12px; }
  .divider { border-top: 1px solid #334155; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #94a3b8; padding: 8px; border-bottom: 1px solid #334155; font-size: 13px; }
  td { padding: 8px; border-bottom: 1px solid #1e293b; font-size: 14px; }
`;

/**
 * Template: Nova Movimentação
 */
export function templateNovaMovimentacao(params: {
  nomeAdvogado: string;
  numeroCnj: string;
  classe: string;
  descricaoMov: string;
  dataMov: Date;
  dashboardUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html><head><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Nova Movimentação</h1>
      <p>Moreira e Xavier — Acompanhamento Processual</p>
    </div>
    <div class="content">
      <p>Olá, <strong>${params.nomeAdvogado}</strong>,</p>
      <p>O processo abaixo teve uma nova movimentação:</p>
      
      <div class="alert-box alert-normal">
        <p><strong>Processo:</strong> <span class="processo">${params.numeroCnj}</span></p>
        <p><strong>Classe:</strong> ${params.classe}</p>
        <p class="data">Data: ${params.dataMov.toLocaleDateString('pt-BR')}</p>
        <div class="divider"></div>
        <p>${params.descricaoMov}</p>
      </div>
      
      <a href="${params.dashboardUrl}" class="btn">Ver no Painel</a>
    </div>
    <div class="footer">
      <p>Moreira e Xavier Advogados — Sistema Automatizado</p>
      <p>Este é um email automático. Não responda.</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Template: Alerta de Prazo
 */
export function templateAlertaPrazo(params: {
  nomeAdvogado: string;
  numeroCnj: string;
  classe: string;
  descricaoPrazo: string;
  dataVencimento: Date;
  diasRestantes: number;
  prioridade: 'URGENTE' | 'ALTA' | 'NORMAL';
  dashboardUrl: string;
}): string {
  const alertClass = params.prioridade === 'URGENTE' ? 'alert-urgente'
    : params.prioridade === 'ALTA' ? 'alert-alta' : 'alert-normal';

  const emoji = params.prioridade === 'URGENTE' ? '🚨'
    : params.prioridade === 'ALTA' ? '⚠️' : '⏰';

  const titulo = params.prioridade === 'URGENTE' ? 'PRAZO CRÍTICO'
    : params.prioridade === 'ALTA' ? 'Prazo Próximo' : 'Lembrete de Prazo';

  return `
<!DOCTYPE html>
<html><head><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header">
      <h1>${emoji} ${titulo}</h1>
      <p>Moreira e Xavier — Acompanhamento Processual</p>
    </div>
    <div class="content">
      <p>Olá, <strong>${params.nomeAdvogado}</strong>,</p>
      <p>${params.prioridade === 'URGENTE' ? '<strong style="color:#ef4444">AÇÃO IMEDIATA NECESSÁRIA!</strong>' : 'Você tem um prazo se aproximando:'}</p>
      
      <div class="alert-box ${alertClass}">
        <p><strong>Processo:</strong> <span class="processo">${params.numeroCnj}</span></p>
        <p><strong>Classe:</strong> ${params.classe}</p>
        <p><strong>Prazo:</strong> ${params.descricaoPrazo}</p>
        <p><strong>Vencimento:</strong> ${params.dataVencimento.toLocaleDateString('pt-BR')}</p>
        <p><strong style="font-size: 18px;">${params.diasRestantes} dia(s) útil(eis) restante(s)</strong></p>
      </div>
      
      <a href="${params.dashboardUrl}" class="btn">Ver no Painel</a>
    </div>
    <div class="footer">
      <p>Moreira e Xavier Advogados — Sistema Automatizado</p>
      <p>Este é um email automático. Não responda.</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Template: Resumo Diário
 */
export function templateResumoDiario(params: {
  nomeAdvogado: string;
  data: Date;
  novasMovimentacoes: number;
  prazosProximos: Array<{
    numeroCnj: string;
    descricao: string;
    dataVencimento: Date;
    diasRestantes: number;
  }>;
  prazosVencidos: number;
  totalProcessos: number;
  dashboardUrl: string;
}): string {
  const prazosHtml = params.prazosProximos.map((p) => `
    <tr>
      <td><span class="processo">${p.numeroCnj}</span></td>
      <td>${p.descricao}</td>
      <td>${p.dataVencimento.toLocaleDateString('pt-BR')}</td>
      <td><strong>${p.diasRestantes}d</strong></td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html><head><style>${BASE_STYLES}</style></head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Resumo Diário</h1>
      <p>${params.data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>
    <div class="content">
      <p>Olá, <strong>${params.nomeAdvogado}</strong>!</p>
      
      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0;">
        <div class="alert-box alert-normal" style="flex: 1; min-width: 120px; text-align: center;">
          <p style="font-size: 28px; margin: 0;">${params.totalProcessos}</p>
          <p style="font-size: 12px; margin: 4px 0 0 0;">Processos</p>
        </div>
        <div class="alert-box alert-baixa" style="flex: 1; min-width: 120px; text-align: center;">
          <p style="font-size: 28px; margin: 0;">${params.novasMovimentacoes}</p>
          <p style="font-size: 12px; margin: 4px 0 0 0;">Movimentações</p>
        </div>
        <div class="alert-box ${params.prazosVencidos > 0 ? 'alert-urgente' : 'alert-alta'}" style="flex: 1; min-width: 120px; text-align: center;">
          <p style="font-size: 28px; margin: 0;">${params.prazosVencidos}</p>
          <p style="font-size: 12px; margin: 4px 0 0 0;">Prazos Vencidos</p>
        </div>
      </div>

      ${params.prazosProximos.length > 0 ? `
      <h3 style="color: #fbbf24;">⏰ Prazos Próximos</h3>
      <table>
        <tr><th>Processo</th><th>Prazo</th><th>Vencimento</th><th>Dias</th></tr>
        ${prazosHtml}
      </table>
      ` : '<p style="color: #22c55e;">✅ Nenhum prazo próximo!</p>'}
      
      <a href="${params.dashboardUrl}" class="btn">Acessar Painel</a>
    </div>
    <div class="footer">
      <p>Moreira e Xavier Advogados — Sistema Automatizado</p>
      <p>Este é um email automático. Não responda.</p>
    </div>
  </div>
</body></html>`;
}
