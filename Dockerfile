# =============================================================================
# Stage 1: Base Dependencies (Shared Node 22 Alpine layer)
# =============================================================================
FROM node:22-alpine AS base

WORKDIR /app

# Copy package manifests first for optimal Docker layer caching
COPY package.json package-lock.json* ./

# Install dependencies cleanly
RUN npm ci

# Copy project source code
COPY . .

# =============================================================================
# Stage 2: Development Mode (Vite HMR + Authoritative Server)
# =============================================================================
FROM base AS dev

RUN npm run generate-assets

EXPOSE 5173 2567

CMD ["npm", "run", "dev:mp", "--", "--host", "0.0.0.0", "--port", "5173"]

# =============================================================================
# Stage 3: Authoritative Multiplayer Co-op Server (titan-hunter-server:prod)
# Build command: docker build --target server -t titan-hunter-server:prod .
# =============================================================================
FROM base AS server

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2567/healthz || exit 1

CMD ["npm", "run", "server"]

# =============================================================================
# Stage 4: Production Client Builder (GLB Assets + TypeScript + Vite Bundle)
# =============================================================================
FROM base AS builder

ARG VITE_SERVER_HOST=""
ENV VITE_SERVER_HOST=${VITE_SERVER_HOST}

RUN npm run generate-assets && npm run build

# =============================================================================
# Stage 5: Production WebGL Client Runtime (titan-hunter-client:prod)
# Build command: docker build --target prod -t titan-hunter-client:prod .
# =============================================================================
FROM nginx:stable-alpine AS prod

ENV SERVER_UPSTREAM=titan-hunter-server:2567

COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
