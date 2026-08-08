import type { FastifyInstance } from 'fastify';
import { authGuard } from '../auth/auth.controller.js';
import type { JwtPayload } from '../auth/auth.types.js';
import { notificacaoService } from './notificacoes.service.js';

export async function notificacoesController(app: FastifyInstance) {
  // GET /api/notificacoes
  app.get('/api/notificacoes', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const query = request.query as any;

    const lidas = query.lidas === 'true' ? true : query.lidas === 'false' ? false : undefined;

    const notificacoes = await notificacaoService.listarNotificacoes(user.id, {
      lidas,
      limite: query.limite ? parseInt(query.limite) : 50,
    });

    reply.send({ success: true, data: notificacoes });
  });

  // GET /api/notificacoes/count
  app.get('/api/notificacoes/count', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const count = await notificacaoService.contarNaoLidas(user.id);
    reply.send({ success: true, data: { naoLidas: count } });
  });

  // PATCH /api/notificacoes/:id/lida
  app.patch(
    '/api/notificacoes/:id/lida',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await notificacaoService.marcarComoLida(id);
      reply.send({ success: true });
    },
  );

  // POST /api/notificacoes/ler-todas
  app.post(
    '/api/notificacoes/ler-todas',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      await notificacaoService.marcarTodasComoLidas(user.id);
      reply.send({ success: true });
    },
  );
}
