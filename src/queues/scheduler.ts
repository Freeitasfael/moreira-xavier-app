/**
 * Agendador de Tarefas (Cron Jobs)
 *
 * Responsável por disparar as tarefas periódicas:
 * - Sincronização de processos a cada 6 horas
 * - Verificação de prazos a cada 30 minutos
 * - Resumo diário às 8h
 * - Limpeza de dados antigos semanal
 */

import cron from 'node-cron';
import { enfileirarProcessosPendentes } from './scraping.worker.js';
import { enfileirarVerificacaoPrazos } from './prazos.worker.js';
import { gerarResumoDiario } from './notificacoes.worker.js';
import { getAllQueuesStats } from './task-queue.js';
import { prisma } from '../config/database.js';

// ─── Cron Jobs ──────────────────────────────────────────────

const jobs: cron.ScheduledTask[] = [];

/**
 * Inicializa todos os cron jobs do sistema
 */
export function iniciarCronJobs(): void {
  console.log('⏰ Inicializando agendamentos...');

  // ── Sincronização de processos: a cada 6 horas ────────────
  // (00:00, 06:00, 12:00, 18:00)
  const syncJob = cron.schedule('0 */6 * * *', async () => {
    console.log('');
    console.log('🔄 [Cron] Iniciando sincronização de processos...');
    try {
      const count = await enfileirarProcessosPendentes();
      console.log(`🔄 [Cron] ${count} processo(s) enfileirado(s) para sincronização`);
    } catch (error) {
      console.error('❌ [Cron] Erro na sincronização:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });
  jobs.push(syncJob);

  // ── Verificação de prazos: a cada 30 minutos ─────────────
  const prazosJob = cron.schedule('*/30 * * * *', async () => {
    console.log('📅 [Cron] Verificando prazos...');
    try {
      await enfileirarVerificacaoPrazos();
    } catch (error) {
      console.error('❌ [Cron] Erro na verificação de prazos:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });
  jobs.push(prazosJob);

  // ── Resumo diário: todos os dias às 8h ────────────────────
  const resumoJob = cron.schedule('0 8 * * 1-5', async () => {
    console.log('📊 [Cron] Gerando resumo diário...');
    try {
      await gerarResumoDiario();
    } catch (error) {
      console.error('❌ [Cron] Erro no resumo diário:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });
  jobs.push(resumoJob);

  // ── Status das filas: a cada 15 minutos ───────────────────
  const statusJob = cron.schedule('*/15 * * * *', () => {
    const stats = getAllQueuesStats();
    const hasActivity = Object.values(stats).some(
      (s) => s.active > 0 || s.waiting > 0,
    );

    if (hasActivity) {
      console.log('📊 [Filas] Status:');
      for (const [name, s] of Object.entries(stats)) {
        if (s.total > 0) {
          console.log(
            `   ${name}: ⏳${s.waiting} 🔄${s.active} ✅${s.completed} ❌${s.failed}`,
          );
        }
      }
    }
  });
  jobs.push(statusJob);

  // ── Limpeza semanal: domingo às 3h ────────────────────────
  const cleanupJob = cron.schedule('0 3 * * 0', async () => {
    console.log('🧹 [Cron] Executando limpeza semanal...');
    try {
      // Limpar logs de scraping com mais de 30 dias
      const logsCleaned = await prisma.logScraping.deleteMany({
        where: {
          criadoEm: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      });

      // Limpar notificações lidas com mais de 90 dias
      const notifCleaned = await prisma.notificacao.deleteMany({
        where: {
          lidaEm: { not: null },
          criadoEm: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        },
      });

      console.log(
        `🧹 [Cron] Limpeza: ${logsCleaned.count} logs + ${notifCleaned.count} notificações removidas`,
      );
    } catch (error) {
      console.error('❌ [Cron] Erro na limpeza:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });
  jobs.push(cleanupJob);

  console.log('  ├─ 🔄 Sincronização de processos: a cada 6 horas');
  console.log('  ├─ 📅 Verificação de prazos: a cada 30 minutos');
  console.log('  ├─ 📊 Resumo diário: 08:00 (seg-sex)');
  console.log('  ├─ 📊 Status das filas: a cada 15 minutos');
  console.log('  └─ 🧹 Limpeza semanal: dom 03:00');
  console.log('');
}

/**
 * Para todos os cron jobs
 */
export function pararCronJobs(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
  console.log('⏰ Agendamentos parados');
}

/**
 * Dispara sincronização imediata (para uso manual via API)
 */
export async function dispararSyncImediata(): Promise<number> {
  console.log('🔄 [Manual] Sincronização imediata disparada...');
  return enfileirarProcessosPendentes();
}
