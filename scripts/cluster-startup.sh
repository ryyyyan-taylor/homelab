#!/bin/bash
# Cluster startup health validator.
# Run after booting all VMs to confirm the cluster is stable.
# Does NOT power on VMs — boot them from Proxmox first, then run this.

set -euo pipefail

TIMEOUT=300  # seconds to wait for each phase
INTERVAL=5

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
NC='\033[0m'

ok()   { printf "${GRN}✓${NC} %s\n" "$*"; }
warn() { printf "${YLW}⚠${NC}  %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*"; }
info() { printf "  %s\n" "$*"; }

wait_for() {
  local desc="$1"; shift
  local deadline=$((SECONDS + TIMEOUT))
  printf "  Waiting for %s" "$desc"
  while ! "$@" >/dev/null 2>&1; do
    if [ $SECONDS -ge $deadline ]; then
      printf "\n"
      return 1
    fi
    printf "."
    sleep $INTERVAL
  done
  printf "\n"
  return 0
}

echo ""
echo "=== Cluster Startup Validator ==="
echo "$(date)"
echo ""

# ── Phase 1: API server reachable ─────────────────────────────────────────────
echo "Phase 1: API server"
if wait_for "API server" kubectl cluster-info; then
  ok "API server reachable"
else
  fail "API server unreachable after ${TIMEOUT}s — is VM 200 booted?"
  exit 1
fi

# ── Phase 2: All nodes Ready ───────────────────────────────────────────────────
echo ""
echo "Phase 2: Node readiness"
if wait_for "all 3 nodes Ready" bash -c 'kubectl get nodes --no-headers | awk "$2 != \"Ready\"" | grep -q . && exit 1 || [ $(kubectl get nodes --no-headers | wc -l) -eq 3 ]'; then
  ok "All 3 nodes Ready"
  kubectl get nodes --no-headers | while read line; do info "$line"; done
else
  READY=$(kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready " || echo 0)
  NOT_READY=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2 != "Ready" {print $1}')
  warn "Only ${READY}/3 nodes Ready after ${TIMEOUT}s"
  if [ -n "$NOT_READY" ]; then
    info "NotReady: $NOT_READY"
    echo ""
    echo "  Fix: talosctl -n <node-ip> service kubelet restart"
    echo "  Then re-run this script."
  fi
  exit 1
fi

# ── Phase 3: Control plane health ─────────────────────────────────────────────
echo ""
echo "Phase 3: Control plane components"
UNHEALTHY=$(kubectl get componentstatuses --no-headers 2>/dev/null | awk '$2 != "Healthy" {print $1}')
if [ -z "$UNHEALTHY" ]; then
  ok "etcd, scheduler, controller-manager all Healthy"
else
  fail "Unhealthy components: $UNHEALTHY"
  info "If etcd is unhealthy, check VM 200 disk performance (must be SSD)."
  exit 1
fi

# ── Phase 4: kube-system pods Running ─────────────────────────────────────────
echo ""
echo "Phase 4: System pods"
REQUIRED_PODS="coredns kube-apiserver kube-controller-manager kube-scheduler kube-flannel kube-proxy metrics-server"

if wait_for "kube-system pods" bash -c '! kubectl get pods -n kube-system --no-headers 2>/dev/null | grep -qE "CrashLoopBackOff|Error|Pending"'; then
  ok "All kube-system pods Running"
else
  warn "Some kube-system pods still unhealthy after ${TIMEOUT}s:"
  kubectl get pods -n kube-system --no-headers | grep -E "CrashLoopBackOff|Error|Pending" | while read line; do
    info "$line"
  done
  echo ""
  echo "  Fix for flannel CNI bridge conflict:"
  echo "    kubectl rollout restart ds/kube-flannel -n kube-system"
  echo ""
  echo "  Fix for metrics-server or other pods:"
  echo "    kubectl delete pod -n kube-system <pod-name>"
fi

# ── Phase 5: ArgoCD sync ──────────────────────────────────────────────────────
echo ""
echo "Phase 5: ArgoCD applications"
DEGRADED=$(kubectl get applications -n argocd --no-headers 2>/dev/null | awk '$3 != "Healthy" && $3 != "Progressing" {print $1}')
if [ -z "$DEGRADED" ]; then
  ok "All ArgoCD apps Healthy"
else
  COUNT=$(echo "$DEGRADED" | wc -l | tr -d ' ')
  warn "${COUNT} app(s) Degraded — may still be converging:"
  echo "$DEGRADED" | while read app; do info "$app"; done
  echo ""
  info "Run 'kubectl get applications -n argocd' to monitor."
  info "Most apps self-heal within 2-3 minutes after node restart."
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Done: $(date) ==="
echo ""
echo "Next steps if anything is degraded:"
echo "  1. Worker nodes not registering:  talosctl -n <ip> service kubelet restart"
echo "  2. Flannel CNI bridge conflict:   kubectl rollout restart ds/kube-flannel -n kube-system"
echo "  3. Pods stuck Init/Pending:       kubectl delete pod -n <ns> <pod>"
echo "  4. ArgoCD apps degraded:          wait 2-3 min, or kubectl -n argocd app sync <app>"
