import type { FastifyInstance } from 'fastify';
import { authGuard } from '../auth/auth.controller.js';
import type { JwtPayload } from '../auth/auth.types.js';
import { prisma } from '../../config/database.js';
import { calcularPrazoCustomizado } from './prazos.calculator.js';
import { diasUteisRestantes, nivelUrgenciaPrazo } from '../../shared/utils/date-utils.js';
import { z } from 'zod';

const prazoCriarSchema = z.object({
  processoId: z.string().uuid(),
  tipo: z.enum([
    'CONTESTACAO', 'RECURSO', 'MANIFESTACAO', 'EMBARGOS',
    'IMPUGNACAO', 'CUMPRIMENTO', 'PAGAMENTO', 'AUDIENCIA',
    'PERICIA', 'GENERICO',
  ]),
  descricao: z.string().min(3),
  dataInicio: z.string().datetime(),
  diasUteis: z.number().min(1).max(365),
  observacao: z.string().optional(),
});

export async function prazosController(app: FastifyInstance) {
  // ─── GET /api/prazos — Listar prazos do advogado ──────────
  app.get('/api/prazos', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const query = request.query as any;

    const where: any = {
      processo: {
        advogados: { some: { advogadoId: user.id } },
      },
    };

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { in: ['PENDENTE', 'EM_ANDAMENTO'] };
    }

    const prazos = await prisma.prazo.findMany({
      where,
      include: {
        processo: {
          select: {
            id: true,
            numeroCnj: true,
            classe: true,
            parteAutora: true,
            parteRe: true,
          },
        },
      },
      orderBy: { dataFim: 'asc' },
      take: query.limite ? parseInt(query.limite) : 50,
    });

    // Enriquecer com dados calculados
    const prazosEnriquecidos = prazos.map((p) => ({
      ...p,
      diasRestantes: diasUteisRestantes(p.dataFim),
      urgencia: nivelUrgenciaPrazo(p.dataFim),
    }));

    reply.send({ success: true, data: prazosEnriquecidos });
  });

  // ─── POST /api/prazos — Criar prazo manual ────────────────
  app.post('/api/prazos', { preHandler: [authGuard] }, async (request, reply) => {
    try {
      const user = request.user as JwtPayload;
      const input = prazoCriarSchema.parse(request.body);

      // Verificar se o advogado tem acesso ao processo
      const vinculo = await prisma.processoAdvogado.findUnique({
        where: {
          advogadoId_processoId: {
            advogadoId: user.id,
            processoId: input.processoId,
          },
        },
      });

      if (!vinculo) {
        reply.status(403).send({ error: 'Sem acesso a este processo' });
        return;
      }

      const prazoCalc = calcularPrazoCustomizado(
        new Date(input.dataInicio),
        input.diasUteis,
        input.descricao,
      );

      const prazo = await prisma.prazo.create({
        data: {
          processoId: input.processoId,
          tipo: input.tipo,
          descricao: input.descricao,
          dataInicio: new Date(input.dataInicio),
          dataFim: prazoCalc.dataFim,
          diasUteis: input.diasUteis,
          observacao: input.observacao,
          status: 'PENDENTE',
        },
      });

      reply.status(201).send({
        success: true,
        data: {
          ...prazo,
          diasRestantes: prazoCalc.diasRestantes,
          urgencia: nivelUrgenciaPrazo(prazoCalc.dataFim),
        },
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        reply.status(400).send({ error: 'Dados inválidos', details: error.errors });
        return;
      }
      reply.status(400).send({ error: error.message });
    }
  });

  // ─── PATCH /api/prazos/:id/status — Atualizar status ─────
  app.patch(
    '/api/prazos/:id/status',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };

      const statusValidos = ['PENDENTE', 'EM_ANDAMENTO', 'CUMPRIDO', 'CANCELADO'];
      if (!statusValidos.includes(status)) {
        reply.status(400).send({ error: `Status inválido. Use: ${statusValidos.join(', ')}` });
        return;
      }

      const prazo = await prisma.prazo.update({
        where: { id },
        data: { status: status as any },
      });

      reply.send({ success: true, data: prazo });
    },
  );

  // ─── GET /api/prazos/calendario — Prazos por período ─────
  app.get('/api/prazos/calendario', { preHandler: [authGuard] }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const query = request.query as any;

    const inicio = query.inicio ? new Date(query.inicio) : new Date();
    const fim = query.fim
      ? new Date(query.fim)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

    const prazos = await prisma.prazo.findMany({
      where: {
        processo: {
          advogados: { some: { advogadoId: user.id } },
        },
        dataFim: {
          gte: inicio,
          lte: fim,
        },
        status: { in: ['PENDENTE', 'EM_ANDAMENTO'] },
      },
      include: {
        processo: {
          select: {
            numeroCnj: true,
            classe: true,
          },
        },
      },
      orderBy: { dataFim: 'asc' },
    });

    const prazosEnriquecidos = prazos.map((p) => ({
      ...p,
      diasRestantes: diasUteisRestantes(p.dataFim),
      urgencia: nivelUrgenciaPrazo(p.dataFim),
    }));

    reply.send({ success: true, data: prazosEnriquecidos });
  });
}
