# Container images

Each application has a multi-stage Dockerfile built from the repository root.
The images use Node 22 slim, Turborepo-pruned workspace inputs, and non-root
runtime users. `apps/web` uses Next.js standalone output; gateway and MCP
servers install only production workspace dependencies in their final image.

Build and import all images into the local `mcp` k3d cluster:

```sh
bash scripts/build-images.sh --local
```

Override the local image names/tag and cluster when needed:

```sh
IMAGE_REGISTRY=localhost:5000/team IMAGE_TAG=dev K3D_CLUSTER_NAME=mcp \
  bash scripts/build-images.sh --local
```

Build and push to GHCR (the token needs `write:packages`):

```sh
GHCR_USERNAME=your-github-user \
GHCR_TOKEN=your-github-token \
IMAGE_REGISTRY=ghcr.io/owner/repository \
IMAGE_TAG=latest \
  bash scripts/build-images.sh --push
```

`IMAGE_REGISTRY` defaults to `local/mcpgateway` and `IMAGE_TAG` defaults to
`dev`. Local mode imports each image into k3d; push mode logs in with
`GHCR_USERNAME` and `GHCR_TOKEN` and pushes each built image.

## Runtime configuration and health

| Image | Port | Health endpoint | Required runtime configuration |
| --- | ---: | --- | --- |
| `web` | 3000 | `GET /api/healthz` | `GATEWAY_ORIGIN` is only needed when running the web app in development mode. |
| `gateway` | 4000 | `GET /healthz` and `GET /readyz` | `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; provider and upstream variables as configured. |
| `woo-mcp` | 3003 | `GET /healthz` | `WC_BASE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`; optional `WC_PUBLIC_HOST`, `MCP_AUTH_TOKEN`. |
| `mcp-notes` | 3001 | `GET /healthz` | Optional `MCP_BEARER_TOKEN`, `MCP_ALLOWED_HOSTS`. |
| `mcp-utils` | 3002 | `GET /healthz` | Optional `MCP_BEARER_TOKEN`, `MCP_ALLOWED_HOSTS`. |

The gateway container generates the Prisma client during image build and runs
`prisma migrate deploy` before starting its server. The database must be
reachable and `DATABASE_URL` set at container startup. `LLM_API_KEY` is only
read by the gateway process and should be supplied from a Kubernetes Secret.

All images include Docker health checks against their HTTP liveness endpoint.
The gateway's readiness endpoint additionally checks the database. The MCP
health endpoints do not require bearer authentication.
