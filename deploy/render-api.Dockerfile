# The fork's api image for Render: the upstream api (api/Dockerfile, default target) plus the
# remote MCP endpoint, which needs mcp/src and the pure training helpers in frontend/src/lib.
# Build context is the repo root (render.yaml).
FROM node:22-alpine

WORKDIR /app
RUN apk upgrade --no-cache && adduser -D -H -s /sbin/nologin coach

COPY api/package.json api/package-lock.json ./api/
RUN cd api && npm ci --omit=dev --omit=optional && npm cache clean --force
COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN cd mcp && npm ci --omit=dev && npm cache clean --force

COPY api/server.js api/push-messages.js api/verify-error.js api/password.js api/rate-limit.js \
     api/passkeys-store.js api/device-link.js api/media.js api/supabase-sync.js ./api/
COPY api/coach ./api/coach
COPY mcp/src ./mcp/src
COPY frontend/src/lib ./frontend/src/lib

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
WORKDIR /app/api
CMD ["node", "server.js"]
HEALTHCHECK --interval=5m --timeout=5s --retries=3 \
  CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
