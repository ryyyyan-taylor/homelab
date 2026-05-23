# Talos Cluster Rebuild

## Context

The existing Talos cluster (VMs 200–202) is too corrupted to recover. Root cause was `cache=none` (O_DIRECT) on the Proxmox VM disks starving etcd fsync — fixed by `cache=writeback`. This document is the working guide for rebuilding a fresh cluster from scratch using the existing Terraform, Talos configs, and ArgoCD bootstrap.

All ArgoCD apps, Kustomize overlays, and SOPS-encrypted secrets survive unchanged. The only things that change are: (1) `cache=writeback` is added to the VM disk blocks in Terraform, and (2) fresh Talos secrets are generated.

---

## Quick Reference

| Item | Value |
|---|---|
| CP VM ID / hostname / IP | 200 / talos-cp / 10.0.1.200 |
| Worker 1 VM ID / hostname / IP | 201 / talos-worker-1 / 10.0.1.201 |
| Worker 2 VM ID / hostname / IP | 202 / talos-worker-2 / 10.0.1.202 |
| Proxmox host IP | 10.0.1.135 |
| Talos version | v1.13.0 |
| Kubernetes version | v1.36.0 |
| Cluster name | talos-homelab |
| Control plane endpoint | https://10.0.1.200:6443 |
| Pod CIDR | 10.244.0.0/16 |
| Service CIDR | 10.96.0.0/12 |
| Talos ISO | `local:iso/talos-metal-amd64.iso` |
| Storage pool | `ssd-1` |
| Boot disk device | `/dev/vda` |
| Network interface | `ens18` |
| Age public key | `age1pht0t0fr9gr8tf2vqm5y4s8lrg6g2xtql5m2xgzm4lv38mhaqfsslekwsa` |
| Age private key path | `~/.config/sops/age/keys.txt` |

**Key file paths:**

| File | Purpose |
|---|---|
| `terraform/talos-vms.tf` | VM definitions — edit to add writeback cache |
| `kubernetes/talos/talos-cp.yaml` | Applied CP machine config (per-node) |
| `kubernetes/talos/talos-worker-1.yaml` | Applied worker-1 machine config |
| `kubernetes/talos/talos-worker-2.yaml` | Applied worker-2 machine config |
| `kubernetes/talos/controlplane.yaml` | Base generated CP config (pre-patch) |
| `kubernetes/talos/worker.yaml` | Base generated worker config (pre-patch) |
| `kubernetes/talos/patches/cp.yaml` | CP-specific network + disk patch |
| `kubernetes/talos/patches/worker-1.yaml` | Worker-1 network + disk patch |
| `kubernetes/talos/patches/worker-2.yaml` | Worker-2 network + disk patch |
| `kubernetes/talos/secrets.sops.yaml` | SOPS-encrypted Talos cluster secrets |
| `kubernetes/talos/talosconfig` | `talosctl` credentials for this cluster |
| `kubernetes/bootstrap/argocd/kustomization.yaml` | ArgoCD install + KSOPS CMP config |
| `kubernetes/bootstrap/root-app.yaml` | Root ArgoCD Application |
| `kubernetes/apps/platform/monitoring/application.yaml` | Prometheus app — `replicas: 0` marker removed |
| `kubernetes/apps/platform/loki/application.yaml` | Loki app — `replicas: 0` marker removed |

---

## Phase 0: Pre-flight

- [x] Verify age private key is present: `ls -la ~/.config/sops/age/keys.txt`
- [x] Verify age key decrypts a known secret: `sops -d kubernetes/apps/platform/monitoring-config/ntfy-secret.sops.yaml`
- [x] Confirm Talos ISO is present in Proxmox: Proxmox UI → rt → local → ISO Images → `talos-metal-amd64.iso`
- [x] Check Let's Encrypt rate limit window — cert-manager will re-issue all certs on first sync. Limit is 50 certs/week per registered domain. We have ~10 certs. Safe if not rebuilding twice in the same week.
- [x] Note data that will be lost on rebuild:
  - **Authentik postgres PV** — Authentik user/group/provider config will need to be redone after bootstrap. It's ~10 minutes of UI work.
  - **Prometheus + Loki PV data** — these are scaled to 0 in git anyway; no meaningful history to preserve.
  - Everything else either lives in git (ArgoCD apps) or in SOPS-encrypted secrets.

