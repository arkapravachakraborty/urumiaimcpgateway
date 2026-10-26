# Deploy to a k3s VPS

This guide deploys the platform to a single Linux VPS using the same
`charts/platform` Helm chart used locally. Only image names, hosts, replicas,
resources, and other values differ through `values-prod.yaml` and command-line
overrides. The chart includes PostgreSQL, MariaDB, WordPress/WooCommerce, the
dashboard, gateway, and MCP upstreams.

The commands below assume Ubuntu 22.04/24.04, a domain you control, and a
fresh server. For a production store, take database and persistent-volume
backups and review resource sizing before exposing it to customers.

## 1. Prepare the VPS and install k3s

Use a VPS with at least 4 vCPUs, 8 GB RAM, and sufficient SSD space for the
images, persistent database volumes, and WordPress uploads. Open inbound TCP
ports 80 and 443 to the internet and SSH (22) only to your administrative IP.
Do not expose the Kubernetes API port 6443 publicly; use SSH or a VPN for
administration.

Install k3s with its default Traefik ingress controller and local-path storage
provisioner:

```bash
curl -sfL https://get.k3s.io | sh -
sudo kubectl get nodes
sudo kubectl get pods -n kube-system
```

Keep the default Traefik controller enabled; the chart's ingresses use the
`traefik` ingress class. k3s includes a NetworkPolicy controller by default;
do not disable it. Network policy behavior depends on the cluster's CNI.

The commands below can be run as root with `kubectl`, or as a user with a
configured kubeconfig and permission to manage the cluster.

## 2. Point DNS at the server

Create DNS `A` records for both names, pointing to the VPS public IPv4 address:

| Record                  | Destination     |
| ----------------------- | --------------- |
| `dashboard.example.com` | VPS public IPv4 |
| `shop.example.com`      | VPS public IPv4 |

Add `AAAA` records only if the VPS and ingress are reachable over IPv6. Wait
for DNS propagation before requesting certificates:

```bash
dig +short dashboard.example.com
dig +short shop.example.com
```

Replace the example names in all commands below with your actual hostnames.

## 3. Install cert-manager and configure TLS

The production values enable TLS support for the dashboard ingress but leave
cert-manager disabled by default. The store ingress is configured to use a
Kubernetes TLS Secret named `shop-tls`. Install cert-manager and create a
Let's Encrypt ClusterIssuer before deploying:

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --wait --timeout 5m
```

Create a ClusterIssuer, replacing the email address:

```bash
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    email: admin@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod-account
    solvers:
      - http01:
          ingress:
            class: traefik
EOF
```

The chart's dashboard ingress is annotated to request a certificate from this
issuer when enabled. Create a Certificate for the store host as well (the
chart's WordPress ingress references the resulting `shop-tls` Secret):

```bash
kubectl create namespace platform --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n platform -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: shop-tls
spec:
  secretName: shop-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - shop.example.com
EOF
```

HTTP-01 issuance requires the DNS records to resolve to this VPS and inbound
port 80 to reach Traefik. If you do not want cert-manager, obtain valid
certificates through your existing certificate process and create
`dashboard-tls` and `shop-tls` Kubernetes TLS Secrets in namespace `platform`.
Set `dashboard.ingress.tls.enabled=true` and leave the cert-manager annotation
disabled when using a pre-created dashboard certificate. Renew externally and
update the Secrets before certificates expire.

## 4. Build and push application images to GHCR

From a trusted workstation with Docker, Bash, Git, and this repository
available, build and push all five images. Use a unique immutable tag, such as
the source commit short hash:

```bash
export IMAGE_REGISTRY="ghcr.io/OWNER/REPOSITORY"
export IMAGE_TAG="$(git rev-parse --short HEAD)"
export GHCR_USERNAME="YOUR_GITHUB_USERNAME"
read -rsp "GHCR token (write:packages): " GHCR_TOKEN
echo
export GHCR_TOKEN
bash scripts/build-images.sh --push
unset GHCR_TOKEN
```

The script publishes these image names:
`$IMAGE_REGISTRY/{web,gateway,woo-mcp,mcp-notes,mcp-utils}:$IMAGE_TAG`.
The GitHub token needs package write permission. For the simplest setup, make
the resulting GHCR packages public. If packages are private, create a registry
pull Secret in namespace `platform` before deployment and attach it to the
default ServiceAccount:

```bash
kubectl create namespace platform --dry-run=client -o yaml | kubectl apply -f -
read -rsp "GHCR token (read:packages): " GHCR_READ_TOKEN
echo
kubectl create secret docker-registry ghcr-pull -n platform \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USERNAME" \
  --docker-password="$GHCR_READ_TOKEN" \
  --docker-email="admin@example.com"
kubectl patch serviceaccount default -n platform \
  -p '{"imagePullSecrets":[{"name":"ghcr-pull"}]}'
