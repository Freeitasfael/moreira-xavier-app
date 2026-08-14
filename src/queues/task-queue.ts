/**
 * Sistema de Filas Persistentes (PostgreSQL/Supabase)
 *
 * Usa a tabela FilaJob do Prisma para persistir e processar
 * tarefas. Substitui a versão antiga em memória, garantindo
 * que não há perda de dados em reinícios de container.
 */

import { EventEmitter } from 'events';
import { prisma } from '../config/database.js';

// ─── Types ──────────────────────────────────────────────────

export type JobStatus = 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'RETRYING';

export interface Job<T = unknown> {
  id: string;
  queue: string;
  data: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  result?: unknown;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
}

export interface QueueOptions {
  concurrency: number;
  maxRetries: number;
  retryDelayMs: number;
  pollIntervalMs: number;
}

export type JobProcessor<T = unknown> = (job: Job<T>) => Promise<unknown>;

// ─── TaskQueue ──────────────────────────────────────────────

export class TaskQueue<T = unknown> extends EventEmitter {
  private name: string;
  private options: QueueOptions;
  private activeCount = 0;
  private processor: JobProcessor<T> | null = null;
  private processing = false;
  private paused = false;
  private pollIntervalId: NodeJS.Timeout | null = null;

  constructor(name: string, options?: Partial<QueueOptions>) {
    super();
    this.name = name;
    this.options = {
      concurrency: options?.concurrency || 3,
      maxRetries: options?.maxRetries || 3,
      retryDelayMs: options?.retryDelayMs || 5000,
      pollIntervalMs: options?.pollIntervalMs || 2000,
    };
  }

  /**
   * Registra o processador de jobs e inicia o polling
   */
  process(processor: JobProcessor<T>): void {
    this.processor = processor;
    this.startPolling();
  }

  private startPolling() {
    if (this.pollIntervalId) clearInterval(this.pollIntervalId);
    this.pollIntervalId = setInterval(() => this.drain(), this.options.pollIntervalMs);
    // Tenta processar imediatamente
    this.drain();
  }

  /**
   * Adiciona um job à fila
   */
  async add(data: T, opts?: { priority?: number }): Promise<Job<T>> {
    const jobRecord = await prisma.filaJob.create({
      data: {
        fila: this.name,
        dados: data as any,
        status: 'WAITING',
        prioridade: opts?.priority || 0,
        maxTentativas: this.options.maxRetries + 1,
      },
    });

    const job = this.mapToJob(jobRecord);
    this.emit('added', job);
    this.drain();

    return job;
  }

  /**
   * Adiciona múltiplos jobs de uma vez
   */
  async addBulk(items: Array<{ data: T; opts?: { priority?: number } }>): Promise<Job<T>[]> {
    const jobs: Job<T>[] = [];
    for (const item of items) {
      const job = await this.add(item.data, item.opts);
      jobs.push(job);
    }
    return jobs;
  }

  /**
   * Pausa o processamento
   */
  pause(): void {
    this.paused = true;
    if (this.pollIntervalId) clearInterval(this.pollIntervalId);
    this.emit('paused');
  }

  /**
   * Retoma o processamento
   */
  resume(): void {
    this.paused = false;
    this.startPolling();
    this.emit('resumed');
  }

  /**
   * Retorna estatísticas reais da fila usando COUNT()
   */
  async getStatsAsync() {
    const result = await prisma.filaJob.groupBy({
      by: ['status'],
      where: { fila: this.name },
      _count: { _all: true },
    });

    let waiting = 0, active = 0, completed = 0, failed = 0;
    let total = 0;

    for (const row of result) {
      const c = row._count._all;
      total += c;
      if (row.status === 'WAITING' || row.status === 'RETRYING') waiting += c;
      if (row.status === 'ACTIVE') active += c;
      if (row.status === 'COMPLETED') completed += c;
      if (row.status === 'FAILED') failed += c;
    }

    return { name: this.name, waiting, active, completed, failed, total };
  }

  /**
   * Mantido para compatibilidade, mas estatísticas não são síncronas agora.
   */
  getStats() {
    return { name: this.name, waiting: -1, active: this.activeCount, completed: -1, failed: -1, total: -1 };
  }

  /**
   * Limpa jobs completados/falhos antigos (usando Prisma)
   */
  async clean(maxAgeMs: number = 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    
    const result = await prisma.filaJob.deleteMany({
      where: {
        fila: this.name,
        status: { in: ['COMPLETED', 'FAILED'] },
        concluidoEm: { lt: cutoff }
      }
    });

    return result.count;
  }

