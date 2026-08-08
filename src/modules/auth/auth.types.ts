import { z } from 'zod';

// ─── Schemas de validação (Auth) ────────────────────────────

export const registroSchema = z.object({
  nome: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  email: z.string().email('Email inválido'),
  senha: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  oabNumero: z.string().min(3, 'Número da OAB inválido'),
  oabUf: z.string().length(2, 'UF deve ter 2 caracteres').toUpperCase(),
  telefone: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  senha: z.string().min(1, 'Senha é obrigatória'),
});

export const credencialTribunalSchema = z.object({
  tribunal: z.string().min(1, 'Tribunal é obrigatório'),
  sistema: z.enum(['EPROC_TJMG', 'PJE', 'ESAJ', 'EPROC_TRF', 'DJEN', 'MNI']),
  login: z.string().min(1, 'Login é obrigatório'),
  senha: z.string().min(1, 'Senha é obrigatória'),
});

// ─── Types ──────────────────────────────────────────────────

export type RegistroInput = z.infer<typeof registroSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CredencialTribunalInput = z.infer<typeof credencialTribunalSchema>;

export interface JwtPayload {
  id: string;
  email: string;
  oabNumero: string;
  oabUf: string;
}

export interface AuthResponse {
  token: string;
  advogado: {
    id: string;
    nome: string;
    email: string;
    oabNumero: string;
    oabUf: string;
  };
}
