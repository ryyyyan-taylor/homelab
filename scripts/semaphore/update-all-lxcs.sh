#!/usr/bin/env bash
set -euo pipefail

# Ensure sops binary is available (cached on PVC for subsequent runs)
# shellcheck source=setup-sops.sh
source "$(dirname "$0")/setup-sops.sh"

# Run the playbook. Exit code 4 = unreachable hosts only (game servers are
# often stopped) — treat as success so Semaphore shows green for infra-only runs.
ansible-playbook ansible/playbooks/adopt-lxcs.yml
EXIT_CODE=$?

if [ "${EXIT_CODE}" -eq 4 ]; then
  echo "[update-all-lxcs] Some hosts unreachable (likely game servers are stopped). Infra LXCs ran OK."
  exit 0
fi
exit "${EXIT_CODE}"
