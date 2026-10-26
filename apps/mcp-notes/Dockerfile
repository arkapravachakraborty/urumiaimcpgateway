FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.7.2 prune @repo/mcp-notes --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
RUN pnpm exec turbo run build --filter=@repo/mcp-notes...

FROM base AS production-deps
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
RUN groupadd --system --gid 1001 app && \
    useradd --system --uid 1001 --gid app --create-home app
COPY --from=production-deps --chown=app:app /app/ ./
COPY --from=pruner --chown=app:app /app/out/full/ ./
COPY --from=builder --chown=app:app /app/apps/mcp-notes/dist ./apps/mcp-notes/dist
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/mcp-notes/dist/index.js"]
