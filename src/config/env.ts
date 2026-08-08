import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
  // Servidor
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Banco de Dados
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Criptografia
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY deve ter 64 caracteres hex (32 bytes)'),

  // DataJud
  DATAJUD_API_KEY: z.string().min(1),
  DATAJUD_BASE_URL: z.string().url().default('https://api-publica.datajud.cnj.jus.br'),

  // SMTP
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default('Moreira e Xavier <noreply@moreiraxavier.com.br>'),

  // Scraping
  SCRAPING_CONCURRENCY: z.coerce.number().default(3),
  SCRAPING_DELAY_MIN: z.coerce.number().default(2000),
  SCRAPING_DELAY_MAX: z.coerce.number().default(5000),
  SCRAPING_HEADLESS: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // Logs
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