unset GHCR_READ_TOKEN
```

This works because the chart's pods use the namespace's default ServiceAccount.
The pull Secret is not stored in Helm values.

## 5. Create Kubernetes Secrets on the server

On the VPS, clone the repository at the same source revision used to build the
images. The helper creates or updates Secrets in the current Kubernetes
context; verify the context before running it:

```bash
git clone https://github.com/arkapravachakraborty/urumiaimcpgateway.git
cd urumiaimcpgateway
git checkout <source-commit-or-tag>
kubectl config current-context
```

Create a private root environment file. If `.env` does not already exist, copy
`.env.example` to `.env`. Set the dashboard admin credentials
and any desired LLM provider settings; the script generates database
passwords, WooCommerce API credentials, MCP bearer tokens, and encryption and
session secrets when omitted:

```bash
umask 077
touch .env
chmod 600 .env
${EDITOR:-vi} .env
```

Use simple `KEY=value` lines (no shell `export` or quotes). For example:

```dotenv
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-long-unique-password
LLM_PROVIDER=google
LLM_MODEL=gemini-2.5-flash
LLM_API_KEY=replace-with-your-provider-key
```

The LLM values are optional if chat is not needed. Do not add `.env` to
Git, an image, or a Helm values file. Generate and apply the Kubernetes
Secrets:

```bash
KUBE_NAMESPACE=platform bash scripts/create-secrets.sh
```

The script creates `gateway-secret`, `postgres-secret`, `mcp-auth-secret`,
`woocommerce-api-secret`, `mariadb-secret`, and `wordpress-secret`. Keep the
`.env` backup in a protected password manager or encrypted backup; it
contains the generated values needed to recover logins and encrypted upstream
credentials. Kubernetes Secrets are base64-encoded by default, not encrypted
at rest unless the cluster is configured for Secret encryption. Restrict
cluster access and configure etcd encryption and backups for production.

## 6. Install the Helm release

Set your hostnames and image values. This example uses the same chart and
production values file as local deployment, with runtime-only overrides:

```bash
export DASHBOARD_HOST="dashboard.example.com"
export SHOP_HOST="shop.example.com"
export IMAGE_REGISTRY="ghcr.io/OWNER/REPOSITORY"
export IMAGE_TAG="$(git rev-parse --short HEAD)"

helm upgrade --install mcpgateway charts/platform \
  --namespace platform --create-namespace \
  --values charts/platform/values-prod.yaml \
  --set-string "gateway.image.repository=${IMAGE_REGISTRY}/gateway" \
  --set-string "web.image.repository=${IMAGE_REGISTRY}/web" \
  --set-string "wooMcp.image.repository=${IMAGE_REGISTRY}/woo-mcp" \
  --set-string "mcpNotes.image.repository=${IMAGE_REGISTRY}/mcp-notes" \
  --set-string "mcpUtils.image.repository=${IMAGE_REGISTRY}/mcp-utils" \
  --set-string "gateway.image.tag=${IMAGE_TAG}" \
  --set-string "web.image.tag=${IMAGE_TAG}" \
  --set-string "wooMcp.image.tag=${IMAGE_TAG}" \
  --set-string "mcpNotes.image.tag=${IMAGE_TAG}" \
  --set-string "mcpUtils.image.tag=${IMAGE_TAG}" \
  --set-string "dashboard.ingress.host=${DASHBOARD_HOST}" \
  --set-string "wordpress.ingress.host=${SHOP_HOST}" \
  --set-string "wordpress.publicUrl=https://${SHOP_HOST}" \
  --set dashboard.ingress.tls.enabled=true \
  --set dashboard.ingress.certManager.enabled=true \
  --set-string dashboard.ingress.certManager.clusterIssuer=letsencrypt-prod \
  --set-string "wordpress.ingress.tls[0].secretName=shop-tls" \
  --set-string "wordpress.ingress.tls[0].hosts[0]=${SHOP_HOST}" \
  --wait --timeout 20m
```

Do not use `latest` for repeat deployments; a unique tag makes rollback and
image verification predictable. The WordPress and database images come from
their public upstream registries and are not part of the GHCR build.

## 7. Verify the installation

```bash
kubectl get pods,pvc,ingress -n platform
kubectl get certificates -n platform
kubectl rollout status deployment/gateway -n platform --timeout=5m
kubectl rollout status deployment/web -n platform --timeout=5m
kubectl logs -n platform job/mcpgateway-platform-store-setup
curl --fail "https://${DASHBOARD_HOST}/api/healthz"
curl --fail "https://${SHOP_HOST}/"
```

Wait for the dashboard and store certificates to show `Ready=True` and all
pods to show `Ready`. Log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the
protected `.env` file. The WordPress admin uses username `admin` and
`WORDPRESS_ADMIN_PASSWORD`. Check `kubectl get events -n platform
--sort-by=.lastTimestamp` and `kubectl describe pod -n platform <pod>` for
image pulls, PVC provisioning, probes, or NetworkPolicy issues. Confirm the
store setup Job completed before testing checkout.

## 8. Upgrade and rollback

For an upgrade, build and push a new unique image tag, then repeat step 6 with
that tag. Review the release history:

```bash
helm history mcpgateway -n platform
```

Roll back to the previous known-good chart revision:

```bash
helm rollback mcpgateway <revision> -n platform --wait --timeout 20m
kubectl get pods -n platform
```

Helm rollback does not reverse database migrations or restore persistent
volume contents. Back up PostgreSQL, MariaDB, and WordPress uploads before
upgrades that change schemas or store data; restore from those backups
separately if an application rollback requires it.
