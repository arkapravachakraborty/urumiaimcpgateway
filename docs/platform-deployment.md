# Platform deployment

The same `charts/platform` Helm chart deploys the local k3d and production
platforms. Environment-specific hosts, image names, replicas, and resource
limits are supplied by `values-local.yaml` and `values-prod.yaml`.
For the full VPS procedure, including GHCR, DNS, TLS, and rollback, see
[DEPLOY-K3S.md](./DEPLOY-K3S.md). Design and security tradeoffs are in
[DECISIONS.md](./DECISIONS.md).

## Local startup

Install Docker, k3d, kubectl, Helm, Bash, and OpenSSL, then run from the
repository root:

```sh
bash scripts/up.sh
```

The script creates or starts the `mcp` k3d cluster, generates missing local
credentials in the ignored root `.env` file, applies Kubernetes Secrets to
the `platform` namespace, builds and imports all five images, and installs the
Helm release. The dashboard is at
`http://dashboard.localtest.me:8080`; the store is at
`http://shop.localtest.me:8080`.

If `.env` does not exist yet, copy `.env.example` to `.env` before running.
Use `K3D_CLUSTER_NAME`, `KUBE_NAMESPACE`, `IMAGE_REGISTRY`, and `IMAGE_TAG` to
override the local defaults. Keep a copy of `.env` outside the repository
if preserving a local database or signing/encryption credentials across
machines. The generated PostgreSQL password is URL-safe; custom values for
`POSTGRES_PASSWORD` must also use URL-safe characters.

## Secrets

`scripts/create-secrets.sh` creates or updates only Kubernetes Secrets; the
chart references their names and never contains secret values:

| Secret                   | Keys                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `gateway-secret`         | encryption/session keys, admin login, LLM provider/model, optional LLM API key/base URL |
| `postgres-secret`        | database/user/password and the application connection URL                               |
| `mcp-auth-secret`        | bearer tokens for WooCommerce, notes, and utils upstreams                               |
| `woocommerce-api-secret` | WooCommerce REST consumer key and secret                                                |
| `mariadb-secret`         | MariaDB root and application passwords                                                  |
| `wordpress-secret`       | WordPress admin password                                                                |

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `LLM_PROVIDER`, `LLM_MODEL`, and (as
needed) `LLM_API_KEY` or `LLM_BASE_URL` in `.env` before the first
startup to customize the generated defaults. The secrets script preserves
existing credentials on subsequent runs.

## Routing and network policy

The dashboard ingress sends `/mcp`, `/api/trpc`, `/api/chat`, and `/healthz`
to the gateway and all other dashboard paths to the web service. The store
host routes to WordPress. MCP servers have ClusterIP services and no Ingress.
NetworkPolicies allow gateway pods to reach the MCP servers and PostgreSQL;
MariaDB accepts ingress only from WordPress and the store setup Job.

Production values use placeholder image names and hostnames. Replace these
with your registry and DNS names before deployment. To enable dashboard TLS,
set `dashboard.ingress.tls.enabled: true` and
`dashboard.ingress.certManager.enabled: true` with the appropriate issuer;
the chart then annotates the Ingress and requests the configured TLS Secret.

## Verification

```sh
kubectl get pods --namespace platform
kubectl get ingress --namespace platform
curl --fail http://dashboard.localtest.me:8080/api/healthz
```

NetworkPolicy enforcement depends on the cluster CNI. k3s includes a policy
controller unless it was explicitly disabled; verify enforcement from a
non-gateway pod when using a different cluster or CNI.
