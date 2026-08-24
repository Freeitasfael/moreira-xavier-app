import type { FastifyInstance } from 'fastify';
import { authGuard } from '../auth/auth.controller.js';
import { processoService } from './processos.service.js';
import type { JwtPayload } from '../auth/auth.types.js';
import { z } from 'zod';

const cadastroSchema = z.object({
  numeroCnj: z.string().min(20, 'Número CNJ inválido'),
});

export async function processosController(app: FastifyInstance) {
  // ─── POST /api/processos — Cadastrar processo ─────────────
  app.post('/api/processos', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const user = request.user as JwtPayload;
      const { numeroCnj } = cadastroSchema.parse(request.body);

      const { processo, fonte, movimentacoes } = await processoService.cadastrarProcesso(user.id, numeroCnj);

      // Gerar mensagem adequada baseada na fonte de dados
      let message: string;
      if (fonte === 'EXISTENTE') {
        message = 'Processo já cadastrado — vinculado ao seu perfil.';
      } else if (fonte === 'DATAJUD') {
        message = `Processo cadastrado com sucesso! ${movimentacoes} movimentação(ões) encontrada(s) no DataJud.`;
      } else if (fonte === 'TJMG_API') {
        message = 'Processo cadastrado com dados do TJMG.';
      } else {
        message = 'Processo cadastrado. Os dados serão sincronizados automaticamente em breve — esse processo pode não estar disponível no DataJud ainda.';
      }

      reply.status(201).send({
        success: true,
        data: processo,
        fonte,
        movimentacoes,
        message,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        reply.status(400).send({ error: 'Dados inválidos', details: error.errors });
        return;
      }
      reply.status(400).send({ error: error.message });
    }
  });

  // ─── POST /api/processos/importar-oab — Busca manual OAB ───
  app.post('/api/processos/importar-oab', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const user = request.user as JwtPayload;
      
      const { oabSyncQueue } = await import('../../queues/scraping.worker.js');
      await oabSyncQueue.add({
        advogadoId: user.id,
        oabNumero: user.oabNumero,
        oabUf: user.oabUf,
      });

      reply.status(200).send({
        success: true,
        message: 'Busca de processos pela OAB foi agendada e está rodando em segundo plano.',
      });
    } catch (error: any) {
      reply.status(500).send({ error: error.message || 'Erro ao agendar importação' });
    }
  });

  // ─── GET /api/processos — Listar processos ────────────────
  app.get('/api/processos', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const query = request.query as any;

    const resultado = await processoService.listarProcessos(user.id, {
      status: query.status,
      tribunal: query.tribunal,
      busca: query.busca,
      pagina: query.pagina ? parseInt(query.pagina) : 1,
      porPagina: query.porPagina ? parseInt(query.porPagina) : 20,
    });

    reply.send({ success: true, data: resultado });
  });

  // ─── GET /api/processos/estatisticas — Dashboard ──────────
  app.get('/api/processos/estatisticas', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const stats = await processoService.estatisticas(user.id);
    reply.send({ success: true, data: stats });
  });

  // ─── GET /api/processos/:id — Detalhe do processo ─────────
  app.get('/api/processos/:id', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };

      const processo = await processoService.detalheProcesso(id, user.id);
      reply.send({ success: true, data: processo });
    } catch (error: any) {
      reply.status(404).send({ error: error.message });
    }
  });

  // ─── POST /api/processos/:id/sincronizar — Sync manual ───
  app.post(
    '/api/processos/:id/sincronizar',
    { preHandler: [authGuard] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const novasMovimentacoes = await processoService.sincronizarProcesso(id);

        reply.send({
          success: true,
          data: {
            novasMovimentacoes: novasMovimentacoes.length,
            movimentacoes: novasMovimentacoes,
          },
          message:
            novasMovimentacoes.length > 0
              ? `${novasMovimentacoes.length} nova(s) movimentação(ões) encontrada(s)`
              : 'Nenhuma nova movimentação',
        });
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    },
  );

  // ─── DELETE /api/processos/:id — Remover acompanhamento ───
  app.delete('/api/processos/:id', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };

      await processoService.removerProcesso(id, user.id);
      reply.send({ success: true, message: 'Processo removido do acompanhamento' });
    } catch (error: any) {
      reply.status(400).send({ error: error.message });
    }
  });

  // ─── GET /api/scraping/status — Monitoramento de filas ────
  app.get('/api/scraping/status', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const { prisma } = await import('../../config/database.js');
      const { getAllQueuesStatsAsync } = await import('../../queues/task-queue.js');

      // Estatísticas das filas
      let filas = {};
      try {
        filas = await getAllQueuesStatsAsync();
      } catch {
        filas = { erro: 'Filas não inicializadas' };
      }

      // Últimos logs de scraping (10 mais recentes)
      const ultimosLogs = await prisma.logScraping.findMany({
        orderBy: { criadoEm: 'desc' },
        take: 10,
        select: {
          id: true,
          tribunal: true,
          sistema: true,
          acao: true,
          sucesso: true,
          tempoMs: true,
          erro: true,
          criadoEm: true,
        },
      });

      // Jobs pendentes na fila
      const jobsPendentes = await prisma.filaJob.count({
        where: { status: { in: ['WAITING', 'RETRYING'] } },
      });

      const jobsAtivos = await prisma.filaJob.count({
        where: { status: 'ACTIVE' },
      });

      const jobsFalhos = await prisma.filaJob.findMany({
        where: { status: 'FAILED' },
        orderBy: { atualizadoEm: 'desc' },
        take: 5,
        select: {
          id: true,
          fila: true,
          erro: true,
          tentativas: true,
          atualizadoEm: true,
        },
      });

      reply.send({
        success: true,
        data: {
          filas,
          jobsPendentes,
          jobsAtivos,
          jobsFalhos,
          ultimosLogs,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // ─── GET /api/diagnostico — Verificação pública do DataJud ──
  app.get('/api/diagnostico', async (_request, reply) => {
    const { env } = await import('../../config/env.js');
    const { datajudClient } = await import('../../scrapers/datajud/datajud.client.js');

    const resultado: any = {
      timestamp: new Date().toISOString(),
      env: {
        DATAJUD_API_KEY_presente: !!env.DATAJUD_API_KEY,
        DATAJUD_API_KEY_prefixo: env.DATAJUD_API_KEY?.substring(0, 15) + '...',
        DATAJUD_BASE_URL: env.DATAJUD_BASE_URL,
        DATABASE_URL_presente: !!env.DATABASE_URL,
        NODE_ENV: env.NODE_ENV,
      },
      datajud: { status: 'não testado' },
    };

    // Testar DataJud com um processo REAL que sabemos que existe
    try {
      const testCnj = '50149283620258130686'; // Processo conhecido no TJMG
      const res = await fetch(`${env.DATAJUD_BASE_URL}/api_publica_tjmg/_search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: env.DATAJUD_API_KEY,
        },
        body: JSON.stringify({
          query: { match: { numeroProcesso: testCnj } },
          size: 1,
        }),
      });

      const data = await res.json() as any;
      resultado.datajud = {
        status: res.ok ? 'OK' : `ERRO ${res.status}`,
        httpStatus: res.status,
        totalHits: data.hits?.total?.value ?? 0,
        processoEncontrado: (data.hits?.hits?.length || 0) > 0,
        classeExemplo: data.hits?.hits?.[0]?._source?.classe?.nome || null,
      };
    } catch (err: any) {
      resultado.datajud = {
        status: 'ERRO_CONEXAO',
        erro: err.message,
      };
    }

    reply.send(resultado);
  });
}