---

## Phase 1: Add `cache=writeback` to Terraform

This is the single config change that prevents the etcd fsync starvation. Without it, the cluster will corrupt again.

Edit `terraform/talos-vms.tf` — add `cache = "writeback"` to each disk block. Three places: `talos_cp`, `talos_worker_1`, `talos_worker_2`.

Before:
```hcl
disk {
  datastore_id = "hdd"
  interface    = "virtio0"
  size         = 40
  file_format  = "raw"
  discard      = "on"
}
```

After (CP):
```hcl
disk {
  datastore_id = "hdd"
  interface    = "virtio0"
  size         = 40
  file_format  = "raw"
  discard      = "on"
  cache        = "writeback"
}
```

Same change for both workers (size = 60 for workers).

- [x] Edit `terraform/talos-vms.tf` — add `cache = "writeback"` to all three disk blocks
- [x] Commit: `git commit -m "feat: add writeback cache to Talos VM disks"`

---

## Phase 2: Destroy old VMs

The old cluster VMs must be destroyed before Terraform can recreate them with the new disk config. Destroy only the Talos VMs — LXC resources in `lxcs.tf` are untouched.

Run from `terraform/`:

```bash
cd terraform
terraform destroy \
  -target proxmox_virtual_environment_vm.talos_cp \
  -target proxmox_virtual_environment_vm.talos_worker_1 \
  -target proxmox_virtual_environment_vm.talos_worker_2
```

Terraform will show a plan destroying 3 VMs. Type `yes` to confirm.

- [x] Run `terraform destroy -target` for all 3 Talos VMs
- [x] Verify in Proxmox UI that VMs 200, 201, 202 are gone

---

## Phase 3: Provision fresh VMs

Still in `terraform/`:

```bash
terraform apply \
  -target proxmox_virtual_environment_vm.talos_cp \
  -target proxmox_virtual_environment_vm.talos_worker_1 \
  -target proxmox_virtual_environment_vm.talos_worker_2
```

This creates 3 VMs booted from the Talos ISO in maintenance mode. They will have `started = false` per the Terraform config — you will need to start them manually.

- [x] Run `terraform apply -target` for all 3 Talos VMs
- [x] In Proxmox UI, start VM 200 (talos-cp), then 201 and 202 (workers)
- [x] Verify each VM shows as running in Proxmox UI

**Maintenance mode IP discovery:**

In maintenance mode (before machine config is applied), the VMs use DHCP and may not have their static IPs (10.0.1.200–202) yet. Two ways to find the maintenance-mode IP:

Option A — Proxmox console: Open the VM console in the Proxmox UI, wait for the Talos maintenance screen, and read the IP from the display.

Option B — ARP scan from Proxmox host: The user must run this on the Proxmox host (not via SSH into an LXC):
```bash
# Run on Proxmox host rt
arp-scan --interface=vmbr0 --localnet 2>/dev/null | grep -v "DUP"
```

Note the maintenance-mode IPs for each VM — you'll need them in Phase 5 if the static IPs aren't already assigned via DHCP reservation.

- [x] Boot all 3 VMs and record their maintenance-mode IPs (CP: 10.0.1.122, wk1: 10.0.1.141, wk2: 10.0.1.114)

---

## Phase 4: Generate fresh Talos config

Generate fresh cluster secrets and per-node machine configs. This replaces the old (corrupted cluster) secrets.

All commands run from the repo root `/home/rt/Code/homelab`.

**Step 1 — Generate fresh secrets:**
```bash
talosctl gen secrets -o /tmp/talos-secrets-new.yaml
```

**Step 2 — Generate base machine configs:**
```bash
talosctl gen config talos-homelab https://10.0.1.200:6443 \
  --with-secrets /tmp/talos-secrets-new.yaml \
  --output-dir /tmp/talos-gen/
```

