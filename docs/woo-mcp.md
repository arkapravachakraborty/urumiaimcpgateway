# WooCommerce MCP server

`@repo/woo-mcp` exposes a small, authenticated MCP interface to the store through
the documented WooCommerce REST API v3 at `/wp-json/wc/v3`. It does not access
WordPress PHP files, the database, or WP-CLI.

## Why the REST API

- WooCommerce documents the v3 products and orders endpoints as its supported
  JSON API contract.
- API keys can be created with only the read or write permissions this service
  needs, and can be revoked without changing WordPress application code.
- The server can run in a separate Kubernetes pod and talk to the store over
  the network; no shared filesystem or PHP/WP-CLI installation is required.

The trade-offs are that API-key permissions are scoped to a WooCommerce user,
not individually to each MCP tool; REST API behavior and availability depend
on the store and its plugins; and the service has network/API latency and
rate-limit exposure. Use a dedicated WooCommerce user and a minimum-permission
API key. Keep credentials in Kubernetes Secrets and use HTTPS outside the
trusted local cluster network.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `WC_BASE_URL` | Yes | Store origin, for example `https://shop.example.com` or `http://wordpress:80`. The API path is appended automatically. |
| `WC_PUBLIC_HOST` | No | HTTP `Host` header for reverse-proxy or local host-based routing, for example `shop.localtest.me:8080`. |
| `WC_CONSUMER_KEY` | Yes | WooCommerce REST API consumer key. |
| `WC_CONSUMER_SECRET` | Yes | WooCommerce REST API consumer secret. |
| `MCP_AUTH_TOKEN` | No | If set, protects the MCP endpoint with Bearer authentication. |
| `PORT` | No | MCP HTTP port; defaults to `3003`. |

Configuration and API responses are validated with Zod. Consumer credentials
are sent in the HTTP Basic Authorization header, never in the URL, and are not
logged. Requests time out after 10 seconds by default.

## MCP tools

- `list_products`: optional `search`, `status`, `page` (default `1`) and
  `per_page` (default `10`, maximum `100`).
- `create_product`: `name`, `regular_price`, optional `description`, and
  `status` (defaults to `publish`).
- `list_orders`: optional core `status`, ISO 8601 `after` / `before`, `page`
  (default `1`), or `today: true` for the current UTC day. `today` cannot be
  combined with explicit date bounds.
- `get_order`: numeric `id`.
- `update_order_status`: numeric `id` and one of the supported WooCommerce
  statuses: `pending`, `processing`, `on-hold`, `completed`, `cancelled`,
  `refunded`, `failed`, or `checkout-draft`.

Results are concise JSON summaries, not full WooCommerce resource payloads.
Order summaries include at most ten line items.

## Test with a real local-cluster store

The following PowerShell steps port-forward the store to the local machine and
run this MCP server against it. They read credentials from the existing
Kubernetes Secret without printing them. Run each long-lived command in its
own terminal:

```powershell
kubectl port-forward service/wordpress 8080:80
```

In another terminal, configure and start the MCP server:

```powershell
$secret = kubectl get secret woocommerce-api-secret -o json | ConvertFrom-Json
$env:WC_BASE_URL = "http://127.0.0.1:8080"
$env:WC_PUBLIC_HOST = "shop.localtest.me:8080"
$env:WC_CONSUMER_KEY = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($secret.data.'consumer-key'))
$env:WC_CONSUMER_SECRET = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($secret.data.'consumer-secret'))
$env:MCP_AUTH_TOKEN = "local-woo-inspector-token"
pnpm --filter @repo/woo-mcp dev
```

In a third terminal, run `npx @modelcontextprotocol/inspector`, connect using
the Streamable HTTP transport to `http://localhost:3003/mcp`, and set the
`Authorization` header to `Bearer local-woo-inspector-token`.

Call `create_product` with a unique name and price, then confirm the product
appears at `http://shop.localtest.me:8080`. Place a test order through the
storefront and call `list_orders` (optionally with `today: true`) to find it;
use `get_order` with the returned ID to inspect its concise summary. The REST
API key must have write permission to create products and read permission for
orders. `update_order_status` changes a real order and should only be used on a
test order during this manual check.

For local Kubernetes deployments, WordPress is configured to recognize
`shop.localtest.me` and the forwarded host for API authentication. The
`WC_PUBLIC_HOST` option supports that host-based routing while the HTTP
connection itself goes through the local port-forward.

## References

- [WooCommerce REST API documentation](https://woocommerce.github.io/woocommerce-rest-api-docs/)
- [Authentication](https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication)
- [Products](https://woocommerce.github.io/woocommerce-rest-api-docs/#products)
- [Orders](https://woocommerce.github.io/woocommerce-rest-api-docs/#orders)
