# ==============================================================================
# Cloud Native Multi-Stage Dockerfile for Svelte Frontend
# Stage 1: Builder (Node.js LTS)
# Stage 2: Production Web Server (Non-root Unprivileged Nginx)
# ==============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Cache package dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source code
COPY . .

# Build static production assets into build/ directory
RUN npm run build

# ==============================================================================
# Stage 2: Production Web Server
# ==============================================================================
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# Copy static assets and custom Nginx reverse proxy / SPA configuration
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Standard unprivileged port
EXPOSE 3000

# Cloud native container health check
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
