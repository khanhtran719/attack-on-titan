# =============================================================================
# Stage 1: Base & Development (Vite HMR Server)
# =============================================================================
FROM node:22-alpine AS dev

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json* ./

# Install dependencies (ignore playwright-core browser download if any)
RUN npm ci

# Copy source code and assets
COPY . .

# Generate static GLB model assets
RUN npm run generate-assets

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# =============================================================================
# Stage 2: Production Builder (TypeScript Check + Vite Bundle)
# =============================================================================
FROM dev AS builder

RUN npm run build

# =============================================================================
# Stage 3: Authoritative Multiplayer Co-op Server (Colyseus + Rapier 3D)
# =============================================================================
FROM dev AS server

EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2567/healthz || exit 1

CMD ["npm", "run", "server"]

# =============================================================================
# Stage 4: Production Runtime (Nginx Alpine serving static + WASM + GLB)
# =============================================================================
FROM nginx:stable-alpine AS prod

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
