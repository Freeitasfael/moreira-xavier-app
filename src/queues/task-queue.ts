/**
 * Sistema de Filas em Memória — Alternativa leve ao BullMQ
 *
 * Como não temos Redis disponível, este módulo implementa
 * um sistema de filas simples que roda em memória.
 * A arquitetura é compatível com migração futura para BullMQ.
 *
 * Características:
 * - Processamento concorrente controlado
 * - Retry com backoff exponencial
 * - Logging de jobs
 * - Prioridade de jobs
 */

import { EventEmitter } from 'events';

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
}

export type JobProcessor<T = unknown> = (job: Job<T>) => Promise<unknown>;

// ─── TaskQueue ──────────────────────────────────────────────

export class TaskQueue<T = unknown> extends EventEmitter {
  private name: string;
  private options: QueueOptions;
  private jobs: Map<string, Job<T>> = new Map();
  private waitingQueue: string[] = [];
  private activeCount = 0;
  private processor: JobProcessor<T> | null = null;
  private processing = false;
  private jobCounter = 0;
  private paused = false;

  constructor(name: string, options?: Partial<QueueOptions>) {
    super();
    this.name = name;
    this.options = {
      concurrency: options?.concurrency || 3,
      maxRetries: options?.maxRetries || 3,
      retryDelayMs: options?.retryDelayMs || 5000,
    };
  }

  /**
   * Registra o processador de jobs
   */
  process(processor: JobProcessor<T>): void {
    this.processor = processor;
    // Processa jobs pendentes se houver
    this.drain();
  }

  /**
   * Adiciona um job à fila
   */
  async add(data: T, opts?: { priority?: number; jobId?: string }): Promise<Job<T>> {
    const id = opts?.jobId || `${this.name}-${++this.jobCounter}-${Date.now()}`;

    const job: Job<T> = {
      id,
      queue: this.name,
      data,
      status: 'WAITING',
      priority: opts?.priority || 0,
      attempts: 0,
      maxAttempts: this.options.maxRetries + 1,
      createdAt: new Date(),
    };

    this.jobs.set(id, job);
    this.waitingQueue.push(id);

    // Ordenar por prioridade (maior primeiro)
    this.waitingQueue.sort((a, b) => {
      const jobA = this.jobs.get(a)!;
      const jobB = this.jobs.get(b)!;
      return jobB.priority - jobA.priority;
    });

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
    this.emit('paused');
  }

  /**
   * Retoma o processamento
   */
  resume(): void {
    this.paused = false;
    this.emit('resumed');
    this.drain();
  }

  /**
   * Retorna estatísticas da fila
   */
  getStats() {
    let waiting = 0, active = 0, completed = 0, failed = 0;

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case 'WAITING': case 'RETRYING': waiting++; break;
        case 'ACTIVE': active++; break;
        case 'COMPLETED': completed++; break;
        case 'FAILED': failed++; break;
      }
    }

    return { name: this.name, waiting, active, completed, failed, total: this.jobs.size };
  }

  /**
   * Limpa jobs completados/falhos antigos
   */
  clean(maxAgeMs: number = 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (
        (job.status === 'COMPLETED' || job.status === 'FAILED') &&
        job.completedAt &&
        job.completedAt.getTime() < cutoff
      ) {
        this.jobs.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Drena a fila processando jobs pendentes
   */
  private drain(): void {
    if (this.paused || !this.processor || this.processing) return;
    this.processing = true;

    while (
      this.activeCount < this.options.concurrency &&
      this.waitingQueue.length > 0
    ) {
      const jobId = this.waitingQueue.shift();
      if (!jobId) break;

      const job = this.jobs.get(jobId);
      if (!job || job.status === 'COMPLETED' || job.status === 'FAILED') continue;

      this.activeCount++;
      job.status = 'ACTIVE';
      job.processedAt = new Date();
      job.attempts++;

      this.processJob(job);
    }

    this.processing = false;
  }

  /**
   * Processa um job individual
   */
  private async processJob(job: Job<T>): Promise<void> {
    try {
      const result = await this.processor!(job);
      job.status = 'COMPLETED';
      job.result = result;
      job.completedAt = new Date();
      this.emit('completed', job);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      job.error = errorMsg;

      if (job.attempts < job.maxAttempts) {
        // Retry com backoff exponencial
        job.status = 'RETRYING';
        const delay = this.options.retryDelayMs * Math.pow(2, job.attempts - 1);

        console.warn(
          `⚠️ [${this.name}] Job ${job.id} falhou (tentativa ${job.attempts}/${job.maxAttempts}). ` +
          `Retry em ${delay}ms: ${errorMsg}`,
        );

        this.emit('retrying', job);

        setTimeout(() => {
          this.waitingQueue.push(job.id);
          this.drain();
        }, delay);
      } else {
        job.status = 'FAILED';
        job.completedAt = new Date();
        console.error(`❌ [${this.name}] Job ${job.id} falhou definitivamente: ${errorMsg}`);
        this.emit('failed', job, new Error(errorMsg));
      }
    } finally {
      this.activeCount--;
      this.drain();
    }
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

export function getAllQueuesStats() {
  const stats: Record<string, ReturnType<TaskQueue['getStats']>> = {};
  for (const [name, queue] of queues.entries()) {
    stats[name] = queue.getStats();
  }
  return stats;
}
