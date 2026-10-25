import { describe, it, expect } from 'vitest';
import {
  templateNovaMovimentacao,
  templateAlertaPrazo,
  isEmailConfigured,
} from '../src/modules/notificacoes/email.provider.js';

describe('Notificações e Templates de Email', () => {
  it('deve gerar template HTML de nova movimentação com dados corretos', () => {
    const html = templateNovaMovimentacao({
      nomeAdvogado: 'Dr. Moreira',
      numeroCnj: '5014928-36.2025.8.13.0686',
      classe: 'Procedimento Comum',
      descricaoMov: 'Publicado despacho com determinação de prazo',
      dataMov: new Date(2025, 1, 10),
      dashboardUrl: 'https://painel.moreiraxavier.adv.br',
    });

    expect(html).toContain('Dr. Moreira');
    expect(html).toContain('5014928-36.2025.8.13.0686');
    expect(html).toContain('Publicado despacho com determinação de prazo');
    expect(html).toContain('https://painel.moreiraxavier.adv.br');
  });

  it('deve gerar template HTML de alerta de prazo urgente', () => {
    const html = templateAlertaPrazo({
      nomeAdvogado: 'Dra. Xavier',
      numeroCnj: '5014928-36.2025.8.13.0686',
      classe: 'Execução de Título',
      descricaoPrazo: 'Prazo fatal para embargos',
      dataVencimento: new Date(2025, 1, 15),
      diasRestantes: 1,
      prioridade: 'URGENTE',
      dashboardUrl: 'https://painel.moreiraxavier.adv.br',
    });

    expect(html).toContain('Dra. Xavier');
    expect(html).toContain('PRAZO CRÍTICO');
    expect(html).toContain('AÇÃO IMEDIATA NECESSÁRIA!');
    expect(html).toContain('alert-urgente');
  });

  it('deve verificar se email está configurado de acordo com variáveis de ambiente', () => {
    const configured = isEmailConfigured();
    expect(typeof configured).toBe('boolean');
  });
});
