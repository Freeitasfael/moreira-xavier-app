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

      const processo = await processoService.cadastrarProcesso(user.id, numeroCnj);

      reply.status(201).send({
        success: true,
        data: processo,
        message: 'Processo cadastrado para acompanhamento',
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
}
