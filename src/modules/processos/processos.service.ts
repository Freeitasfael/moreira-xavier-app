/**
 * Service de Processos — Lógica de negócio central
 *
 * Responsável por:
 * - CRUD de processos
 * - Sincronização com DataJud
 * - Detecção de novas movimentações
 * - Vínculo advogado ↔ processo
 */

import { prisma } from '../../config/database.js';
import { datajudClient } from '../../scrapers/datajud/datajud.client.js';
import {
  parseProcessoDatajud,
  parseMovimentacoesDatajud,
} from '../../scrapers/datajud/datajud.parser.js';
import {
  isValidCnjNumber,
  normalizeCnjNumber,
  identificarTribunal,
} from '../../shared/utils/cnj-number.js';
import type { Processo, Movimentacao } from '@prisma/client';

export class ProcessoService {
  /**
   * Cadastra um novo processo para acompanhamento.
   * Estratégia: DataJud → TJMG API → cadastro manual com sync agendada
   */
  async cadastrarProcesso(advogadoId: string, numeroCnj: string): Promise<Processo> {
    // Validar número CNJ
    const numeroFormatado = normalizeCnjNumber(numeroCnj);

    // Verificar se processo já existe
    let processo = await prisma.processo.findUnique({
      where: { numeroCnj: numeroFormatado },
    });

    if (!processo) {
      const tribunal = identificarTribunal(numeroFormatado);
      let dadosCapa: any = null;
      let movimentacoesRaw: any[] = [];
      let fonteUsada = 'MANUAL';

      // ── Camada 1: DataJud ─────────────────────────────────
      try {
        console.log(`🌐 [Cadastro] Consultando DataJud para ${numeroFormatado}...`);
        const dadosDatajud = await datajudClient.consultarProcesso(numeroFormatado, tribunal);

        if (dadosDatajud) {
          dadosCapa = parseProcessoDatajud(dadosDatajud);
          movimentacoesRaw = dadosDatajud.movimentos || [];
          fonteUsada = 'DATAJUD';
          console.log(`✅ [Cadastro] DataJud retornou dados: ${movimentacoesRaw.length} movimentação(ões)`);
        } else {
          console.log(`⚠️ [Cadastro] DataJud: processo não encontrado no índice`);
        }
      } catch (error: any) {
        console.warn(`⚠️ [Cadastro] DataJud erro: ${error.message}`);
      }

      // ── Camada 2: TJMG API HTTP (se DataJud não encontrou e é MG) ──
      if (!dadosCapa && (tribunal === 'TJMG' || tribunal.includes('TJMG'))) {
        try {
          console.log(`🔍 [Cadastro] Tentando TJMG API HTTP para ${numeroFormatado}...`);
          const { tjmgApiClient } = await import('../../scrapers/tjmg/tjmg-api.client.js');
          const dadosTjmg = await tjmgApiClient.consultarProcesso(numeroFormatado);

          if (dadosTjmg) {
            dadosCapa = {
              numeroCnj: numeroFormatado,
              tribunal,
              classe: dadosTjmg.classe || null,
              assunto: dadosTjmg.assunto || null,
              comarca: dadosTjmg.comarca || null,
              vara: dadosTjmg.vara || null,
              parteAutora: dadosTjmg.parteAutora || null,
              parteRe: dadosTjmg.parteRe || null,
              sistemaOrigem: 'EPROC_TJMG' as const,
            };
            fonteUsada = 'TJMG_API';
            console.log(`✅ [Cadastro] TJMG API retornou dados: ${dadosTjmg.movimentacoes.length} movimentação(ões)`);
          } else {
            console.log(`⚠️ [Cadastro] TJMG API: processo não encontrado`);
          }
        } catch (error: any) {
          console.warn(`⚠️ [Cadastro] TJMG API erro: ${error.message}`);
        }
      }

      // ── Criar processo no banco ───────────────────────────
      const dadosFinais = dadosCapa || {
        numeroCnj: numeroFormatado,
        tribunal,
        sistemaOrigem: 'MANUAL' as const,
      };

      processo = await prisma.processo.create({
        data: {
          ...dadosFinais,
          numeroCnj: numeroFormatado,
          tribunal: dadosFinais.tribunal || tribunal,
          status: 'ATIVO',
          ultimaVerif: new Date(),
          proximaVerif: new Date(Date.now() + 1 * 60 * 60 * 1000), // Verificar em 1 hora
        },
      });

      console.log(`✅ [Cadastro] Processo criado (fonte: ${fonteUsada}): ${processo.id}`);

      // ── Salvar movimentações do DataJud ────────────────────
      if (fonteUsada === 'DATAJUD' && movimentacoesRaw.length > 0) {
        const movimentacoes = parseMovimentacoesDatajud(movimentacoesRaw, processo.id);
        let salvos = 0;
        for (const mov of movimentacoes) {
          try {
            await prisma.movimentacao.create({ data: mov as any });
            salvos++;
          } catch (error: any) {
            // Ignora duplicatas
          }
        }
        console.log(`✅ [Cadastro] ${salvos}/${movimentacoes.length} movimentações salvas`);
      }

      // ── Se não encontrou em nenhuma fonte, agendar sync ───
      if (fonteUsada === 'MANUAL') {
        console.log(`📋 [Cadastro] Processo cadastrado sem dados. Sync será tentada em breve.`);
      }
    }

    // Vincular advogado ao processo (se ainda não vinculado)
    const vinculoExistente = await prisma.processoAdvogado.findUnique({
      where: {
        advogadoId_processoId: {
          advogadoId,
          processoId: processo.id,
        },
      },
    });

    if (!vinculoExistente) {
      await prisma.processoAdvogado.create({
        data: {
          advogadoId,
          processoId: processo.id,
        },
      });
    }

    return processo;
  }

