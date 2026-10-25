import { describe, it, expect } from 'vitest';
import {
  parseProcessoDatajud,
  parseMovimentacoesDatajud,
  identificarMovimentacoesComPrazo,
} from '../src/scrapers/datajud/datajud.parser.js';

describe('DataJud Parser', () => {
  const mockProcesso = {
    numeroProcesso: '50149283620258130686',
    classe: {
      codigo: 1111,
      nome: 'Procedimento Comum Cível',
    },
    assuntos: [
      { codigo: 10433, nome: 'Obrigação de Fazer / Não Fazer' },
      { codigo: 7780, nome: 'Indenização por Dano Moral' },
    ],
    tribunal: 'TJMG',
    dataAjuizamento: '2025-01-10T14:30:00.000Z',
    grau: 'G1',
    nivelSigilo: 0,
    orgaoJulgador: {
      codigo: 1234,
      nome: '1ª Vara Cível da Comarca de Teófilo Otoni',
    },
    movimentos: [],
  };

  it('deve extrair dados da capa e a comarca do órgão julgador', () => {
    const parsed = parseProcessoDatajud(mockProcesso as any);

    expect(parsed.numeroCnj).toBe('5014928-36.2025.8.13.0686');
    expect(parsed.tribunal).toBe('TJMG');
    expect(parsed.instancia).toBe(1);
    expect(parsed.classe).toBe('Procedimento Comum Cível');
    expect(parsed.assunto).toBe('Obrigação de Fazer / Não Fazer; Indenização por Dano Moral');
    expect(parsed.comarca).toBe('Teófilo Otoni');
    expect(parsed.sistemaOrigem).toBe('DATAJUD');
  });

  it('deve extrair partes dos polos ativo/passivo e valor da causa se presentes', () => {
    const mockComPolos = {
      ...mockProcesso,
      valorCausa: '150000.50',
      polos: [
        {
          polo: 'AT',
          parte: [{ pessoa: { nome: 'João da Silva' } }],
        },
        {
          polo: 'PA',
          parte: [{ pessoa: { nome: 'Banco do Brasil S.A.' } }],
        },
      ],
    };

    const parsed = parseProcessoDatajud(mockComPolos as any);
    expect(parsed.parteAutora).toBe('João da Silva');
    expect(parsed.parteRe).toBe('Banco do Brasil S.A.');
    expect(parsed.valorCausa).toBe(150000.5);
  });

  it('deve converter movimentações e mapear tipos e hashes', () => {
    const mockMovs = [
      {
        codigo: 22,
        nome: 'Julgada procedente a ação',
        dataHora: '2025-02-01T10:00:00.000Z',
        complementosTabelados: [
          { codigo: 1, nome: 'Tipo de Decisão', descricao: 'Com resolução do mérito' },
        ],
      },
      {
        codigo: 12,
        nome: 'Expedida intimação eletrônica',
        dataHora: '2025-02-02T14:00:00.000Z',
      },
      {
        codigo: 9999,
        nome: 'Juntada de petição de manifestação',
        dataHora: '2025-02-03T16:00:00.000Z',
      },
    ];

    const parsedMovs = parseMovimentacoesDatajud(mockMovs as any, 'proc-123');

    expect(parsedMovs).toHaveLength(3);
    expect(parsedMovs[0].processoId).toBe('proc-123');
    expect(parsedMovs[0].tipo).toBe('SENTENCA');
    expect(parsedMovs[0].complemento).toContain('Tipo de Decisão: Com resolução do mérito');
    expect(parsedMovs[0].hashConteudo).toBeDefined();

    expect(parsedMovs[1].tipo).toBe('INTIMACAO');
    expect(parsedMovs[2].tipo).toBe('PETICAO'); // classificado por palavra-chave fallback
  });

  it('deve filtrar movimentações que geram prazos', () => {
    const mockMovs = [
      { codigo: 12, nome: 'Intimação', dataHora: '2025-02-01T10:00:00.000Z' },
      { codigo: 22, nome: 'Sentença', dataHora: '2025-02-02T10:00:00.000Z' },
      { codigo: 581, nome: 'Juntada', dataHora: '2025-02-03T10:00:00.000Z' },
    ];

    const comPrazo = identificarMovimentacoesComPrazo(mockMovs as any);
    expect(comPrazo).toHaveLength(2);
    expect(comPrazo.map((m) => m.nome)).toEqual(['Intimação', 'Sentença']);
  });
});
