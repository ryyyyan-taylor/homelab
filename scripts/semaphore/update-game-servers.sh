#!/usr/bin/env bash
set -euo pipefail

# Ensure sops binary is available (cached on PVC for subsequent runs)
# shellcheck source=setup-sops.sh
source "$(dirname "$0")/setup-sops.sh"

# Run the playbook. Exit code 4 = unreachable (game server is stopped).
ansible-playbook ansible/playbooks/adopt-lxcs.yml --limit game_servers
EXIT_CODE=$?

if [ "${EXIT_CODE}" -eq 4 ]; then
  echo "[update-game-servers] Game servers unreachable — are they started?"
  exit "${EXIT_CODE}"  # Keep non-zero so operator knows servers were down
fi
exit "${EXIT_CODE}"