This produces `/tmp/talos-gen/controlplane.yaml`, `/tmp/talos-gen/worker.yaml`, and `/tmp/talos-gen/talosconfig`.

**Step 3 — Apply per-node patches:**
```bash
# CP: apply network/disk patch
talosctl machineconfig patch /tmp/talos-gen/controlplane.yaml \
  --patch @kubernetes/talos/patches/cp.yaml \
  -o kubernetes/talos/talos-cp.yaml

# Worker 1: apply worker-1 patch (10.0.1.201)
talosctl machineconfig patch /tmp/talos-gen/worker.yaml \
  --patch @kubernetes/talos/patches/worker-1.yaml \
  -o kubernetes/talos/talos-worker-1.yaml

# Worker 2: apply worker-2 patch (10.0.1.202)
talosctl machineconfig patch /tmp/talos-gen/worker.yaml \
  --patch @kubernetes/talos/patches/worker-2.yaml \
  -o kubernetes/talos/talos-worker-2.yaml
```

**Step 4 — Copy base configs and talosconfig:**
```bash
cp /tmp/talos-gen/controlplane.yaml kubernetes/talos/controlplane.yaml
cp /tmp/talos-gen/worker.yaml kubernetes/talos/worker.yaml
cp /tmp/talos-gen/talosconfig kubernetes/talos/talosconfig
```

**Step 5 — SOPS-encrypt the new secrets (overwrites old encrypted file):**
```bash
cp /tmp/talos-secrets-new.yaml kubernetes/talos/secrets.sops.yaml
sops -e -i kubernetes/talos/secrets.sops.yaml
```

**Step 6 — Clean up plaintext secrets from /tmp:**
```bash
rm /tmp/talos-secrets-new.yaml
rm /tmp/talos-gen/controlplane.yaml /tmp/talos-gen/worker.yaml /tmp/talos-gen/talosconfig
```

**Step 7 — Commit:**
```bash
git add kubernetes/talos/
git commit -m "feat: regenerate Talos cluster secrets and machine configs"
```

- [x] Generate fresh secrets to `/tmp/talos-secrets-new.yaml`
- [x] Generate base configs to `/tmp/talos-gen/`
- [x] Patch CP config → `kubernetes/talos/talos-cp.yaml`
- [x] Patch worker-1 config → `kubernetes/talos/talos-worker-1.yaml`
- [x] Patch worker-2 config → `kubernetes/talos/talos-worker-2.yaml`
- [x] Copy base `controlplane.yaml`, `worker.yaml`, `talosconfig` into `kubernetes/talos/`
- [x] SOPS-encrypt secrets in-place, verify file starts with `sops:` metadata
- [x] Remove plaintext `/tmp/talos-secrets-new.yaml` — do not leave it on disk
- [x] Commit all changes in `kubernetes/talos/`

---

## Phase 5: Apply configs & bootstrap etcd

Apply machine configs to each node while it's in maintenance mode (Talos port 50001, `--insecure` skips TLS since the node doesn't have a CA cert yet).

Replace `<cp-maintenance-ip>`, `<wk1-maintenance-ip>`, `<wk2-maintenance-ip>` with the IPs discovered in Phase 3 if the static IPs aren't already live. If 10.0.1.200–202 are reachable, use those directly.

**Apply machine configs:**
```bash
# Control plane
talosctl apply-config --insecure \
  --nodes <cp-maintenance-ip> \
  --file kubernetes/talos/talos-cp.yaml

# Worker 1
talosctl apply-config --insecure \
  --nodes <wk1-maintenance-ip> \
  --file kubernetes/talos/talos-worker-1.yaml

# Worker 2
talosctl apply-config --insecure \
  --nodes <wk2-maintenance-ip> \
  --file kubernetes/talos/talos-worker-2.yaml
```

After applying configs, each VM reboots and installs Talos to `/dev/vda`. Wait ~2 minutes for the CP to complete its install and come back up with the static IP 10.0.1.200.

**Bootstrap etcd (run once on CP only):**
```bash
talosctl bootstrap --talosconfig kubernetes/talos/talosconfig --nodes 10.0.1.200
```

