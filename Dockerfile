# ── Stage 1: Build React frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app/client

# Passed in by the build command (e.g. --build-arg GIT_COMMIT=$(git rev-parse --short HEAD))
# so vite.config.js can embed the commit hash without needing git inside the container.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

# Server dependencies only (no devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Server source
COPY server/ ./server/

# Pre-built frontend from stage 1
COPY --from=frontend /app/client/dist ./client/dist

# Create backups directory and set ownership (node user from base image)
RUN mkdir -p backups && chown -R node:node /app
USER node

EXPOSE 3001
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3001/ || exit 1

CMD ["node", "server/index.js"]
