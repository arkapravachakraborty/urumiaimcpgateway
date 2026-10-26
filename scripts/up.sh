#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-mcp}"
KUBE_NAMESPACE="${KUBE_NAMESPACE:-platform}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-local/mcpgateway}"
IMAGE_TAG="${IMAGE_TAG:-dev}"

export K3D_CLUSTER_NAME IMAGE_REGISTRY IMAGE_TAG KUBE_NAMESPACE

echo "[up] Starting local Kubernetes cluster..."
bash "${SCRIPT_DIR}/cluster-up.sh"

echo "[up] Creating/updating Kubernetes secrets..."
bash "${SCRIPT_DIR}/create-secrets.sh"

echo "[up] Building and importing application images..."
bash "${SCRIPT_DIR}/build-images.sh" --local

echo "[up] Installing/upgrading the platform Helm release..."
helm upgrade --install mcpgateway "${ROOT_DIR}/charts/platform" \
  --namespace "${KUBE_NAMESPACE}" \
  --create-namespace \
  --values "${ROOT_DIR}/charts/platform/values-local.yaml" \
  --set-string "gateway.image.repository=${IMAGE_REGISTRY}/gateway" \
  --set-string "gateway.image.tag=${IMAGE_TAG}" \
  --set-string "web.image.repository=${IMAGE_REGISTRY}/web" \
  --set-string "web.image.tag=${IMAGE_TAG}" \
  --set-string "wooMcp.image.repository=${IMAGE_REGISTRY}/woo-mcp" \
  --set-string "wooMcp.image.tag=${IMAGE_TAG}" \
  --set-string "mcpNotes.image.repository=${IMAGE_REGISTRY}/mcp-notes" \
  --set-string "mcpNotes.image.tag=${IMAGE_TAG}" \
  --set-string "mcpUtils.image.repository=${IMAGE_REGISTRY}/mcp-utils" \
  --set-string "mcpUtils.image.tag=${IMAGE_TAG}" \
  --wait \
  --timeout 15m

echo "[up] Platform is ready. Dashboard: http://dashboard.localtest.me:8080"
