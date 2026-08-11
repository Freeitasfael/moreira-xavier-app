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
   * Cadastra um novo processo para acompanhamento
   */
  async cadastrarProcesso(advogadoId: string, numeroCnj: string): Promise<Processo> {
    // Validar número CNJ
    const numeroFormatado = normalizeCnjNumber(numeroCnj);

    // Verificar se processo já existe
    let processo = await prisma.processo.findUnique({
      where: { numeroCnj: numeroFormatado },
    });

    if (!processo) {
      // Tentar buscar dados no DataJud
      const tribunal = identificarTribunal(numeroFormatado);
      let dadosDatajud = null;

      try {
        dadosDatajud = await datajudClient.consultarProcesso(numeroFormatado, tribunal);
      } catch (error) {
        console.warn(`⚠️ Não foi possível consultar DataJud para ${numeroFormatado}:`, error);
      }

      // Criar processo com dados do DataJud ou dados mínimos
      const dados = dadosDatajud
        ? parseProcessoDatajud(dadosDatajud)
        : {
            numeroCnj: numeroFormatado,
            tribunal,
            sistemaOrigem: 'MANUAL' as const,
          };

      processo = await prisma.processo.create({
        data: {
          ...dados,
          numeroCnj: numeroFormatado,
          tribunal: dados.tribunal || tribunal,
          ultimaVerif: new Date(),
          proximaVerif: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 horas
        },
      });

      // Se veio do DataJud, salvar movimentações
      if (dadosDatajud?.movimentos?.length) {
        const movimentacoes = parseMovimentacoesDatajud(dadosDatajud.movimentos, processo.id);

        for (const mov of movimentacoes) {
          try {
            await prisma.movimentacao.create({
              data: mov as any,
            });
          } catch (error: any) {
            // Ignora duplicatas (constraint unique no hashConteudo)
            if (!error.message?.includes('Unique constraint')) {
              console.warn('Erro ao salvar movimentação:', error.message);
            }
          }
        }
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
   * Sincroniza um processo com o DataJud
   * Retorna as novas movimentações encontradas
   */
  async sincronizarProcesso(processoId: string): Promise<Movimentacao[]> {
    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
    });

    if (!processo) {
      throw new Error('Processo não encontrado');
    }

    let dadosParsed: any = null;
    let novasMovimentacoesCount = 0;
    const novasMovimentacoesArray: Movimentacao[] = [];
    let usouScraperPrivado = false;
    let totalMovimentacoes = 0;

    const relacao = await prisma.processoAdvogado.findFirst({
      where: { processoId },
      select: { advogadoId: true }
    });

    if (relacao && processo.tribunal === 'TJMG') {
      const { authService } = await import('../auth/auth.service.js');
      const credencial = await authService.obterCredencial(relacao.advogadoId, 'EPROC_TJMG');

      if (credencial) {
        console.log(`🔑 [Sync Manual] Credencial encontrada para ${processo.numeroCnj}. Usando scraper privado Eproc...`);
        const { EprocTjmgPrivadoScraper } = await import('../../scrapers/eproc/eproc-tjmg-privado.js');
        const scraper = new EprocTjmgPrivadoScraper(credencial.login, credencial.senha);
        
        const resultado = await scraper.buscarProcessoLogado(processo.numeroCnj);
        
        if (resultado.sucesso && resultado.dados) {
          dadosParsed = resultado.dados;
          usouScraperPrivado = true;
          totalMovimentacoes = resultado.dados.movimentacoes.length;
          
          for (const mov of resultado.dados.movimentacoes) {
            try {
              const nova = await prisma.movimentacao.create({ 
                data: {
                  ...(mov as any),
                  processoId,
                  hashConteudo: `${processoId}-${mov.data.toISOString()}-${mov.descricao}`.substring(0, 255)
                }
              });
              novasMovimentacoesArray.push(nova);
            } catch (error: any) {
              // Ignora duplicatas
            }
          }
        }
      }
    }

    if (!usouScraperPrivado) {
      // Consultar DataJud
      let dadosDatajud = null;
      try {
        dadosDatajud = await datajudClient.consultarProcesso(
          processo.numeroCnj,
          processo.tribunal,
        );
      } catch (error: any) {
        console.warn(`[DataJud] Erro no fallback: ${error.message}`);
        throw new Error(`Falha na sincronização: A credencial do Eproc falhou/não existe e a API do DataJud retornou erro. Detalhes: ${error.message.substring(0, 100)}...`);
      }

      if (!dadosDatajud) {
        // Atualizar timestamp mesmo sem dados
        await prisma.processo.update({
          where: { id: processoId },
          data: {
            ultimaVerif: new Date(),
            proximaVerif: new Date(Date.now() + processo.intervaloVerif * 60 * 1000),
          },
        });
        return [];
      }
      dadosParsed = parseProcessoDatajud(dadosDatajud);
      
      if (dadosDatajud.movimentos?.length) {
        const movimentacoes = parseMovimentacoesDatajud(dadosDatajud.movimentos, processoId);
        for (const mov of movimentacoes) {
          try {
            const nova = await prisma.movimentacao.create({
              data: mov as any,
            });
            novasMovimentacoesArray.push(nova);
          } catch (error: any) {
             // ignora
          }
        }
      }
    }

    // Atualizar dados do processo (Capa)
    await prisma.processo.update({
      where: { id: processoId },
      data: {
        classe: dadosParsed.classe,
        assunto: dadosParsed.assunto,
        comarca: dadosParsed.comarca,
        vara: dadosParsed.vara,
        parteAutora: dadosParsed.parteAutora,
        parteRe: dadosParsed.parteRe,
        valorCausa: dadosParsed.valorCausa,
        numeroCnj: processo.numeroCnj, // Não sobrescrever
        ultimaVerif: new Date(),
        proximaVerif: new Date(Date.now() + processo.intervaloVerif * 60 * 1000),
      },
    });

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
