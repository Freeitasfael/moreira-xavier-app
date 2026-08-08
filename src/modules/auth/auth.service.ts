import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import { encrypt, decrypt } from '../../config/crypto.js';
import type {
  RegistroInput,
  LoginInput,
  CredencialTribunalInput,
  AuthResponse,
  JwtPayload,
} from './auth.types.js';

const SALT_ROUNDS = 12;

export class AuthService {
  /**
   * Registra um novo advogado no sistema
   */
  async registrar(input: RegistroInput): Promise<AuthResponse> {
    // Verificar se email já existe
    const existente = await prisma.advogado.findUnique({
      where: { email: input.email },
    });

    if (existente) {
      throw new Error('Email já cadastrado');
    }

    // Hash da senha
    const senhaHash = await bcrypt.hash(input.senha, SALT_ROUNDS);

    // Criar advogado
    const advogado = await prisma.advogado.create({
      data: {
        nome: input.nome,
        email: input.email,
        senhaHash,
        oabNumero: input.oabNumero,
        oabUf: input.oabUf,
        telefone: input.telefone,
        // Criar configuração de notificação padrão
        configuracoes: {
          create: {
            emailAtivo: true,
            whatsappAtivo: false,
            resumoDiario: true,
            horaResumo: '08:00',
            alertaPrazoDias: 2,
          },
        },
      },
    });

    return {
      token: '', // Será preenchido pelo controller com fastify.jwt
      advogado: {
        id: advogado.id,
        nome: advogado.nome,
        email: advogado.email,
        oabNumero: advogado.oabNumero,
        oabUf: advogado.oabUf,
      },
    };
  }

  /**
   * Autentica um advogado
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const advogado = await prisma.advogado.findUnique({
      where: { email: input.email },
    });

    if (!advogado) {
      throw new Error('Credenciais inválidas');
    }

    if (!advogado.ativo) {
      throw new Error('Conta desativada');
    }

    const senhaValida = await bcrypt.compare(input.senha, advogado.senhaHash);
    if (!senhaValida) {
      throw new Error('Credenciais inválidas');
    }

    return {
      token: '', // Será preenchido pelo controller
      advogado: {
        id: advogado.id,
        nome: advogado.nome,
        email: advogado.email,
        oabNumero: advogado.oabNumero,
        oabUf: advogado.oabUf,
      },
    };
  }

  /**
   * Retorna o payload JWT para um advogado
   */
  getJwtPayload(advogado: AuthResponse['advogado']): JwtPayload {
    return {
      id: advogado.id,
      email: advogado.email,
      oabNumero: advogado.oabNumero,
      oabUf: advogado.oabUf,
    };
  }

  /**
   * Busca advogado por ID
   */
  async buscarPorId(id: string) {
    return prisma.advogado.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        oabNumero: true,
        oabUf: true,
        telefone: true,
        ativo: true,
        criadoEm: true,
      },
    });
  }

  // ─── Credenciais dos Tribunais ──────────────────────────────

  /**
   * Salva credenciais de um tribunal (criptografadas)
   */
  async salvarCredencial(advogadoId: string, input: CredencialTribunalInput) {
    const loginEnc = encrypt(input.login);
    const senhaEnc = encrypt(input.senha);

    return prisma.credencialTribunal.upsert({
      where: {
        advogadoId_tribunal: {
          advogadoId,
          tribunal: input.tribunal,
        },
      },
      update: {
        loginEnc,
        senhaEnc,
        sistema: input.sistema as any,
        ativo: true,
      },
      create: {
        advogadoId,
        tribunal: input.tribunal,
        sistema: input.sistema as any,
        loginEnc,
        senhaEnc,
      },
    });
  }

  /**
   * Recupera credenciais descriptografadas de um tribunal
   */
  async obterCredencial(advogadoId: string, tribunal: string) {
    const credencial = await prisma.credencialTribunal.findUnique({
      where: {
        advogadoId_tribunal: {
          advogadoId,
          tribunal,
        },
      },
    });

    if (!credencial) return null;

    return {
      ...credencial,
      login: decrypt(credencial.loginEnc),
      senha: decrypt(credencial.senhaEnc),
    };
  }

  /**
   * Lista tribunais com credenciais cadastradas (sem expor senhas)
   */
  async listarCredenciais(advogadoId: string) {
    return prisma.credencialTribunal.findMany({
      where: { advogadoId },
      select: {
        id: true,
        tribunal: true,
        sistema: true,
        ativo: true,
        ultimoAcesso: true,
        criadoEm: true,
      },
    });
  }

  /**
   * Remove credencial de um tribunal
   */
  async removerCredencial(advogadoId: string, tribunal: string) {
    return prisma.credencialTribunal.delete({
      where: {
        advogadoId_tribunal: {
          advogadoId,
          tribunal,
        },
      },
    });
  }
}

export const authService = new AuthService();
