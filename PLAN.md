# Homelab Platform — Plan

---

## Current state

**Platform (complete):**
- ✅ ArgoCD (GitOps, KSOPS secrets)
- ✅ Traefik + cert-manager (TLS, ingress)
- ✅ Authentik (SSO, deployed, LDAP outpost live)
- ✅ Observability: Prometheus + Grafana + Alertmanager + Loki + Promtail
- ✅ Notifications: ntfy → phone
- ✅ Dashboard: Homepage + Uptime Kuma
- ✅ All 5 LXCs adopted into Ansible/Terraform
- ✅ Proxmox host metrics flowing to Prometheus
- ✅ Custom Proxmox + k8s dashboard (Go + Svelte, `dash.lab.ryantaylor.tech`) — Proxmox host/VM/LXC utilization + k8s node/deployment health, auto-refresh, ArgoCD Image Updater wired (pending `ghcr-credentials` secret)
- ✅ GitHub wiki + repo metadata
- ✅ Authentik LDAP outpost — SSH auth for all LXCs via SSSD; `rt` user with passwordless sudo on all hosts
- ✅ SSH keys deployed to all LXCs (root + rt) via Ansible base role
- ✅ Game servers Grafana dashboard — CPU/RAM/network/disk per LXC + live Loki log panels

**Working on or planned:**
- ✅ Cluster rebuild — complete
- ✅ SSO wiring (Phase 2.5) — complete
- 🔄 Self-service provisioning via Semaphore (Phase 3) — deployed, configuring
- [ ] DR runbook + backup validation (Phase 4)
- [ ] Documentation polish (Phase 5)

---

## Architecture & design decisions

See `docs/inventory.md` for service details, hardware specs, and IP plan.

### Hybrid by design

- **K8s runs the platform tier**: Traefik + Authentik + observability + GitOps.
- **LXCs stay LXCs**: game servers, Pi-hole, Tailscale subnet router.
- Prometheus scrapes both K8s and LXCs; Loki aggregates both.

### Key constraints

- **24 GB RAM** is the binding constraint. Cluster is 1 CP (6 GB dedicated) + 2 workers (4 GB dedicated, 6 GB floating). Game LXCs must be stopped when idle to stay within budget.
- **Single Proxmox host** means no HA; Longhorn replication is per-node only. Good for portfolio, not production.
- **etcd requires `cache=writeback` on Proxmox VM disks.** `cache=none` (O_DIRECT) with LVM thin provisioning starves etcd fsync even on decent SSDs. See `docs/inventory.md` Talos gotchas for full context.
- **Tailscale for remote access** — Cloudflare Tunnels explicitly rejected.
- **Local PBS backups only** — off-site backups out of scope.

---

## Features — ordered by dependency

### Phase 2: Cluster startup robustness

**Status:** ✅ Complete. Rebuild validated startup robustness; all exit criteria met.

#### Previously-attempted fixes (REVERTED, do not revisit)

- ❌ `machine.files` drop-in at `/etc/systemd/system/kubelet.service.d/10-cleanup.conf` — Talos `/etc` is read-only, caused reboot loop on both workers.
- ❌ `ip link del cni0` boot hook via same mechanism — same problem.

#### Work that landed and is keeping

