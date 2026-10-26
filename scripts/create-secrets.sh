#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
KUBE_NAMESPACE="${KUBE_NAMESPACE:-platform}"

if [ ! -f "${ENV_FILE}" ]; then
  touch "${ENV_FILE}"
fi

set +u
# shellcheck disable=SC1090
source "${ENV_FILE}"
set -u

persist_value() {
  local temp_file
  temp_file="$(mktemp "${ENV_FILE}.XXXXXX")"
  awk -F '=' -v key="$1" -v value="$2" '
    $1 == key {
      if (!updated) print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) print key "=" value
    }
  ' "${ENV_FILE}" > "${temp_file}"
  mv "${temp_file}" "${ENV_FILE}"
}

generate_random() {
  openssl rand -hex 32
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
  persist_value MARIADB_ROOT_PASSWORD "${MARIADB_ROOT_PASSWORD}"
  UPDATED=true
fi

if [ -z "${MARIADB_PASSWORD:-}" ]; then
  MARIADB_PASSWORD="$(generate_random)"
  persist_value MARIADB_PASSWORD "${MARIADB_PASSWORD}"
  UPDATED=true
fi

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  POSTGRES_PASSWORD="$(generate_random)"
  persist_value POSTGRES_PASSWORD "${POSTGRES_PASSWORD}"
  UPDATED=true
fi

POSTGRES_USER="${POSTGRES_USER:-gateway}"
POSTGRES_DATABASE="${POSTGRES_DATABASE:-gateway}"
if [[ ! "${POSTGRES_PASSWORD}" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "[create-secrets] POSTGRES_PASSWORD must contain only URL-safe characters." >&2
  exit 1
fi
if [[ ! "${POSTGRES_USER}" =~ ^[A-Za-z0-9_]+$ || ! "${POSTGRES_DATABASE}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "[create-secrets] POSTGRES_USER and POSTGRES_DATABASE must be simple identifiers." >&2
  exit 1
fi

if [ -z "${WORDPRESS_ADMIN_PASSWORD:-}" ]; then
  WORDPRESS_ADMIN_PASSWORD="$(generate_random)"
  persist_value WORDPRESS_ADMIN_PASSWORD "${WORDPRESS_ADMIN_PASSWORD}"
  UPDATED=true
fi

if [ -z "${WOO_CONSUMER_KEY:-}" ]; then
  WOO_CONSUMER_KEY="$(generate_wc_key)"
  persist_value WOO_CONSUMER_KEY "${WOO_CONSUMER_KEY}"
  UPDATED=true
fi

if [ -z "${WOO_CONSUMER_SECRET:-}" ]; then
  WOO_CONSUMER_SECRET="$(generate_wc_secret)"
  persist_value WOO_CONSUMER_SECRET "${WOO_CONSUMER_SECRET}"
  UPDATED=true
fi

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  ENCRYPTION_KEY="$(openssl rand -base64 32)"
  persist_value ENCRYPTION_KEY "${ENCRYPTION_KEY}"
  UPDATED=true
fi

if [ -z "${SESSION_SECRET:-}" ]; then
  SESSION_SECRET="$(openssl rand -base64 48)"
  persist_value SESSION_SECRET "${SESSION_SECRET}"
  UPDATED=true
fi

if [ -z "${ADMIN_EMAIL:-}" ]; then
  ADMIN_EMAIL="admin@localtest.me"
  persist_value ADMIN_EMAIL "${ADMIN_EMAIL}"
  UPDATED=true
fi

if [ -z "${ADMIN_PASSWORD:-}" ]; then
  ADMIN_PASSWORD="$(generate_random)"
  persist_value ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  UPDATED=true
fi

MCP_WOO_TOKEN="${MCP_WOO_TOKEN:-${MCP_AUTH_TOKEN:-}}"
if [ -z "${MCP_WOO_TOKEN}" ]; then
  MCP_WOO_TOKEN="$(generate_random)"
  persist_value MCP_WOO_TOKEN "${MCP_WOO_TOKEN}"
  UPDATED=true
fi

if [ -z "${MCP_NOTES_TOKEN:-}" ]; then
  MCP_NOTES_TOKEN="$(generate_random)"
  persist_value MCP_NOTES_TOKEN "${MCP_NOTES_TOKEN}"
  UPDATED=true
fi

if [ -z "${MCP_UTILS_TOKEN:-}" ]; then
  MCP_UTILS_TOKEN="$(generate_random)"
  persist_value MCP_UTILS_TOKEN "${MCP_UTILS_TOKEN}"
  UPDATED=true
fi

LLM_PROVIDER="${LLM_PROVIDER:-google}"
LLM_MODEL="${LLM_MODEL:-gemini-2.5-flash}"

if [ "${UPDATED}" = true ]; then
  echo "[create-secrets] Generated credentials and saved them to .env"
else
  echo "[create-secrets] Using existing credentials from .env"
fi

kubectl create namespace "${KUBE_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic mariadb-secret \
  --namespace "${KUBE_NAMESPACE}" \
  --from-literal=mariadb-root-password="${MARIADB_ROOT_PASSWORD}" \
  --from-literal=mariadb-password="${MARIADB_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply --namespace "${KUBE_NAMESPACE}" -f -

kubectl create secret generic wordpress-secret \
  --namespace "${KUBE_NAMESPACE}" \
  --from-literal=wordpress-admin-password="${WORDPRESS_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply --namespace "${KUBE_NAMESPACE}" -f -

kubectl create secret generic woocommerce-api-secret \
  --namespace "${KUBE_NAMESPACE}" \
  --from-literal=consumer-key="${WOO_CONSUMER_KEY}" \
  --from-literal=consumer-secret="${WOO_CONSUMER_SECRET}" \
  --dry-run=client -o yaml | kubectl apply --namespace "${KUBE_NAMESPACE}" -f -

kubectl create secret generic postgres-secret \
  --namespace "${KUBE_NAMESPACE}" \
  --from-literal=postgres-user="${POSTGRES_USER}" \
  --from-literal=postgres-database="${POSTGRES_DATABASE}" \
  --from-literal=postgres-password="${POSTGRES_PASSWORD}" \
  --from-literal=database-url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DATABASE}?schema=public" \
  --dry-run=client -o yaml | kubectl apply --namespace "${KUBE_NAMESPACE}" -f -

kubectl create secret generic mcp-auth-secret \
  --namespace "${KUBE_NAMESPACE}" \
  --from-literal=woo-token="${MCP_WOO_TOKEN}" \
  --from-literal=notes-token="${MCP_NOTES_TOKEN}" \
  --from-literal=utils-token="${MCP_UTILS_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply --namespace "${KUBE_NAMESPACE}" -f -

gateway_secret_args=(
  --from-literal=encryption-key="${ENCRYPTION_KEY}"
  --from-literal=session-secret="${SESSION_SECRET}"
  --from-literal=admin-email="${ADMIN_EMAIL}"
  --from-literal=admin-password="${ADMIN_PASSWORD}"
  --from-literal=llm-provider="${LLM_PROVIDER}"
  --from-literal=llm-model="${LLM_MODEL}"
)
if [ -n "${LLM_API_KEY:-}" ]; then
  gateway_secret_args+=(--from-literal=llm-api-key="${LLM_API_KEY}")
fi
if [ -n "${LLM_BASE_URL:-}" ]; then
  gateway_secret_args+=(--from-literal=llm-base-url="${LLM_BASE_URL}")
fi

kubectl create secret generic gateway-secret \
  --namespace "${KUBE_NAMESPACE}" \
  "${gateway_secret_args[@]}" \
  --dry-run=client -o yaml | kubectl apply --namespace "${KUBE_NAMESPACE}" -f -

echo "[create-secrets] Kubernetes secrets applied in namespace ${KUBE_NAMESPACE}."
