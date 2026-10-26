# Gateway dashboard

The dashboard is a Next.js App Router application using the gateway's typed
tRPC API with TanStack Query. It provides login, server and member
administration, personal API-key management, audit browsing, and a placeholder
chat page.

## Local development

Start PostgreSQL and the gateway first, then run:

```sh
pnpm --filter @repo/web dev
```

Open `http://localhost:3000/login`. In development, Next rewrites `/api/*` and
`/mcp` to `http://localhost:4000`, keeping browser requests same-origin. Set
`GATEWAY_ORIGIN` to override that gateway origin. In production, the dashboard
ingress sends `/api/*` and `/mcp` directly to the gateway.

Server credentials are write-only: the browser sends them only when adding or
changing an upstream. Server list and mutation responses contain no credential
value; edit forms never prefill secrets.
