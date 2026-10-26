#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="mcp"
HOST_PORT="8080"
LB_PORT="80"

echo "[cluster-up] Checking if k3d cluster '${CLUSTER_NAME}' exists..."

if k3d cluster list | grep -E "^\s*${CLUSTER_NAME}\s+" >/dev/null 2>&1; then
  echo "[cluster-up] Cluster '${CLUSTER_NAME}' already exists."
  # Ensure the cluster nodes are running
  k3d cluster start "${CLUSTER_NAME}" >/dev/null 2>&1 || true
else
  echo "[cluster-up] Creating k3d cluster '${CLUSTER_NAME}' mapping host port ${HOST_PORT} -> loadbalancer:${LB_PORT}..."
  k3d cluster create "${CLUSTER_NAME}" \
    --port "${HOST_PORT}:${LB_PORT}@loadbalancer" \
    --wait
fi

echo "[cluster-up] Updating kubeconfig context..."
k3d kubeconfig merge "${CLUSTER_NAME}" --kubeconfig-switch-context >/dev/null 2>&1 || true

echo "[cluster-up] Waiting for Traefik ingress controller to be ready..."
kubectl wait --namespace kube-system \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=traefik \
  --timeout=180s 2>/dev/null || true

echo "[cluster-up] k3d cluster '${CLUSTER_NAME}' is ready! Traefik is listening on http://localhost:${HOST_PORT}"