  /**
   * Tenta pegar jobs do banco de dados (Optimistic Locking)
   */
  private async drain(): Promise<void> {
    if (this.paused || !this.processor || this.processing) return;

    if (this.activeCount >= this.options.concurrency) return;
    
    this.processing = true;

    try {
      while (this.activeCount < this.options.concurrency) {
        // Busca um candidato no banco
        const candidato = await prisma.filaJob.findFirst({
          where: {
            fila: this.name,
            OR: [
              { status: 'WAITING' },
              { status: 'RETRYING', agendadoPara: { lte: new Date() } }
            ]
          },
          orderBy: [
            { prioridade: 'desc' },
            { criadoEm: 'asc' }
          ]
        });

        if (!candidato) {
          // Nenhum job esperando
          break;
        }

        // Tenta "travar" (lock) o job alterando status para ACTIVE
        const updateResult = await prisma.filaJob.updateMany({
          where: { 
            id: candidato.id, 
            status: candidato.status // se já mudou, count == 0
          },
          data: { 
            status: 'ACTIVE',
            processadoEm: new Date(),
            tentativas: { increment: 1 }
          }
        });

        if (updateResult.count === 0) {
          // Outra instância pegou primeiro
          continue;
        }

        this.activeCount++;
        const job = this.mapToJob({ ...candidato, status: 'ACTIVE', tentativas: candidato.tentativas + 1 });
        
        // Dispara processamento em background (não await no loop)
        this.processJob(job).catch(console.error);
      }
    } catch (err) {
      console.error(`[${this.name}] Erro no drain() polling:`, err);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Processa um job individual e atualiza banco
   */
  private async processJob(job: Job<T>): Promise<void> {
    try {
      const result = await this.processor!(job);
      job.status = 'COMPLETED';
      job.result = result;
      job.completedAt = new Date();
      
      await prisma.filaJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          resultado: result ? (result as any) : null,
          concluidoEm: new Date()
        }
      });

      this.emit('completed', job);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      job.error = errorMsg;

      if (job.attempts < job.maxAttempts) {
        // Retry com backoff exponencial
        job.status = 'RETRYING';
        const delay = this.options.retryDelayMs * Math.pow(2, job.attempts - 1);
        const nextTry = new Date(Date.now() + delay);

        await prisma.filaJob.update({
          where: { id: job.id },
          data: {
            status: 'RETRYING',
            erro: errorMsg,
            agendadoPara: nextTry
          }
        });

        console.warn(
          `⚠️ [${this.name}] Job ${job.id} falhou (tentativa ${job.attempts}/${job.maxAttempts}). ` +
          `Retry agendado para ${nextTry.toISOString()}: ${errorMsg}`,
        );

        this.emit('retrying', job);
      } else {
        job.status = 'FAILED';
        job.completedAt = new Date();
        
        await prisma.filaJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            erro: errorMsg,
            concluidoEm: new Date()
          }
        });

        console.error(`❌ [${this.name}] Job ${job.id} falhou definitivamente: ${errorMsg}`);
        this.emit('failed', job, new Error(errorMsg));
      }
    } finally {
      this.activeCount--;
      this.drain();
    }
  }

  private mapToJob(record: any): Job<T> {
    return {
      id: record.id,
      queue: record.fila,
      data: record.dados as T,
      status: record.status as JobStatus,
      priority: record.prioridade,
      attempts: record.tentativas,
      maxAttempts: record.maxTentativas,
      error: record.erro || undefined,
      result: record.resultado,
      createdAt: record.criadoEm,
      processedAt: record.processadoEm || undefined,
      completedAt: record.concluidoEm || undefined,
    };
  }
}

// ─── Registry global de filas ───────────────────────────────

const queues = new Map<string, TaskQueue<any>>();

export function getQueue<T = unknown>(name: string, options?: Partial<QueueOptions>): TaskQueue<T> {
  if (!queues.has(name)) {
    queues.set(name, new TaskQueue<T>(name, options));
  }
  return queues.get(name)! as TaskQueue<T>;
}

export async function getAllQueuesStatsAsync() {
  const stats: Record<string, any> = {};
  for (const [name, queue] of queues.entries()) {
    stats[name] = await queue.getStatsAsync();
  }
  return stats;
}

export function getAllQueuesStats() {
  const stats: Record<string, ReturnType<TaskQueue['getStats']>> = {};
  for (const [name, queue] of queues.entries()) {
    stats[name] = queue.getStats();
  }
  return stats;
}