  /**
   * Lista processos de um advogado
   */
  async listarProcessos(
    advogadoId: string,
    filtros?: {
      status?: string;
      tribunal?: string;
      busca?: string;
      pagina?: number;
      porPagina?: number;
    },
  ) {
    const pagina = filtros?.pagina || 1;
    const porPagina = filtros?.porPagina || 20;

    const where: any = {
      advogados: {
        some: { advogadoId },
      },
    };

    if (filtros?.status) {
      where.status = filtros.status;
    }
    if (filtros?.tribunal) {
      where.tribunal = filtros.tribunal;
    }
    if (filtros?.busca) {
      where.OR = [
        { numeroCnj: { contains: filtros.busca } },
        { parteAutora: { contains: filtros.busca, mode: 'insensitive' } },
        { parteRe: { contains: filtros.busca, mode: 'insensitive' } },
        { classe: { contains: filtros.busca, mode: 'insensitive' } },
      ];
    }

    const [processos, total] = await Promise.all([
      prisma.processo.findMany({
        where,
        include: {
          prazos: {
            where: { status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
            orderBy: { dataFim: 'asc' },
            take: 3,
          },
          movimentacoes: {
            orderBy: { data: 'desc' },
            take: 1,
          },
          _count: {
            select: { movimentacoes: true, prazos: true },
          },
        },
        orderBy: { atualizadoEm: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
      prisma.processo.count({ where }),
    ]);

    return {
      processos,
      paginacao: {
        total,
        pagina,
        porPagina,
        totalPaginas: Math.ceil(total / porPagina),
      },
    };
  }

  /**
   * Busca detalhes completos de um processo
   */
  async detalheProcesso(processoId: string, advogadoId: string) {
    const processo = await prisma.processo.findFirst({
      where: {
        id: processoId,
        advogados: { some: { advogadoId } },
      },
      include: {
        movimentacoes: {
          orderBy: { data: 'desc' },
          take: 50,
        },
        prazos: {
          orderBy: { dataFim: 'asc' },
        },
      },
    });

    if (!processo) {
      throw new Error('Processo não encontrado');
    }

    return processo;
  }

  /**
   * Sincroniza um processo — Estratégia API-first
   * 1. DataJud (API REST) — fonte principal
   * 2. TJMG API (HTTP) — complemento para processos MG
   * 3. Eproc (Playwright) — fallback opcional se houver credenciais
   */
  async sincronizarProcesso(processoId: string): Promise<Movimentacao[]> {
    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
    });

    if (!processo) {
      throw new Error('Processo não encontrado');
    }

    let dadosParsed: any = null;
    const novasMovimentacoesArray: Movimentacao[] = [];
    let fonteUsada = 'NENHUMA';

    // ── Camada 1: DataJud (API REST do CNJ) ──────────────────
    try {
      console.log(`🌐 [Sync] Consultando DataJud para ${processo.numeroCnj}...`);
      const dadosDatajud = await datajudClient.consultarProcesso(
        processo.numeroCnj,
        processo.tribunal,
      );

      if (dadosDatajud) {
        dadosParsed = parseProcessoDatajud(dadosDatajud);
        fonteUsada = 'DATAJUD';

        if (dadosDatajud.movimentos?.length) {
          const movimentacoes = parseMovimentacoesDatajud(dadosDatajud.movimentos, processoId);
          for (const mov of movimentacoes) {
            try {
              const nova = await prisma.movimentacao.create({
                data: mov as any,
              });
              novasMovimentacoesArray.push(nova);
            } catch (error: any) {
              // Ignora duplicatas (hash único)
            }
          }
        }

        console.log(`✅ [Sync] DataJud: ${novasMovimentacoesArray.length} nova(s) movimentação(ões)`);
      }
    } catch (error: any) {
      console.warn(`⚠️ [Sync] DataJud falhou para ${processo.numeroCnj}: ${error.message}`);
    }

    // ── Camada 2: TJMG API HTTP (complemento para MG) ────────
    if (!dadosParsed && processo.tribunal === 'TJMG') {
      try {
        console.log(`🔍 [Sync] Consultando TJMG API HTTP para ${processo.numeroCnj}...`);
        const { tjmgApiClient } = await import('../../scrapers/tjmg/tjmg-api.client.js');
        const dadosTjmg = await tjmgApiClient.consultarProcesso(processo.numeroCnj);

        if (dadosTjmg) {
          dadosParsed = dadosTjmg;
          fonteUsada = 'TJMG_API';

          for (const mov of dadosTjmg.movimentacoes) {
            try {
              const hashConteudo = `${processoId}-${mov.data.toISOString()}-${mov.descricao}`.substring(0, 255);
              const nova = await prisma.movimentacao.create({
                data: {
                  processoId,
                  data: mov.data,
                  descricao: mov.descricao,
                  tipo: mov.tipo as any,
                  complemento: mov.complemento || null,
                  fonte: 'EPROC_TJMG',
                  hashConteudo,
                },
              });
              novasMovimentacoesArray.push(nova);
            } catch (error: any) {
              // Ignora duplicatas
            }
          }

          console.log(`✅ [Sync] TJMG API: ${novasMovimentacoesArray.length} nova(s) movimentação(ões)`);
        }
      } catch (error: any) {
        console.warn(`⚠️ [Sync] TJMG API falhou: ${error.message}`);
      }
    }

    // ── Sem dados? Atualizar timestamp mesmo assim ────────────
    if (!dadosParsed) {
      await prisma.processo.update({
        where: { id: processoId },
        data: {
          ultimaVerif: new Date(),
          proximaVerif: new Date(Date.now() + processo.intervaloVerif * 60 * 1000),
        },
      });
      return [];
    }

    // ── Atualizar capa do processo ───────────────────────────
    await prisma.processo.update({
      where: { id: processoId },
      data: {
        classe: dadosParsed.classe || processo.classe,
        assunto: dadosParsed.assunto || processo.assunto,
        comarca: dadosParsed.comarca || processo.comarca,
        vara: dadosParsed.vara || processo.vara,
        parteAutora: dadosParsed.parteAutora || processo.parteAutora,
        parteRe: dadosParsed.parteRe || processo.parteRe,
        valorCausa: dadosParsed.valorCausa || processo.valorCausa,
        ultimaVerif: new Date(),
        proximaVerif: new Date(Date.now() + processo.intervaloVerif * 60 * 1000),
        status: 'ATIVO',
      },
    });

    console.log(`✅ [Sync] ${processo.numeroCnj} sincronizado via ${fonteUsada}. ${novasMovimentacoesArray.length} nova(s).`);
    return novasMovimentacoesArray;
  }

  /**
   * Remove o vínculo de um advogado com um processo
   */
  async removerProcesso(processoId: string, advogadoId: string) {
    await prisma.processoAdvogado.delete({
      where: {
        advogadoId_processoId: { advogadoId, processoId },
      },
    });

    // Se nenhum advogado mais acompanha, limpar o processo
    const vinculos = await prisma.processoAdvogado.count({
      where: { processoId },
    });

    if (vinculos === 0) {
      await prisma.processo.delete({ where: { id: processoId } });
    }
  }

  /**
   * Retorna estatísticas do advogado
   */
  async estatisticas(advogadoId: string) {
    const [totalProcessos, processosAtivos, prazosUrgentes, prazosProximos] = await Promise.all([
      prisma.processoAdvogado.count({ where: { advogadoId } }),
      prisma.processoAdvogado.count({
        where: {
          advogadoId,
          processo: { status: 'ATIVO' },
        },
      }),
      prisma.prazo.count({
        where: {
          processo: { advogados: { some: { advogadoId } } },
          status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
          dataFim: { lte: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) }, // 2 dias
        },
      }),
      prisma.prazo.count({
        where: {
          processo: { advogados: { some: { advogadoId } } },
          status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
          dataFim: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 dias
        },
      }),
    ]);

    return {
      totalProcessos,
      processosAtivos,
      prazosUrgentes,
      prazosProximos,
    };
  }
}

export const processoService = new ProcessoService();
