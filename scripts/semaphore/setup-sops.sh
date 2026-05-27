#!/usr/bin/env bash
# Note: no set -e — this file is sourced; failures here should not abort callers unexpectedly
# Installs the sops binary to a persistent location on the Semaphore PVC.
# The PVC is mounted at /var/lib/semaphore/ and survives pod restarts.
# Must be sourced (not run directly) so that PATH changes persist in the caller.

SOPS_VERSION="v3.10.2"
SOPS_BIN_DIR="/var/lib/semaphore/bin"
SOPS_BIN="${SOPS_BIN_DIR}/sops"
SOPS_URL="https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64"

if command -v sops &>/dev/null; then
  echo "[setup-sops] sops already in PATH: $(command -v sops)"
  return 0 2>/dev/null || true
fi

if [ -x "${SOPS_BIN}" ]; then
  echo "[setup-sops] sops found at ${SOPS_BIN}, adding to PATH"
else
  echo "[setup-sops] Downloading sops ${SOPS_VERSION}..."
  mkdir -p "${SOPS_BIN_DIR}"
  curl -sSL "${SOPS_URL}" -o "${SOPS_BIN}"
  chmod +x "${SOPS_BIN}"
  echo "[setup-sops] sops installed to ${SOPS_BIN}"
fi

export PATH="${SOPS_BIN_DIR}:${PATH}"
echo "[setup-sops] PATH updated, sops version: $("${SOPS_BIN}" --version 2>&1 | head -1)"
