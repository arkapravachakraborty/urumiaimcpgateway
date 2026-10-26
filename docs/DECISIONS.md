# Architecture decisions

This document records the platform's current security and integration
decisions, their tradeoffs, and the main follow-up work. For the deployable
topology, see [DEPLOY-K3S.md](./DEPLOY-K3S.md).

## Collision-safe MCP tool names

The gateway exposes each upstream tool as `<serverSlug>__<toolName>`, for
example `woo__list_orders`, `notes__search`, or `utils__search`. Server slugs
are lowercase letters, digits, and hyphens; upstream tool names are validated
against `^[a-zA-Z0-9_-]{1,64}$`.

Tool names are only unique within an MCP server, and separate servers can
legitimately publish the same name (the notes and utils servers both provide
`search`). Prefixing every name with its stable server slug makes names
unambiguous, allows the gateway to route a call without guessing, and gives
clients and audit records a clear upstream association. The tradeoff is that
clients must use the prefixed name and names change if an administrator
renames a server slug.

## Upstream credentials stay server-side

The dashboard/API never returns stored upstream credentials. The gateway
encrypts credentials before database storage with AES-256-GCM using the
server-side `ENCRYPTION_KEY`; it decrypts them only when connecting to an
upstream. Kubernetes receives the key through a Secret reference, not through
Helm values or a container image. The encryption key must be backed up
securely: losing or rotating it without re-encrypting stored credentials
makes those credentials unreadable.

This protects credentials in database rows and API responses, but does not
replace access controls for the running gateway, database, Kubernetes API, or
Secret store. Kubernetes Secrets need restricted RBAC and encryption at rest
for a production cluster.

## API keys are hashed; sessions are separate

Gateway API keys use the `mcpgw_` prefix. The raw value is shown once at
creation; the database stores its SHA-256 hash and a short display prefix.
Every authenticated request hashes and looks up the presented key and checks
that the key and user are still active. This makes revocation effective on
the next request and avoids storing reusable API credentials in plaintext.

The dashboard uses an httpOnly session cookie, while the chat agent uses a
short-lived internal JWT when calling the gateway's own MCP endpoint. These
auth paths let audit events retain the originating user and distinguish
`chat` from external `mcp` calls.

## Timeouts and failure isolation

The gateway opens a fresh upstream MCP connection for each request instead of
keeping one shared connection per user. Tool discovery uses a short
three-second timeout; tool calls use a 15-second timeout. The background
health checker runs approximately every 15 seconds. Live tool discovery and
health checks isolate upstream failures using settled parallel requests, so
one slow or unavailable server does not prevent healthy upstreams from being
listed or called.

The stateless design avoids shared-session lifecycle and cross-user state
problems, at the cost of connection setup overhead on every operation.
Discovery may use cached tools if an enabled upstream cannot be contacted;
calls still go to the upstream and fail clearly if it is unavailable. Health
status is eventually consistent with the checker interval, not instantaneous.

## Local domains use `localtest.me`

The local k3d cluster binds host port 8080 and routes by hostname:
`dashboard.localtest.me` serves the dashboard/gateway routes and
`shop.localtest.me` serves WordPress. `localtest.me` resolves to loopback
without requiring a public DNS zone or per-developer hosts-file entries.
The two hosts model the production split while keeping browser requests
same-origin for the dashboard and its API.

The tradeoff is dependence on external DNS resolution for `localtest.me` and
possible interference from VPNs, DNS filters, or port conflicts. For those
environments, use a hosts-file override and/or port-forward Traefik locally.
This domain is for local development only; use real DNS names and TLS in
production.

## WooCommerce uses the REST API

The WooCommerce MCP server talks to `/wp-json/wc/v3` over HTTP(S) using
WooCommerce consumer-key credentials. This is a stable, documented contract
with per-key read/write permissions. It works over the network from a
separate pod and does not require PHP runtime access, filesystem mounts, or
WP-CLI access to the WordPress container.

The REST API adds HTTP/network latency and depends on WordPress, WooCommerce,
permalinks, and correct proxy handling. Keys need only the permissions the
tools require, must remain server-side, and should be used over HTTPS for an
external store. Proxies that strip Basic Authorization headers can break
authentication; `WC_PUBLIC_HOST` sets the outgoing Host header but does not
repair TLS or header forwarding. See [woo-mcp.md](./woo-mcp.md).

## Known limitations and next steps

- The bundled PostgreSQL and MariaDB databases are single-instance
  StatefulSets. PVCs are persistent, but persistence is not a backup or
  high-availability strategy.
- The chart provides starter resource requests/limits and replica settings;
  production operators should load-test, size storage, configure monitoring,
  and define backup/restore procedures for both databases and WordPress
  uploads.
- The notes server stores notes in memory, so its data resets when its pod
  restarts.
- Upstream status is refreshed periodically. A status badge can lag a failure
  or recovery by one health-check cycle.
- The chat UI depends on a configured external LLM provider. Provider
  availability, costs, rate limits, and model tool-calling behavior are
  outside the gateway's control.
- WooCommerce operations are constrained to the tools implemented by
  `apps/woo-mcp`; this is not a complete WooCommerce administration surface.
- Local demos use HTTP on the local ingress. Production must use public DNS,
  TLS, restricted administrative access, strong secrets, and encrypted
  Kubernetes Secret storage.

Next, I would prioritize scheduled encrypted backups and restore drills,
metrics/alerting, resource and load testing, and a production-grade
high-availability database and storage plan. I would then extend the
WooCommerce tool coverage based on real operator needs, with narrowly scoped
API-key permissions and tests for each new operation.
