# Gateway MCP core

The gateway exposes stateless Streamable HTTP at `POST /mcp`, liveness at
`GET /healthz`, and database readiness at `GET /readyz`. It loads enabled
upstreams and audit users from PostgreSQL through Prisma. Each upstream request
uses a fresh MCP SDK client connection.

## Environment

- `DATABASE_URL`: PostgreSQL connection string.
- `ENCRYPTION_KEY`: AES-256-GCM key, either 32 raw bytes encoded as base64 or
  64 hexadecimal characters. `scripts/create-secrets.sh` generates and stores
  one in `.env.local`.
- `DEV_USER_ID`: ID of an existing, enabled database user. This development
  identity is used for tool-call audits until the real API authentication is
  implemented. Calls are rejected if this user is missing or disabled.
- `GATEWAY_PORT`: listener port; defaults to `4000`.
- `MCP_ALLOWED_HOSTS`: optional comma-separated additional Host names accepted
  by the MCP Express middleware. Localhost and `dashboard.localtest.me` are
  allowed by default.
- `MCP_WOO_URL`, `MCP_NOTES_URL`, `MCP_UTILS_URL`: seed overrides; default to
  the local upstream endpoints on ports 3003, 3001, and 3002.
- `MCP_AUTH_TOKEN`: optional bearer token used by the Woo MCP app and encrypted
  by the gateway seeder when the
  seeded `woo` upstream requires MCP authentication.

Environment values are loaded from root `.env.local`, then `.env`, without
overriding variables already set by the process.

## Seed and run locally

1. Set `DATABASE_URL` and `ENCRYPTION_KEY` in `.env.local`. Start PostgreSQL,
   run `pnpm --filter @repo/db db:generate`, then apply the database migrations
   and seed a user with `pnpm --filter @repo/db db:migrate` and
   `pnpm --filter @repo/db db:seed`.
2. Set `DEV_USER_ID` to the seeded user's ID. The seed command prints that ID.
3. In separate terminals, start the `@repo/mcp-notes`, `@repo/mcp-utils`, and
   `@repo/woo-mcp` apps. Configure the WooCommerce app's store environment as
   described in [woo-mcp.md](./woo-mcp.md).
4. Run `pnpm --filter @repo/gateway seed:upstreams` to upsert the enabled
   `woo`, `notes`, and `utils` upstream rows. Set the same `MCP_AUTH_TOKEN` for
   the Woo MCP app and gateway seeder if it is enabled; the seeder encrypts it
   before storing it.
5. Start the gateway with `pnpm --filter @repo/gateway dev`. Connect MCP
   Inspector using the Streamable HTTP URL `http://localhost:4000/mcp`.

The encryption format stored in `McpServer.encryptedCredential` is
`v1:<base64-iv>:<base64-auth-tag>:<base64-ciphertext>`. The AES-GCM IV is
12 bytes and the authentication tag is 16 bytes. Credentials are never logged.
The same `ENCRYPTION_KEY` must be retained to decrypt existing server
credentials; rotating it requires re-encrypting those records.

## Discovery, calls, and health

Tool discovery queries all enabled, non-`UNREACHABLE` upstreams concurrently.
Each live `tools/list` has a 3-second timeout; an upstream failure uses its
validated `cachedTools` value where available, without blocking other servers.
Names are prefixed as `<serverSlug>__<toolName>` and constrained to the
repository's tool-name format.

Calls split the first `__` delimiter, check that the server still exists and is
enabled, then forward the tool arguments. The configured per-server
`callTimeoutMs` applies (15 seconds by default). Every call records an audit
row, including rejected, failed, and timed-out calls. Error strings are
truncated before storage.

The health checker runs immediately at startup and every 15 seconds thereafter.
It probes each server's `tools/list` in parallel with a 3-second timeout,
updating status, checked time, last error, and cached tools independently per
server. A failed upstream does not prevent healthy upstreams from being
discovered or called.

Focused checks:

```sh
pnpm --filter @repo/gateway test
pnpm --filter @repo/gateway typecheck
pnpm --filter @repo/gateway lint
pnpm --filter @repo/gateway build
```
