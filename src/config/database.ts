import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(maxTentativas = 8, delayMs = 5000): Promise<void> {
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      await prisma.$connect();
      console.log('✅ Banco de dados conectado com sucesso');
      return;
    } catch (error: any) {
      console.warn(`⚠️ Tentativa ${tentativa}/${maxTentativas} de conexão com o banco falhou: ${error.message}`);
      if (tentativa === maxTentativas) {
        console.error('❌ Não foi possível conectar ao banco de dados após várias tentativas.');
        // Em produção, não matar o processo se quisermos que o Render continue servindo o health check
        if (env.NODE_ENV === 'development') {
          process.exit(1);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('🔌 Banco de dados desconectado');
}
