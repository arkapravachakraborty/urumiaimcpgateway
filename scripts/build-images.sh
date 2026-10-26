#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODE="${1:---local}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-local/mcpgateway}"
K3D_CLUSTER_NAME="${K3D_CLUSTER_NAME:-mcp}"
APPS=(web gateway woo-mcp mcp-notes mcp-utils)

if [[ $# -gt 1 || ( "${MODE}" != "--local" && "${MODE}" != "--push" ) ]]; then
  echo "Usage: $0 [--local|--push]" >&2
  exit 2
fi

if [[ "${MODE}" == "--push" ]]; then
  : "${GHCR_USERNAME:?Set GHCR_USERNAME before pushing images.}"
  : "${GHCR_TOKEN:?Set GHCR_TOKEN before pushing images.}"
  : "${IMAGE_REGISTRY:?Set IMAGE_REGISTRY, for example ghcr.io/owner/repository.}"
  registry_host="${IMAGE_REGISTRY%%/*}"
  printf '%s' "${GHCR_TOKEN}" | docker login "${registry_host}" \
    --username "${GHCR_USERNAME}" --password-stdin
fi

images=()
for app in "${APPS[@]}"; do
  image="${IMAGE_REGISTRY}/${app}:${IMAGE_TAG}"
  echo "[build-images] Building ${image}"
  docker build --file "apps/${app}/Dockerfile" --tag "${image}" "${ROOT_DIR}"
  images+=("${image}")
done

if [[ "${MODE}" == "--push" ]]; then
  for image in "${images[@]}"; do
    echo "[build-images] Pushing ${image}"
    docker push "${image}"
  done
else
  if ! command -v k3d >/dev/null 2>&1; then
    echo "[build-images] k3d is required for local image import." >&2
    exit 1
  fi
  for image in "${images[@]}"; do
    echo "[build-images] Importing ${image} into k3d cluster ${K3D_CLUSTER_NAME}"
    k3d image import "${image}" --cluster "${K3D_CLUSTER_NAME}"
  done
fi
