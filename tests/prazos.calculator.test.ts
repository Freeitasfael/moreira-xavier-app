import { describe, it, expect } from 'vitest';
import {
  calcularPrazosMovimentacao,
  calcularPrazoCustomizado,
  deveAlertarPrazo,
} from '../src/modules/prazos/prazos.calculator.js';
import { calcularVencimentoPrazo, isDiaUtil, isFeriasForenses } from '../src/shared/utils/date-utils.js';

describe('Prazos CPC Calculator', () => {
  it('deve identificar período de férias forenses (20/dez a 20/jan)', () => {
    expect(isFeriasForenses(new Date(2025, 11, 20))).toBe(true); // 20 dez
    expect(isFeriasForenses(new Date(2025, 11, 25))).toBe(true); // 25 dez
    expect(isFeriasForenses(new Date(2025, 0, 15))).toBe(true);  // 15 jan
    expect(isFeriasForenses(new Date(2025, 0, 20))).toBe(true);  // 20 jan
    expect(isFeriasForenses(new Date(2025, 0, 21))).toBe(false); // 21 jan
    expect(isFeriasForenses(new Date(2025, 1, 10))).toBe(false); // 10 fev
  });

  it('deve calcular vencimento excluindo dia de início e pulando fins de semana', () => {
    // Quarta-feira, 05/02/2025
    const quarta = new Date(2025, 1, 5); 
    // Prazo de 5 dias úteis:
    // Quinta (06/02) = 1
    // Sexta (07/02) = 2
    // Sábado/Domingo não conta
    // Segunda (10/02) = 3
    // Terça (11/02) = 4
    // Quarta (12/02) = 5 -> Vencimento
    const vencimento = calcularVencimentoPrazo(quarta, 5);
    expect(vencimento.getDate()).toBe(12);
    expect(vencimento.getMonth()).toBe(1); // Fevereiro
  });

  it('deve gerar prazos padrão de Sentença (Apelação 15 dias e Embargos 5 dias)', () => {
    const dataSentenca = new Date(2025, 2, 10); // 10/03/2025
    const prazos = calcularPrazosMovimentacao('SENTENCA', dataSentenca);

    expect(prazos).toHaveLength(2);
    
    const apelacao = prazos.find((p) => p.tipo === 'RECURSO');
    expect(apelacao).toBeDefined();
    expect(apelacao?.diasUteis).toBe(15);
    expect(apelacao?.descricao).toBe('Apelação');

    const embargos = prazos.find((p) => p.tipo === 'EMBARGOS');
    expect(embargos).toBeDefined();
    expect(embargos?.diasUteis).toBe(5);
  });

  it('deve gerar prazo de Intimação (Manifestação 15 dias)', () => {
    const dataIntimacao = new Date(2025, 2, 10);
    const prazos = calcularPrazosMovimentacao('INTIMACAO', dataIntimacao);

    expect(prazos).toHaveLength(1);
    expect(prazos[0].tipo).toBe('MANIFESTACAO');
    expect(prazos[0].diasUteis).toBe(15);
  });
});
