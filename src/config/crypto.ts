import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { env } from './env.js';

/**
 * Módulo de criptografia AES-256-GCM para armazenar credenciais
 * dos tribunais de forma segura no banco de dados.
 *
 * As credenciais do advogado (login/senha dos tribunais) NUNCA
 * ficam em texto plano no banco.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const ENCODING = 'hex' as const;

function getEncryptionKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

/**
 * Criptografa um texto usando AES-256-GCM
 * Retorna: iv:authTag:textoCriptografado (tudo em hex)
 */
export function encrypt(plainText: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plainText, 'utf8', ENCODING);
  encrypted += cipher.final(ENCODING);

  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:dadosCriptografados
  return `${iv.toString(ENCODING)}:${authTag.toString(ENCODING)}:${encrypted}`;
}

/**
 * Descriptografa um texto criptografado com AES-256-GCM
 * Espera o formato: iv:authTag:textoCriptografado
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Formato de texto criptografado inválido');
  }

  const iv = Buffer.from(parts[0], ENCODING);
  const authTag = Buffer.from(parts[1], ENCODING);
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, ENCODING, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Gera uma chave de criptografia aleatória (para setup inicial)
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Verifica se a chave de criptografia é válida
 */
export function validateEncryptionKey(): boolean {
  try {
    const testText = 'moreira-xavier-test';
    const encrypted = encrypt(testText);
    const decrypted = decrypt(encrypted);
    return decrypted === testText;
  } catch {
    return false;
  }
}
