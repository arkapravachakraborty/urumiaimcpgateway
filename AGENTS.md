PROJECT: "WooCommerce hosting with a Team MCP Gateway" - an MVP that runs on local
Kubernetes (k3d) and deploys to a k3s VPS with the SAME Helm chart, differing only
in values files.

LAYOUT (pnpm + Turborepo, all TypeScript):

- apps/web: Next.js dashboard, UI only.
- apps/gateway: Express service. Serves POST /mcp (MCP Streamable HTTP, stateless),
  tRPC at /api/trpc, POST /api/chat (streaming agent), GET /healthz and /readyz,
  and runs a background upstream health checker.
- apps/woo-mcp: my own MCP server for WooCommerce (REST API client).
- apps/mcp-notes, apps/mcp-utils: two small extra MCP servers.
- packages/db (Prisma+Postgres), packages/schemas (Zod), packages/mcp-kit (shared
  MCP-server helpers), plus the template's config packages.
- charts/platform: ONE Helm chart. Files: values.yaml, values-local.yaml,
  values-prod.yaml. No Kustomize. No Bitnami subcharts (write our own manifests).
- scripts/: cluster, secrets, image build, e2e.

DECISIONS:

- Ingress: dashboard host routes /mcp, /api/trpc, /api/chat to gateway, everything
  else to web (same origin, so no CORS). Store host routes to WordPress.
  Local hosts: shop.localtest.me and dashboard.localtest.me on port 8080.
- Tool naming: gateway exposes "<serverSlug>\__<toolName>" (slug is lowercase
  [a-z0-9-], names must match ^[a-zA-Z0-9_-]{1,64}$).
- Gateway is stateless per request: authenticate, then open a fresh MCP client
  connection to the upstream for each call, with timeouts (list 3s, call 15s).
  The health checker updates server status (CONNECTED/UNREACHABLE/DISABLED) every 15s.
  One dead upstream must never affect listing or calls to others (Promise.allSettled).
- Auth: roles ADMIN and MEMBER. Dashboard login = email+password (bcryptjs) with an
  httpOnly JWT session cookie (jose). API keys look like "mcpgw\_<random>", stored as
  SHA-256 hash plus a short prefix, shown once, revocable, looked up on EVERY request
  (no caching). The chat agent calls the gateway's own /mcp using a 60-second internal
  JWT for the logged-in user, so audit logs attribute calls correctly.
- Upstream credentials are encrypted at rest (AES-256-GCM, key from env) and never
  returned by any API.
- Audit log row: user, server slug, tool, startedAt, durationMs, status
  (success|error|timeout|rejected), truncated error, source (mcp|chat).
- Secrets: NEVER committed. Kubernetes Secrets created by scripts/create-secrets.sh
  from the ignored root .env plus generated random values. Helm only references
  secret names; .env.example is a safe template only.
- Every workload has readiness and liveness probes and resource requests/limits.
- woo-mcp is a ClusterIP service protected by a NetworkPolicy allowing only the gateway.
- LLM: Vercel AI SDK with a provider switch via env (google, or any OpenAI-compatible
  endpoint such as Groq/OpenRouter/Ollama). Check current docs before using APIs.

RULES: strict TypeScript, Zod validation at every boundary, no secrets in code, small
commits, keep READMEs updated. When an API is uncertain (MCP SDK, AI SDK, Prisma,
WooCommerce), read the current official docs first instead of guessing.