This initializes the etcd cluster. Run it exactly once. If it errors with "already bootstrapped," the cluster is already initialized — skip to the next step.

**Wait for CP to be ready (polling etcd health — typically takes 2–3 minutes):**
```bash
# This polls talosctl etcd status until etcd shows as healthy.
# Run it and wait — it may take 2-3 minutes for the first response.
talosctl --talosconfig kubernetes/talos/talosconfig -n 10.0.1.200 etcd status
```

**Fetch kubeconfig:**
```bash
talosctl kubeconfig --talosconfig kubernetes/talos/talosconfig \
  --nodes 10.0.1.200 \
  ~/.kube/config
```

**Verify all 3 nodes are Ready:**
```bash
kubectl get nodes -o wide
```

Expected: 3 nodes (talos-cp, talos-worker-1, talos-worker-2), all STATUS=Ready. Workers may take 2–3 minutes longer than the CP to register.

- [x] Apply machine config to CP (maintenance IP 10.0.1.122)
- [x] Apply machine config to worker-1 (maintenance IP 10.0.1.141)
- [x] Apply machine config to worker-2 (maintenance IP 10.0.1.114)
- [x] Wait for VMs to reboot and install Talos (~2 min per node)
- [x] Bootstrap etcd on CP: `talosctl bootstrap`
- [x] Confirm etcd healthy: `talosctl -n 10.0.1.200 etcd status`
- [x] Fetch kubeconfig: `talosctl kubeconfig`
- [x] `kubectl get nodes` shows 3 Ready nodes — confirmed IPs: 10.0.1.200 (CP), 10.0.1.201 (wk1), 10.0.1.202 (wk2)

---

## Phase 6: Revert scaling markers before ArgoCD sync

Two apps have `replicas: 0` committed as a temporary scale-down from the old cluster. Revert these now so ArgoCD syncs them at full replicas — otherwise Prometheus and Loki will start scaled to 0.

Check the current state:
```bash
grep -n "replicas" kubernetes/apps/platform/monitoring/application.yaml
grep -n "replicas" kubernetes/apps/platform/loki/application.yaml
```

Edit both files to remove the `replicas: 0` override (or set `replicas: 1`). The exact change depends on how the scale-down was applied — look for any `replicas: 0` in the HelmRelease values or ArgoCD Application spec and revert it.

- [x] Revert `replicas: 0` in `kubernetes/apps/platform/monitoring/application.yaml`
- [x] Revert `replicas: 0` in `kubernetes/apps/platform/loki/application.yaml`
- [x] Commit: `git commit -m "chore: revert temporary Prometheus and Loki scale-down"`
- [x] Push to main so ArgoCD can pull it on first sync

---

## Phase 7: Bootstrap ArgoCD

**Install ArgoCD with KSOPS CMP plugin:**
```bash
kubectl apply -k kubernetes/bootstrap/argocd/
```

This installs ArgoCD v2.14.2 with the KSOPS config management plugin pre-configured. The CMP plugin enables decryption of SOPS secrets during app sync.

**Wait for ArgoCD to be ready:**
```bash
kubectl -n argocd rollout status deployment argocd-server --timeout=300s
kubectl -n argocd rollout status deployment argocd-repo-server --timeout=300s
```

**Create the SOPS age key secret (must exist before applying root app):**
```bash
kubectl -n argocd create secret generic ksops-age-key \
  --from-file=keys.txt=$HOME/.config/sops/age/keys.txt
```

This secret is what gives ArgoCD's repo-server the ability to decrypt SOPS-encrypted files in the repo. Without it, every app with encrypted secrets will fail to sync.

**Apply the root ArgoCD Application:**
```bash
kubectl apply -f kubernetes/bootstrap/root-app.yaml
```

This creates the root Application that points to `kubernetes/apps/` in the repo. ArgoCD will begin syncing all child apps automatically.

**Watch sync progress (this takes ~10 minutes for full sync):**
```bash
kubectl -n argocd get applications --watch
```

Or via the ArgoCD UI at `https://argocd.lab.ryantaylor.tech` (available once Traefik and MetalLB sync up — may take a few minutes).

