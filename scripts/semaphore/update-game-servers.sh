#!/usr/bin/env bash
set -euo pipefail

# Ensure sops binary is available (cached on PVC for subsequent runs)
# shellcheck source=setup-sops.sh
source "$(dirname "$0")/setup-sops.sh"

exec ansible-playbook ansible/playbooks/adopt-lxcs.yml --limit game_servers "$@"
