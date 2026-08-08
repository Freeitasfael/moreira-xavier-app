/**
 * Bootstrap da aplicação Fastify
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { authController } from './modules/auth/auth.controller.js';
import { processosController } from './modules/processos/processos.controller.js';
import { prazosController } from './modules/prazos/prazos.controller.js';
import { notificacoesController } from './modules/notificacoes/notificacoes.controller.js';
import { getAllQueuesStats, dispararSyncImediata, enfileirarProcessoUnico } from './queues/index.js';
import { authGuard } from './modules/auth/auth.controller.js';
import type { JwtPayload } from './modules/auth/auth.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // ─── Plugins ────────────────────────────────────────────────

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });

  // Servir arquivos estáticos (Dashboard)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // ─── Rotas da API ──────────────────────────────────────────

  await app.register(authController);
  await app.register(processosController);
  await app.register(prazosController);
  await app.register(notificacoesController);

  // ─── Rotas de Monitoramento (Fase 2) ──────────────────────

  // Status das filas de processamento
  app.get('/api/system/queues', { preHandler: [authGuard] }, async () => ({
    success: true,
    data: getAllQueuesStats(),
  }));

  // Disparar sincronização manual de todos os processos
  app.post('/api/system/sync', { preHandler: [authGuard] }, async () => {
    const count = await dispararSyncImediata();
    return {
      success: true,
      data: { processosEnfileirados: count },
      message: `${count} processo(s) enfileirado(s) para sincronização`,
    };
  });

  // Sincronizar um processo específico
  app.post('/api/processos/:id/sync', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as JwtPayload;

    const { prisma } = await import('./config/database.js');
    const processo = await prisma.processo.findFirst({
      where: {
        id,
        advogados: { some: { advogadoId: user.id } },
      },
    });

    if (!processo) {
      reply.status(404).send({ error: 'Processo não encontrado' });
      return;
    }

    await enfileirarProcessoUnico(processo.id, processo.numeroCnj, processo.tribunal);

    return {
      success: true,
      message: `Sincronização do processo ${processo.numeroCnj} enfileirada`,
    };
  });

  // ─── Health Check ──────────────────────────────────────────

  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    queues: getAllQueuesStats(),
  }));

  // ─── Rota catch-all para SPA ──────────────────────────────

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'Rota não encontrada' });
    } else {
      return reply.sendFile('index.html');
    }
  });

  return app;
}
