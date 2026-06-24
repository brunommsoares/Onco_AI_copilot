# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# ── Stage 2: Production backend ───────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install production dependencies only
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ .

# Copy built frontend so Express serves it as static files (NODE_ENV=production)
COPY --from=frontend-build /build/frontend/dist ./public

# Persistent data directory for SQLite trial registry
RUN mkdir -p data

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app
USER appuser

EXPOSE 5000
ENV NODE_ENV=production

CMD ["node", "src/server.js"]
