#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="mcp"

echo "[cluster-down] Checking if k3d cluster '${CLUSTER_NAME}' exists..."

if k3d cluster list | grep -E "^\s*${CLUSTER_NAME}\s+" >/dev/null 2>&1; then
  echo "[cluster-down] Deleting k3d cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "${CLUSTER_NAME}"
  echo "[cluster-down] Cluster '${CLUSTER_NAME}' deleted successfully."
else
  echo "[cluster-down] Cluster '${CLUSTER_NAME}' does not exist, nothing to do."
fi
