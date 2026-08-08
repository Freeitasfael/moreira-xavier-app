/**
 * Barrel export para o sistema de filas e workers
 */

export { TaskQueue, getQueue, getAllQueuesStats } from './task-queue.js';
export { iniciarWorkerScraping, enfileirarProcessosPendentes, enfileirarProcessoUnico } from './scraping.worker.js';
export { iniciarWorkerPrazos, enfileirarVerificacaoPrazos } from './prazos.worker.js';
export { iniciarWorkerNotificacoes, gerarResumoDiario } from './notificacoes.worker.js';
export { iniciarCronJobs, pararCronJobs, dispararSyncImediata } from './scheduler.js';
