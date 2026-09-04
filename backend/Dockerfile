# ---------------------------------------------------------------------------
# Backend Dockerfile
# ---------------------------------------------------------------------------

# --- Stage 1: Base (OS dependencies) ---
FROM node:20-alpine AS base
# Install LibreOffice for DOCX to PDF conversion
RUN apk update && apk add --no-cache libreoffice font-liberation

# --- Stage 2: Builder ---
FROM base AS builder
WORKDIR /app
# Install all dependencies (including devDependencies for local dev)
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# --- Stage 3: Production ---
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

# Run as non-root user
RUN chown -R node:node /app
USER node

# Copy only production dependencies and source from builder stage
COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/scripts ./scripts

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["npm", "start"]
