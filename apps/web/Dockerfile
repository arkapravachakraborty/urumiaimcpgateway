FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.7.2 prune @repo/web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
RUN pnpm --filter @repo/db db:generate
RUN pnpm --filter @repo/web build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 web && \
    useradd --system --uid 1001 --gid web --create-home web
COPY --from=builder --chown=web:web /app/apps/web/.next/standalone ./
COPY --from=builder --chown=web:web /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=web:web /app/apps/web/public ./apps/web/public
USER web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
