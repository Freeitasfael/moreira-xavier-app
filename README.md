# Moreira & Xavier — Sistema de Acompanhamento Processual

Sistema automatizado de monitoramento de processos judiciais para advogados, com foco em **Minas Gerais** e expansão nacional.

## 🚀 Início Rápido

### Pré-requisitos
- **Node.js** 20+ (LTS)
- **Docker** e **Docker Compose** (para PostgreSQL e Redis)

### 1. Clonar e instalar dependências
```bash
npm install
```

### 2. Iniciar banco de dados e Redis
```bash
docker-compose up -d
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite o .env com suas configurações
```

### 4. Executar migrations do banco
```bash
npx prisma migrate dev --name init
```

### 5. Iniciar o servidor
```bash
npm run dev
```

Acesse: **http://localhost:3000**

## 📡 Fontes de Dados

| Fonte | Status | Cobertura |
|-------|--------|-----------|
| DataJud (CNJ) | ✅ Implementado | Nacional |
| eproc TJMG | 🔜 Fase 3 | Minas Gerais |
| DJEN | 🔜 Fase 3 | Nacional |

## 🔐 Segurança

- Senhas hashadas com **bcrypt** (12 rounds)
- Credenciais dos tribunais criptografadas com **AES-256-GCM**
- Autenticação via **JWT**
- Conformidade **LGPD**

## 🏗️ Arquitetura

- **Runtime**: Node.js + TypeScript
- **API**: Fastify 5
- **Banco**: PostgreSQL 16 (Prisma ORM)
- **Filas**: BullMQ + Redis
- **Scraping**: Playwright
- **Frontend**: SPA (HTML/CSS/JS)

## 📄 Licença

Proprietário — Moreira & Xavier Advogados
