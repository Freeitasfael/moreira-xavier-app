import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService } from './auth.service.js';
import {
  registroSchema,
  loginSchema,
  credencialTribunalSchema,
  type JwtPayload,
} from './auth.types.js';

/**
 * Middleware de autenticação JWT
 */
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({
      error: 'Não autorizado',
      message: 'Token de autenticação inválido ou expirado',
    });
  }
}

/**
 * Rotas de autenticação
 */
export async function authController(app: FastifyInstance) {
  // ─── POST /api/auth/registro ────────────────────────────────
  app.post('/api/auth/registro', async (request, reply) => {
    try {
      const input = registroSchema.parse(request.body);
      const result = await authService.registrar(input);

      // Gerar JWT
      const payload = authService.getJwtPayload(result.advogado);
      const token = app.jwt.sign(payload);

      reply.status(201).send({
        success: true,
        data: {
          token,
          advogado: result.advogado,
        },
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        reply.status(400).send({
          error: 'Dados inválidos',
          details: error.errors,
        });
        return;
      }

      const status = error.message === 'Email já cadastrado' ? 409 : 500;
      reply.status(status).send({
        error: error.message,
      });
    }
  });

  // ─── POST /api/auth/login ──────────────────────────────────
  app.post('/api/auth/login', async (request, reply) => {
    try {
      const input = loginSchema.parse(request.body);
      const result = await authService.login(input);

      const payload = authService.getJwtPayload(result.advogado);
      const token = app.jwt.sign(payload);

      reply.send({
        success: true,
        data: {
          token,
          advogado: result.advogado,
        },
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        reply.status(400).send({
          error: 'Dados inválidos',
          details: error.errors,
        });
        return;
      }

      reply.status(401).send({
        error: error.message || 'Credenciais inválidas',
      });
    }
  });

  // ─── GET /api/auth/me ─────────────────────────────────────
  app.get('/api/auth/me', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const advogado = await authService.buscarPorId(user.id);

    if (!advogado) {
      reply.status(404).send({ error: 'Advogado não encontrado' });
      return;
    }

    reply.send({ success: true, data: advogado });
  });

  // ─── Credenciais dos Tribunais ──────────────────────────────

  // POST /api/auth/credenciais
  app.post('/api/auth/credenciais', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const user = request.user as JwtPayload;
      const input = credencialTribunalSchema.parse(request.body);

      await authService.salvarCredencial(user.id, input);

      reply.status(201).send({
        success: true,
        message: `Credencial do ${input.tribunal} salva com sucesso`,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        reply.status(400).send({ error: 'Dados inválidos', details: error.errors });
        return;
      }
      reply.status(500).send({ error: error.message });
    }
  });

  // GET /api/auth/credenciais
  app.get('/api/auth/credenciais', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const credenciais = await authService.listarCredenciais(user.id);

    reply.send({ success: true, data: credenciais });
  });

  // DELETE /api/auth/credenciais/:tribunal
  app.delete(
    '/api/auth/credenciais/:tribunal',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { tribunal } = request.params as { tribunal: string };

      try {
        await authService.removerCredencial(user.id, tribunal);
        reply.send({ success: true, message: 'Credencial removida' });
      } catch {
        reply.status(404).send({ error: 'Credencial não encontrada' });
      }
    },
  );
}
