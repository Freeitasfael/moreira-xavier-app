-- CreateEnum
CREATE TYPE "StatusProcesso" AS ENUM ('ATIVO', 'ARQUIVADO', 'SUSPENSO', 'BAIXADO', 'ERRO_SYNC');

-- CreateEnum
CREATE TYPE "SistemaOrigem" AS ENUM ('DATAJUD', 'EPROC_TJMG', 'PJE', 'ESAJ', 'EPROC_TRF', 'DJEN', 'MNI', 'MANUAL');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('DESPACHO', 'DECISAO', 'SENTENCA', 'ACORDAO', 'INTIMACAO', 'CITACAO', 'PETICAO', 'JUNTADA', 'DISTRIBUICAO', 'AUDIENCIA', 'REMESSA', 'BAIXA', 'RECURSO', 'OUTROS');

-- CreateEnum
CREATE TYPE "TipoPrazo" AS ENUM ('CONTESTACAO', 'RECURSO', 'MANIFESTACAO', 'EMBARGOS', 'IMPUGNACAO', 'CUMPRIMENTO', 'PAGAMENTO', 'AUDIENCIA', 'PERICIA', 'GENERICO');

-- CreateEnum
CREATE TYPE "StatusPrazo" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'CUMPRIDO', 'PERDIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoNotificacao" AS ENUM ('NOVA_MOVIMENTACAO', 'PRAZO_PROXIMO', 'PRAZO_CRITICO', 'PRAZO_VENCIDO', 'RESUMO_DIARIO', 'ERRO_SINCRONIZACAO');

-- CreateEnum
CREATE TYPE "CanalNotificacao" AS ENUM ('EMAIL', 'WHATSAPP', 'PUSH', 'SISTEMA');

-- CreateEnum
CREATE TYPE "Prioridade" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- CreateTable
CREATE TABLE "advogados" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "oab_numero" TEXT NOT NULL,
    "oab_uf" CHAR(2) NOT NULL,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advogados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processos" (
    "id" TEXT NOT NULL,
    "numero_cnj" TEXT NOT NULL,
    "tribunal" TEXT NOT NULL,
    "instancia" INTEGER NOT NULL DEFAULT 1,
    "classe" TEXT,
    "assunto" TEXT,
    "comarca" TEXT,
    "vara" TEXT,
    "parte_autora" TEXT,
    "parte_re" TEXT,
    "valor_causa" DECIMAL(15,2),
    "status" "StatusProcesso" NOT NULL DEFAULT 'ATIVO',
    "sistemaOrigem" "SistemaOrigem" NOT NULL DEFAULT 'DATAJUD',
    "ultima_verificacao" TIMESTAMP(3),
    "proxima_verificacao" TIMESTAMP(3),
    "intervalo_verificacao_min" INTEGER NOT NULL DEFAULT 360,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processo_advogado" (
    "id" TEXT NOT NULL,
    "advogado_id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'patrono',
    "adicionado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processo_advogado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "codigo" INTEGER,
    "descricao" TEXT NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL DEFAULT 'DESPACHO',
    "complemento" TEXT,
    "fonte" "SistemaOrigem" NOT NULL DEFAULT 'DATAJUD',
    "hash_conteudo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prazos" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "tipo" "TipoPrazo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "dias_uteis" INTEGER NOT NULL,
    "status" "StatusPrazo" NOT NULL DEFAULT 'PENDENTE',
    "observacao" TEXT,
    "movimentacao_origem_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prazos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "advogado_id" TEXT NOT NULL,
    "processo_id" TEXT,
    "tipo" "TipoNotificacao" NOT NULL,
    "canal" "CanalNotificacao" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "prioridade" "Prioridade" NOT NULL DEFAULT 'NORMAL',
    "enviada_em" TIMESTAMP(3),
    "lida_em" TIMESTAMP(3),
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credenciais_tribunal" (
    "id" TEXT NOT NULL,
    "advogado_id" TEXT NOT NULL,
    "tribunal" TEXT NOT NULL,
    "sistema" "SistemaOrigem" NOT NULL,
    "login_enc" TEXT NOT NULL,
    "senha_enc" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acesso" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credenciais_tribunal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracao_notificacao" (
    "id" TEXT NOT NULL,
    "advogado_id" TEXT NOT NULL,
    "email_ativo" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_ativo" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_numero" TEXT,
    "resumo_diario" BOOLEAN NOT NULL DEFAULT true,
    "hora_resumo" TEXT NOT NULL DEFAULT '08:00',
    "alerta_prazo_dias" INTEGER NOT NULL DEFAULT 2,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_scraping" (
    "id" TEXT NOT NULL,
    "tribunal" TEXT NOT NULL,
    "sistema" "SistemaOrigem" NOT NULL,
    "acao" TEXT NOT NULL,
    "processo_id" TEXT,
    "sucesso" BOOLEAN NOT NULL,
    "tempo_ms" INTEGER,
    "erro" TEXT,
    "detalhes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_scraping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "advogados_email_key" ON "advogados"("email");

-- CreateIndex
CREATE UNIQUE INDEX "processos_numero_cnj_key" ON "processos"("numero_cnj");

-- CreateIndex
CREATE INDEX "processos_tribunal_idx" ON "processos"("tribunal");

-- CreateIndex
CREATE INDEX "processos_status_idx" ON "processos"("status");

-- CreateIndex
CREATE INDEX "processos_proxima_verificacao_idx" ON "processos"("proxima_verificacao");

-- CreateIndex
CREATE UNIQUE INDEX "processo_advogado_advogado_id_processo_id_key" ON "processo_advogado"("advogado_id", "processo_id");

-- CreateIndex
CREATE INDEX "movimentacoes_processo_id_data_idx" ON "movimentacoes"("processo_id", "data" DESC);

-- CreateIndex
CREATE INDEX "movimentacoes_tipo_idx" ON "movimentacoes"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_processo_id_hash_conteudo_key" ON "movimentacoes"("processo_id", "hash_conteudo");

-- CreateIndex
CREATE INDEX "prazos_processo_id_idx" ON "prazos"("processo_id");

-- CreateIndex
CREATE INDEX "prazos_data_fim_idx" ON "prazos"("data_fim");

-- CreateIndex
CREATE INDEX "prazos_status_idx" ON "prazos"("status");

-- CreateIndex
CREATE INDEX "notificacoes_advogado_id_lida_em_idx" ON "notificacoes"("advogado_id", "lida_em");

-- CreateIndex
CREATE INDEX "notificacoes_enviada_em_idx" ON "notificacoes"("enviada_em");

-- CreateIndex
CREATE UNIQUE INDEX "credenciais_tribunal_advogado_id_tribunal_key" ON "credenciais_tribunal"("advogado_id", "tribunal");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_notificacao_advogado_id_key" ON "configuracao_notificacao"("advogado_id");

-- CreateIndex
CREATE INDEX "log_scraping_tribunal_criado_em_idx" ON "log_scraping"("tribunal", "criado_em");

-- CreateIndex
CREATE INDEX "log_scraping_sucesso_idx" ON "log_scraping"("sucesso");

-- AddForeignKey
ALTER TABLE "processo_advogado" ADD CONSTRAINT "processo_advogado_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "advogados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo_advogado" ADD CONSTRAINT "processo_advogado_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prazos" ADD CONSTRAINT "prazos_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "advogados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credenciais_tribunal" ADD CONSTRAINT "credenciais_tribunal_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "advogados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_notificacao" ADD CONSTRAINT "configuracao_notificacao_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "advogados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
