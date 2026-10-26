# WooCommerce MCP Gateway

A TypeScript pnpm/Turborepo monorepo for WooCommerce hosting and a team MCP
gateway.

## MCP servers

`apps/mcp-notes` and `apps/mcp-utils` expose stateless MCP Streamable HTTP
servers through the shared `@repo/mcp-kit` Express helper. Both provide
`POST /mcp` and public `GET /healthz` endpoints. Set `MCP_BEARER_TOKEN` to
require a bearer token on `/mcp`. The default allowed Host names are localhost,
loopback addresses, and the server name; set `MCP_ALLOWED_HOSTS` to a
comma-separated list when connecting through another hostname.

| App               | Default port | Tools                                 |
| ----------------- | -----------: | ------------------------------------- |
| `@repo/mcp-notes` |         3001 | `add_note`, `list_notes`, `search`    |
| `@repo/mcp-utils` |         3002 | `current_time`, `calculate`, `search` |

Notes are kept in memory and reset when the server restarts. The two servers
intentionally both provide a `search` tool; the gateway prefixes tool names
with the server slug to avoid collisions.

`apps/gateway` serves the stateless team MCP endpoint at port `4000` and
aggregates tools from enabled database upstreams. It provides password login,
httpOnly JWT sessions, per-request API-key authentication, protected tRPC
management routes, and per-upstream encrypted credentials. See
[docs/gateway-mcp.md](./docs/gateway-mcp.md) for environment configuration,
upstream seeding, authentication, and Inspector setup.

`apps/web` is the Next.js dashboard for server and member administration,
personal API keys, audit history, and the streaming chat agent. Run the web app
after starting the gateway with `pnpm --filter @repo/web dev`; it proxies
API/MCP requests to the gateway during local development.

Build all five production images from the repository root with
`bash scripts/build-images.sh --local` to import them into k3d, or configure
GHCR credentials and use `bash scripts/build-images.sh --push`. See
[docs/container-images.md](./docs/container-images.md) for image configuration,
environment variables, and health endpoints.

To start the full local k3d platform (cluster, generated Kubernetes secrets,
all application images, and the Helm release), run
`bash scripts/up.sh`. The dashboard and store are available at
`http://dashboard.localtest.me:8080` and `http://shop.localtest.me:8080`.
See [docs/platform-deployment.md](./docs/platform-deployment.md) for secrets,
routing, network policies, production values, and verification.

Run all workspace development tasks from the repository root with:

```sh
pnpm dev
```

Or run either MCP server alone:

```sh
pnpm --filter @repo/mcp-notes dev
pnpm --filter @repo/mcp-utils dev
```

Use the MCP Inspector with `http://localhost:3001/mcp` or
`http://localhost:3002/mcp`. For an authenticated server, configure the
Inspector to send `Authorization: Bearer <MCP_BEARER_TOKEN>`.

Run the MCP SDK client integration tests and checks with:

```sh
pnpm --filter @repo/mcp-notes test
pnpm --filter @repo/mcp-utils test
pnpm --filter @repo/mcp-notes typecheck
pnpm --filter @repo/mcp-utils typecheck
```