- [x] `kubectl apply -k kubernetes/bootstrap/argocd/`
- [x] Wait for argocd-server and argocd-repo-server deployments to be ready
- [x] Create `ksops-age-key` secret from `~/.config/sops/age/keys.txt`
- [x] `kubectl apply -f kubernetes/bootstrap/root-app.yaml`
- [ ] Watch ArgoCD app sync — expect ~10 min for full sync of all apps ← **RESUME HERE**

---

## Phase 8: Validate

Run through this checklist after ArgoCD reports all apps Synced.

**Cluster health:**
- [ ] `kubectl get nodes -o wide` — all 3 nodes Ready, correct IPs
- [ ] `talosctl --talosconfig kubernetes/talos/talosconfig -n 10.0.1.200 etcd status` — etcd healthy, 1 member
- [ ] `kubectl -n kube-system get pods` — all system pods Running, no restarts
- [ ] After 30 min: `kubectl -n kube-system get deployment kube-controller-manager kube-scheduler` — restart count stays at 0 (the etcd stability signal)

**ArgoCD:**
- [ ] All apps show `Synced` + `Healthy` in ArgoCD UI
- [ ] No apps stuck in `Degraded` or `OutOfSync`

**Networking:**
- [ ] MetalLB has assigned external IPs: `kubectl get svc -A | grep LoadBalancer`
- [ ] DNS resolution works from inside a pod: `kubectl run -it --rm dns-test --image=busybox --restart=Never -- nslookup kubernetes.default.svc.cluster.local`
- [ ] Pi-hole is still resolving `*.lab.ryantaylor.tech` (it's an LXC, so unaffected by the rebuild)

**TLS:**
- [ ] cert-manager has issued certificates: `kubectl get certificates -A`
- [ ] All certs show `READY=True`

**App URLs (open each in browser):**
- [ ] `https://argocd.lab.ryantaylor.tech`
- [ ] `https://grafana.lab.ryantaylor.tech`
- [ ] `https://prometheus.lab.ryantaylor.tech`
- [ ] `https://dash.lab.ryantaylor.tech`
- [ ] `https://authentik.lab.ryantaylor.tech` (Authentik will need reconfig — see Phase 9)
- [ ] `https://homepage.lab.ryantaylor.tech`
- [ ] `https://uptime.lab.ryantaylor.tech`

**Observability:**
- [ ] Prometheus scraping cluster targets: `https://prometheus.lab.ryantaylor.tech/targets` — all green
- [ ] Grafana loads dashboards (may need re-login; Authentik SSO won't work until Phase 9)
- [ ] Loki is receiving logs: verify in Grafana Explore → Loki

**Cluster health CronJob:**
- [ ] Manually trigger: `kubectl create job --from=cronjob/cluster-health-check -n monitoring cluster-health-test`
- [ ] Check logs: `kubectl logs -n monitoring -l job-name=cluster-health-test`
- [ ] Confirm ntfy notification arrives on phone

---

## Phase 9: Post-bootstrap

### 9.1 — Reconfigure Authentik

Authentik's postgres data is on a PV that was wiped with the old cluster. The application is running but has no users/groups/providers configured. Do this via the Authentik UI at `https://authentik.lab.ryantaylor.tech`.

- [ ] Log in with the default admin credentials (check Authentik pod logs for the initial password: `kubectl -n authentik logs -l app.kubernetes.io/name=authentik --tail=50 | grep password`)
- [ ] Create user `rt` (or your primary user) and set password
- [ ] Create group `lxc-admins`
- [ ] Add user to group
- [ ] Recreate the LDAP outpost (needed for LXC SSH auth via SSSD):
  - Create LDAP provider
  - Create LDAP outpost pointing at the provider
  - Verify the LDAP outpost IP matches what's in `ansible/group_vars/all/vars.yml` (`ldap://10.0.1.210`)
- [ ] Test LXC SSH auth: `ssh rt@10.0.1.151` (corekeeper) — should authenticate via LDAP
- [ ] Recreate any OAuth2/OIDC providers that were configured (Grafana is the one already wired)

### 9.2 — Add `ghcr-credentials` secret for Image Updater

ArgoCD Image Updater is deployed but can't pull from ghcr.io without credentials. This secret is not in the repo.

```bash
kubectl -n argocd create secret generic ghcr-credentials \
  --from-literal=username=ryyyyan-taylor \
  --from-literal=password=<github-pat>
```

The GitHub PAT needs `read:packages` scope. Create one at GitHub → Settings → Developer settings → Personal access tokens.

- [ ] Create `ghcr-credentials` secret in `argocd` namespace
- [ ] Verify Image Updater can now pull: check `kubectl -n argocd logs -l app.kubernetes.io/name=argocd-image-updater --tail=50`

### 9.3 — Update inventory doc

- [ ] Verify `docs/inventory.md` reflects the current cluster state (node IPs, Talos version, K8s version)
- [ ] Update GitHub wiki if anything changed: edit `~/Code/homelab.wiki/`, commit, push

---

## Gotchas

- **Maintenance mode IP:** VMs use DHCP before machine config is applied. If Pi-hole has static reservations for the original MAC addresses, the VMs may get 10.0.1.200–202 immediately. If not, use the Proxmox console to find the actual DHCP IP and use that with `talosctl apply-config --insecure -n <dhcp-ip>`.

- **Bootstrap runs once:** `talosctl bootstrap` initializes etcd. Running it a second time returns an error — that's expected, not a problem.

- **Hostname in Talos v1.13:** `talosctl gen config` produces multi-document YAML where the second document is `kind: HostnameConfig`. The per-node patches handle IP/disk config; if you need to adjust the hostname, edit the HostnameConfig document in the per-node yaml files (the `hostname:` field), not `machine.network.hostname`.

- **ArgoCD initial admin password:**
  ```bash
  kubectl -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath="{.data.password}" | base64 -d
  ```

- **ksops-age-key secret must precede root app:** If you apply root-app.yaml before creating the `ksops-age-key` secret, all apps with encrypted secrets will fail with `failed to decrypt`. If this happens: create the secret, then `kubectl -n argocd delete application --all` and re-apply the root app.

- **Worker unreachable taints after reboot:** If a node shows `SchedulingDisabled` or pods won't schedule, clear stale taints:
  ```bash
  kubectl taint node talos-worker-1 node.kubernetes.io/unreachable:NoSchedule- node.kubernetes.io/unreachable:NoExecute-
  kubectl taint node talos-worker-2 node.kubernetes.io/unreachable:NoSchedule- node.kubernetes.io/unreachable:NoExecute-
  ```

- **TLS cert rate limits:** cert-manager re-issues all certs on first sync. Let's Encrypt allows 50 certs/week per registered domain. We have ~10 certs. Safe for one rebuild, but don't destroy and rebuild twice in the same week.

- **ssd-2 stale storage pool blocks VM deletion:** If `ssd-2` is defined as a Proxmox LVM-thin storage pool but its VG doesn't exist on disk, every `qm destroy` will fail with `no such logical volume ssd-2/ssd-2`. Fix: `pvesm remove ssd-2` on the Proxmox host before destroying VMs. Re-add it later once the LVM VG is provisioned.

- **Terraform `datastore_id` must match actual Proxmox storage pool name:** The pool is `ssd-1`, not `hdd`. If Terraform errors with `storage 'hdd' does not exist`, update `datastore_id` in `talos-vms.tf`.

- **`argocd` namespace must exist before `kubectl apply -k`:** The bootstrap kustomization sets `namespace: argocd` but doesn't create the namespace. Run `kubectl create namespace argocd` first, then apply.

- **`talosconfig` endpoints are empty after `talosctl gen config`:** Run `talosctl --talosconfig kubernetes/talos/talosconfig config endpoint 10.0.1.200` before any `talosctl` commands that need to reach the cluster.

- **kubeconfig context renamed on fetch:** If a `talos-homelab` context already exists in `~/.kube/config`, `talosctl kubeconfig` renames the new one to `talos-homelab-1`. Switch to it: `kubectl config use-context admin@talos-homelab-1`.
