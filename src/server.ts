/**
 * Moreira e Xavier — Entry Point
 *
 * Sistema de Acompanhamento Processual
 */

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { validateEncryptionKey } from './config/crypto.js';
import {
  iniciarWorkerScraping,
  iniciarWorkerPrazos,
  iniciarWorkerNotificacoes,
  iniciarCronJobs,
  pararCronJobs,
  enfileirarProcessosPendentes,
  enfileirarVerificacaoPrazos,
} from './queues/index.js';

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║      MOREIRA E XAVIER — Legal Tech       ║');
  console.log('  ║   Sistema de Acompanhamento Processual   ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  // Validar chave de criptografia
  if (!validateEncryptionKey()) {
    console.error('❌ Chave de criptografia inválida. Verifique ENCRYPTION_KEY no .env');
    process.exit(1);
  }
  console.log('🔐 Criptografia validada');

  // Conectar banco de dados
  await connectDatabase();

  // Construir e iniciar o servidor
  const app = await buildApp();

  try {
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    console.log('');
    console.log(`🚀 Servidor rodando em http://localhost:${env.PORT}`);
    console.log(`📊 Dashboard: http://localhost:${env.PORT}`);
    console.log(`📡 API: http://localhost:${env.PORT}/api`);
    console.log(`💚 Health: http://localhost:${env.PORT}/api/health`);
    console.log('');

    // ─── Iniciar Workers e Agendamentos ──────────────────
    iniciarWorkerScraping();
    iniciarWorkerPrazos();
    iniciarWorkerNotificacoes();
    iniciarCronJobs();

    // Primeira sincronização ao iniciar
    console.log('🔄 Executando verificação inicial de prazos...');
    await enfileirarVerificacaoPrazos();

    console.log('');
    console.log('✅ Sistema completamente inicializado!');
    console.log('');
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n⏹️  Recebido ${signal}. Encerrando...`);
    pararCronJobs();
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
