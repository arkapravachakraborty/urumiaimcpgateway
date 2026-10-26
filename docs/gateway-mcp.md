# Gateway MCP and API

The gateway exposes stateless Streamable HTTP at `POST /mcp`, liveness at
`GET /healthz`, database readiness at `GET /readyz`, password login/logout, and
tRPC at `/api/trpc`. Users and enabled upstreams are loaded from PostgreSQL
through Prisma. Each upstream request uses a fresh MCP SDK client connection.

## Environment

- `DATABASE_URL`: PostgreSQL connection string.
- `ENCRYPTION_KEY`: AES-256-GCM key, either 32 raw bytes encoded as base64 or
  64 hexadecimal characters. `scripts/create-secrets.sh` generates and stores
  one in `.env.local`.
- `SESSION_SECRET`: at least 32 characters (generate with
  `openssl rand -base64 48`), used to sign seven-day browser
  sessions and 60-second internal MCP tokens. Keep it stable across restarts.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: startup-seeded gateway administrator
  credentials. The gateway syncs this account to the configured password at
  startup; the local secret script generates a password if missing.
- `GATEWAY_PORT`: listener port; defaults to `4000`.
- `MCP_ALLOWED_HOSTS`: optional comma-separated additional Host names accepted
  by the MCP Express middleware. Localhost and `dashboard.localtest.me` are
  allowed by default.
- `MCP_WOO_URL`, `MCP_NOTES_URL`, `MCP_UTILS_URL`: upstream URL overrides;
  default to local endpoints on ports 3003, 3001, and 3002. On startup, the
  gateway registers the `woo` upstream only if it does not already exist.
- `MCP_AUTH_TOKEN`: optional bearer token used by the Woo MCP app and encrypted
  by the gateway seeder when the
  seeded `woo` upstream requires MCP authentication.

Environment values are loaded from root `.env.local`, then `.env`, without
overriding variables already set by the process.

## Seed and run locally

1. Set `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_EMAIL`, and
   `ADMIN_PASSWORD` in `.env.local`. Start PostgreSQL, run
   `pnpm --filter @repo/db db:generate`, then apply migrations with
   `pnpm --filter @repo/db db:migrate`.
2. Start `@repo/mcp-notes`, `@repo/mcp-utils`, and `@repo/woo-mcp` in separate
   terminals. Configure WooCommerce as described in [woo-mcp.md](./woo-mcp.md).
3. Run `pnpm --filter @repo/gateway seed:upstreams` to register `notes` and
   `utils` and refresh the local upstream URLs. Configure the same
   `MCP_AUTH_TOKEN` for Woo MCP and the gateway if enabled.
4. Start the gateway with `pnpm --filter @repo/gateway dev`. Startup creates or
   syncs the admin user and creates the `woo` upstream only when it is missing.
5. Connect MCP Inspector to `http://localhost:4000/mcp` and set an
   `Authorization: Bearer mcpgw_...` header. API keys are created in tRPC and
   their raw value is displayed only once.

## Authentication and tRPC

`POST /api/auth/login` accepts `{ "email": "...", "password": "..." }` and
returns the signed-in user while setting the httpOnly, SameSite=Lax
`mcp_gateway_session` cookie. `POST /api/auth/logout` clears that cookie.
Disabled accounts cannot log in or use an existing session.

The tRPC endpoint is `/api/trpc`. Procedures are grouped under `servers`,
`members`, `keys`, and `audit`. Server/member administration requires the
`ADMIN` role. Members may create, list, and revoke their own API keys and view
their own audit rows; administrators can manage other users' keys and query all
audit rows. Use the shared schemas in `@repo/schemas` for validated procedure
inputs and outputs. Server API responses expose only a `hasCredential` flag,
never the encrypted or plaintext upstream credential.

Procedures: `servers.list/create/update/setEnabled/remove/testConnection`,
`members.list/create/disable`, `keys.create/listMine/revoke/listAll/revokeAny`,
and `audit.list`. `members.create` generates a temporary password and returns
it once. `keys.create` returns the raw API key once; subsequent key listings
return only the short prefix.

The MCP endpoint accepts API keys (`mcpgw_<random>`) or a signed internal JWT.
API keys are stored as SHA-256 hashes; every HTTP request checks the current
key revocation state and account status in PostgreSQL and updates `lastUsedAt`.
Thus, after revocation, the next MCP request receives HTTP 401. Internal tokens
are limited to 60 seconds and are resolved to the current enabled user for
audit attribution.

Example login and API key issue with curl:

```sh
curl -i -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"admin@localtest.me","password":"<ADMIN_PASSWORD>"}' \
  http://localhost:4000/api/auth/login

curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"json":{"name":"inspector"}}' \
  http://localhost:4000/api/trpc/keys.create
```

Use the returned `key` as `Authorization: Bearer <key>` for MCP. Then call
`keys.revoke` with its ID through the cookie-authenticated tRPC endpoint; the
next request with that key will return 401.

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
