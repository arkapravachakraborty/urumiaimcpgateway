FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.7.2 prune @repo/gateway --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
RUN pnpm --filter @repo/db db:generate
RUN pnpm exec turbo run build --filter=@repo/gateway...

FROM base AS production-deps
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 1001 app && \
    useradd --system --uid 1001 --gid app --create-home app
COPY --from=production-deps --chown=app:app /app/ ./
COPY --from=pruner --chown=app:app /app/out/full/ ./
COPY --from=builder --chown=app:app /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder --chown=app:app /app/packages/db/prisma ./packages/db/prisma
RUN node packages/db/node_modules/prisma/build/index.js generate --schema packages/db/prisma/schema.prisma
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && exec node apps/gateway/dist/index.js"]
