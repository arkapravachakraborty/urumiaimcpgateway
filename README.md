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
