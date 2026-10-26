#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_LOCAL_FILE="${ROOT_DIR}/.env.local"

echo "[create-secrets] Checking for .env.local..."

if [ ! -f "${ENV_LOCAL_FILE}" ]; then
  touch "${ENV_LOCAL_FILE}"
fi

# Load existing values if defined
set +u
# shellcheck disable=SC1090
source "${ENV_LOCAL_FILE}" 2>/dev/null || true
set -u

generate_random() {
  openssl rand -hex 16
}

generate_wc_key() {
  echo "ck_$(openssl rand -hex 20)"
}

generate_wc_secret() {
  echo "cs_$(openssl rand -hex 20)"
}

UPDATED=false

if [ -z "${MARIADB_ROOT_PASSWORD:-}" ]; then
  MARIADB_ROOT_PASSWORD="$(generate_random)"
  echo "MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}" >> "${ENV_LOCAL_FILE}"
  UPDATED=true
fi

if [ -z "${MARIADB_PASSWORD:-}" ]; then
  MARIADB_PASSWORD="$(generate_random)"
  echo "MARIADB_PASSWORD=${MARIADB_PASSWORD}" >> "${ENV_LOCAL_FILE}"
  UPDATED=true
fi

if [ -z "${WORDPRESS_ADMIN_PASSWORD:-}" ]; then
  WORDPRESS_ADMIN_PASSWORD="$(generate_random)"
  echo "WORDPRESS_ADMIN_PASSWORD=${WORDPRESS_ADMIN_PASSWORD}" >> "${ENV_LOCAL_FILE}"
  UPDATED=true
fi

if [ -z "${WOO_CONSUMER_KEY:-}" ]; then
  WOO_CONSUMER_KEY="$(generate_wc_key)"
  echo "WOO_CONSUMER_KEY=${WOO_CONSUMER_KEY}" >> "${ENV_LOCAL_FILE}"
  UPDATED=true
fi

if [ -z "${WOO_CONSUMER_SECRET:-}" ]; then
  WOO_CONSUMER_SECRET="$(generate_wc_secret)"
  echo "WOO_CONSUMER_SECRET=${WOO_CONSUMER_SECRET}" >> "${ENV_LOCAL_FILE}"
  UPDATED=true
fi

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  ENCRYPTION_KEY="$(openssl rand -base64 32)"
  echo "ENCRYPTION_KEY=${ENCRYPTION_KEY}" >> "${ENV_LOCAL_FILE}"
  UPDATED=true
fi

if [ "${UPDATED}" = true ]; then
  echo "[create-secrets] Generated new random credentials and saved to .env.local"
else
  echo "[create-secrets] Using existing credentials from .env.local"
fi

echo "[create-secrets] Applying Kubernetes secrets to cluster..."

# 1. MariaDB secret
kubectl create secret generic mariadb-secret \
  --from-literal=mariadb-root-password="${MARIADB_ROOT_PASSWORD}" \
  --from-literal=mariadb-password="${MARIADB_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. WordPress secret
kubectl create secret generic wordpress-secret \
  --from-literal=wordpress-admin-password="${WORDPRESS_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. WooCommerce REST API secret
kubectl create secret generic woocommerce-api-secret \
  --from-literal=consumer-key="${WOO_CONSUMER_KEY}" \
  --from-literal=consumer-secret="${WOO_CONSUMER_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Gateway encryption key
kubectl create secret generic gateway-secret \
  --from-literal=encryption-key="${ENCRYPTION_KEY}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[create-secrets] Kubernetes secrets created/updated successfully!"
