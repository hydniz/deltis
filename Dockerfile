# ── Stage 1: React-Frontend bauen ─────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: Production-Image ──────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Nur Server-Abhängigkeiten (keine devDeps)
COPY package*.json ./
RUN npm ci --omit=dev

# Server-Code
COPY server/ ./server/

# Gebautes Frontend aus Stage 1
COPY --from=frontend /app/client/dist ./client/dist

# Backups-Verzeichnis anlegen und Rechte setzen (node-User aus Base-Image)
RUN mkdir -p backups && chown -R node:node /app
USER node

EXPOSE 3001
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3001/ || exit 1

CMD ["node", "server/index.js"]
