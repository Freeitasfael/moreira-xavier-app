import { describe, it, expect } from 'vitest';
import {
  formatCnjNumber,
  isValidCnjNumber,
  identificarTribunal,
  parseCnjNumber,
} from '../src/shared/utils/cnj-number.js';

describe('CNJ Number Utilities', () => {
  const cnjFormatado = '5014928-36.2025.8.13.0686';
  const cnjDigitos = '50149283620258130686';

  it('deve formatar número CNJ com 20 dígitos', () => {
    expect(formatCnjNumber(cnjDigitos)).toBe(cnjFormatado);
  });

  it('deve lançar erro ao tentar formatar número com tamanho incorreto', () => {
    expect(() => formatCnjNumber('12345')).toThrow();
  });

  it('deve validar número CNJ no formato padrão', () => {
    expect(isValidCnjNumber(cnjFormatado)).toBe(true);
    expect(isValidCnjNumber('12345')).toBe(false);
    expect(isValidCnjNumber(cnjDigitos)).toBe(false);
  });

  it('deve identificar o tribunal corretamente a partir do número', () => {
    expect(identificarTribunal(cnjFormatado)).toBe('TJMG');
    expect(identificarTribunal(cnjDigitos)).toBe('TJMG');
    expect(identificarTribunal('0000000-00.2024.8.26.0000')).toBe('TJSP');
    expect(identificarTribunal('0000000-00.2024.8.19.0000')).toBe('TJRJ');
    expect(identificarTribunal('0000000-00.2024.4.01.0000')).toBe('TRF1');
    expect(identificarTribunal('0000000-00.2024.5.03.0000')).toBe('TRT3');
  });

  it('deve fazer parse completo dos componentes do CNJ', () => {
    const parsed = parseCnjNumber(cnjFormatado);
    expect(parsed).toEqual({
      sequencial: '5014928',
      digitoVerificador: '36',
      ano: '2025',
      segmento: '8',
      tribunal: '13',
      origem: '0686',
      formatado: cnjFormatado,
      apenasDigitos: cnjDigitos,
    });
  });
});