- [x] **Cluster health-check CronJob** — runs once per minute, checks node Ready, etcd Healthy, controller-manager/scheduler Healthy, all system pods Running, no Init/Pending stragglers >2 min. Alerts to ntfy. Deployed via ArgoCD.
- [x] **`scripts/cluster-startup.sh`** — 5-phase validator with timeouts, fix hints, color output.
- [x] **Documented startup sequence**:
  1. Power on Proxmox host (or ensure it's up)
  2. Boot control plane VM (200) — wait for Talos to stabilize (~2 min)
  3. Boot worker VMs (201, 202) in parallel — wait for kubelets to register (~3 min)
  4. Verify `kubectl get nodes` shows 3 Ready nodes
  5. Wait for all system pods to be Running (watch `kubectl get pods -n kube-system`)
  6. [Optional] Run health-check job to validate cluster
- [x] **Proxmox host slab-leak Prometheus alerts** (`kubernetes/apps/platform/monitoring-config/proxmox-host-alerts.yaml`) — warns at 4 GB SUnreclaim, critical at 10 GB, critical on MemAvailable <2 GB.

#### Open work (post-rebuild)

- [x] Audit all pods for missing `resources.requests` / `resources.limits` — fixed node-exporter (wrong Helm key), init-chown-data init containers, LDAP outpost deployment; system/upstream-chart containers excluded.
- [x] Re-test cluster cold boot — validated via full migration rebuild; cluster booted cleanly without manual intervention.

**Exit criteria:**
- Cluster boots from cold without manual intervention
- All nodes register and system pods start within 5 min
- No pods stuck in Init/Pending post-restart
- Health-check job validates readiness

---

### Phase 2.5: Authentik SSO wiring

**Status:** ✅ Complete.

| Service | Method | Status |
|---|---|---|
| **ArgoCD** | Native OIDC | ✅ Done |
| **Traefik dashboard** | Forward-auth middleware | ✅ Done |
| **Prometheus** | Forward-auth middleware | ✅ Done |
| **Alertmanager** | Forward-auth middleware | ✅ Done |
| **Uptime Kuma** | Forward-auth middleware | ✅ Done |
| **Pi-hole admin UI** | Authentik proxy provider | ✅ Done |
| **Grafana** | auth.proxy | ✅ Done |
| **Homepage** | Skip | Internal-only, Tailscale is the gate |
| **ntfy** | Skip | By design — Alertmanager uses ntfy tokens directly |

**Tasks:**
- [x] Create Authentik user + group (UI)
- [x] Create OAuth2/OIDC provider + app for ArgoCD; store client secret in SOPS
- [x] Patch `argocd-cm` with OIDC config; map Authentik groups to ArgoCD roles
- [x] Verify ArgoCD login via Authentik; disable local `admin` account
- [x] Add `authentik-forwardauth` middleware to Traefik dashboard, Prometheus, Alertmanager, Uptime Kuma IngressRoutes
- [x] Create Authentik proxy provider for Pi-hole; add IngressRoute at `pihole.lab.ryantaylor.tech`
- [x] Update Homepage configmap to link Pi-hole at the new subdomain
- **Exit criteria:** every admin UI requires Authentik login. No `*.lab.ryantaylor.tech` service is reachable without SSO. ✅

---

### Phase 3: Self-service provisioning (Semaphore)

**Prerequisite:** Phase 2.5 (SSO wiring). Optional but sensible to wire SSO first.

**Concept:** Deploy Semaphore (open-source Ansible/Terraform control plane) to the cluster. It pulls playbooks from the Git repo on every run, holds credentials in its own secret store, and exposes a REST API the custom dashboard can call to trigger one-click operations — no GitHub in the loop.

#### Why Semaphore over a self-hosted GitHub Actions runner

| | Semaphore | GH Actions runner |
|---|---|---|
| **Trigger** | REST API call from dashboard | `repository_dispatch` via GitHub API |
| **GitHub dependency** | None at runtime | Every run routes through GitHub |
| **Terraform support** | Yes (task templates chain commands) | Yes (via workflow steps) |
| **Secret storage** | Built-in key store | GitHub secrets or on-runner files |
| **Job queue** | Built-in (runs don't stomp each other) | Concurrency groups |
| **Complexity** | One k8s deployment | Runner LXC + Actions YAML |

#### Architecture

```
Dashboard (SvelteKit)
  └─ POST /api/v2/project/.../tasks
       └─ Semaphore (k8s pod)
            ├─ git clone github.com/ryyyyan-taylor/homelab  (deploy key)
            ├─ decrypt SOPS files  (age private key from secret store)
            ├─ ansible-playbook ...  OR  terraform apply ...
            └─ streams job log back to dashboard via SSE/polling
```

#### Credentials Semaphore needs (never in the repo)

| Credential | Where it lives now | Semaphore store type |
|---|---|---|
| Age private key | `~/.config/sops/age/keys.txt` on desktop | "SSH key" (file type) |
| SSH private key (for Ansible) | `~/.ssh/id_ed25519` on desktop | "SSH key" |
| Proxmox API token | SOPS-encrypted in repo | Semaphore environment var |
| GitHub deploy key | Generated by Semaphore | Added to repo deploy keys (read-only) |

#### Planned task templates

| Template | Type | What it runs |
|---|---|---|
| Update all LXCs | Ansible | `adopt-lxcs.yml` against all hosts |
| Update game servers | Ansible | `adopt-lxcs.yml --limit game_servers` |
| Provision test LXC | Terraform → Ansible | `terraform apply` (new LXC) then `adopt-lxcs.yml --limit <new-ct>` |
| Provision dev VM | Terraform → Ansible | `terraform apply` (new VM from Packer image) then bootstrap playbook |
| Deprovision LXC/VM | Terraform | `terraform destroy -target` for a specific resource |

#### Tasks

- [x] Deploy Semaphore to k8s (Helm chart, `semaphore.lab.ryantaylor.tech`) — SQLite, `local-path` PVC
- [x] Wire Authentik SSO into Semaphore UI (OIDC provider)
- [ ] Add GitHub deploy key (read-only) to repo; configure Semaphore project pointing at repo
- [ ] Load age private key + SSH private key into Semaphore key store
- [ ] Create Semaphore environment with Proxmox API token vars
- [ ] Create task templates for the operations above
- [ ] Verify "Update all LXCs" template runs cleanly end-to-end
- [ ] Add Semaphore API call to custom dashboard ("Run" button per template, live log streaming)
- [ ] Packer golden images: dev VM base image, LXC template (unblocks one-click VM provisioning)
- [ ] Terraform module: parameterised LXC (name, CPU, RAM, template) for the provisioning templates
- [ ] Terraform module: parameterised VM (name, CPU, RAM, Packer image)

**Exit criteria:** "Update all LXCs" and "Provision test LXC" both work end-to-end triggered from the dashboard. Spinning up a disposable LXC takes one button click + ~2 minutes.

**Effort:** 1–2 weekends (Semaphore setup + wiring dashboard API + Packer/Terraform modules).

---

### Phase 4: Disaster recovery (PBS + Longhorn)

**Prerequisite:** none (can run in parallel with Phase 3).

**Concept:** backup and restore procedures are documented and rehearsed.

- [ ] PBS configured with retention policies (daily/weekly/monthly) for all VMs/LXCs
- [ ] Manual backup + restore of at least one LXC (procedure verification)
- [ ] Longhorn snapshot schedule for K8s PVs
- [ ] Rehearse K8s PV restoration into a scratch namespace
- [ ] Documented runbook: what's recoverable, what isn't, rebuild from repo + PBS
- [ ] Monthly "DR drill" automated test: restore a tagged backup, assert data integrity

**Exit criteria:** runbook is written; we've successfully restored a real backup.

**Effort:** 1 weekend (mostly procedure documentation + one live restore).

---

### Connectivity Monitor (standalone, ready to build)

**Prerequisite:** none (can run in parallel).

**Concept:** CronJob that pings `8.8.8.8` every 5–10 minutes and alerts via ntfy when internet is down.

- Schedule: `*/5 * * * *`, image: `alpine:latest`
- 3 ping retries before declaring outage; alert via ntfy on failure
- Optional `/health` endpoint for Uptime Kuma scraping (separate Deployment + Service)
- Kustomize app at `kubernetes/apps/connectivity-monitor/`, SOPS secret for ntfy topic

**Tasks:**
- [ ] Create manifest structure and kustomization
- [ ] Test locally: `kustomize build kubernetes/apps/connectivity-monitor/overlays/homelab`
- [ ] Deploy via ArgoCD; watch pod logs
- [ ] Manually trigger: `kubectl create job --from=cronjob/connectivity-monitor test-job -n monitoring`
- [ ] Verify ntfy notification arrives (block internet, run job, check phone)
- [ ] Let it run for a day; confirm no false positives

---

### Phase 5: Documentation & portfolio finish

**Prerequisite:** Phases 2.5, 3, 4 complete (or at least milestones reached).

- [ ] Architecture diagram (Excalidraw or D2)
- [ ] README rewrite: what this is, what it demonstrates, where to read the code
- [ ] ADRs in `docs/adr/`: Talos vs k3s, Argo vs Flux, Longhorn vs Rook, local-only backups, Tailscale, RAM budgeting, etcd disk requirements, etc.
- [ ] Optional: screencast or demo script

**Exit criteria:** a stranger can understand the project in 60 seconds.

**Effort:** 1 weekend.

---

### Future candidates (Phase 5+, optional)

- **Vaultwarden / Paperless / Immich / other apps** — maintained Helm charts, gain real value from SSO + TLS + GitOps
- **Hardening / security audit** — network policies, RBAC reviews
- **Multi-node physical cluster** — revisit only if a second host is added
- **Off-site backups** — currently out of scope (local-only by design)

#### Custom dashboard extensions

**Proxmox console access in the dashboard**

The Proxmox GUI is a thin client over the Proxmox API — all console access goes through the same API. Reproducible in the custom dashboard:

1. SvelteKit backend calls `/api2/json/nodes/{node}/lxc/{vmid}/termproxy` (LXCs) or `/nodes/{node}/qemu/{vmid}/vncproxy` (VMs) with Proxmox API token → gets one-time ticket + port
2. Backend proxies the WebSocket connection to `wss://proxmox-host:8006` (avoids CORS, avoids exposing Proxmox directly)
3. Frontend embeds **xterm.js** (LXC shell) or **noVNC** (VM graphical console) — same libraries Proxmox uses

One persistent WebSocket connection per open console tab. Fine for single-user homelab.

**One-click provisioning UI (Semaphore integration)**

Once Semaphore is deployed (Phase 3):
- Each task template maps to a `POST /api/v2/project/{id}/tasks` call with optional extra vars
- Job logs stream back via Semaphore's SSE endpoint into a terminal panel in the UI
- Status badges on the dashboard show last-run result per template

---

## Key gotchas

- **etcd on Proxmox VMs requires `cache=writeback`.** `cache=none` (O_DIRECT) with LVM thin provisioning starves etcd fsync even on decent SSDs. This caused the previous cluster corruption. Set `cache=writeback` in `terraform/talos-vms.tf` disk blocks — it's already done, don't revert it.
- **ArgoCD OIDC depends on Authentik user/group existing.** Set those up in the UI first.
- **Forward-auth middleware gets added to IngressRoutes.** Middleware is already deployed (`authentik-forwardauth`); just reference it in the route metadata.
- **Pi-hole proxy provider needs to forward to `http://10.0.1.160/admin`** — use the LXC's internal IP, not a public domain.
- **Memory budget assumes game LXCs are stopped when idle.** This is an operational discipline, not enforced by code.
- **Longhorn on a single host is a SPOF** — PV replication is moot until a second node exists.

---

## Working agreement

- This file covers future plans and design decisions.
- Completed work gets trimmed down and archived to `docs/` (gotchas, runbooks).
- Every non-obvious choice gets an ADR in `docs/adr/` when it ships.
