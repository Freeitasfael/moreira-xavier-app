FROM mcr.microsoft.com/playwright:v1.50.0-jammy

# Configurar diretório de trabalho
WORKDIR /app

# Instalar dependências
COPY package.json package-lock.json ./
RUN npm ci

# Gerar Prisma Client
COPY prisma ./prisma
RUN npx prisma generate

# Copiar o restante do código e compilar
COPY . .
RUN npm run build

# O Playwright já inclui os navegadores. A flag HEADLESS é importante
ENV SCRAPING_HEADLESS=true
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Iniciar o servidor
CMD ["npm", "start"]
