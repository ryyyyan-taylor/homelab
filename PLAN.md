# Homelab Platform — Plan

A portfolio-grade homelab built as a coherent platform: declarative, observable, self-service. The pitch is **"my homelab is a Kubernetes platform team in miniature."**

Status: **planning**. This document is the source of truth for scope and sequencing; it will be edited as decisions evolve.

**At a glance:**

| Phase | Theme | Gating | Effort estimate |
|---|---|---|---|
| 0 | Foundation: repo skeleton, SOPS, Tailscale, PBS | none — actionable now | 1 weekend |
| 0.5 | Adopt 4 existing LXCs into Ansible + Terraform + PBS | Phase 0 | ~2 days (½ day per LXC) |
| 1 | Talos cluster + Argo CD + Traefik + cert-manager + Authentik | ~~1 TB drive installed~~ ✓ | 1–2 weekends |
| 2 | Observability + dashboard + alerts | Phase 1 | 1 weekend |
| 3 | Self-service via GH Actions + golden images | Phase 2 | 2 weekends |
| 4 | Resilience: DR runbook + drills | Phase 3 | 1 weekend |
| 5 | Polish: ADRs, README rewrite, diagrams | Phase 4 | 1 weekend |

Phases 0 and 0.5 are unblocked today. **Phase 1 is also now unblocked** — the 1 TB drive has arrived and is configured as LVM thin pool `hdd` on VG `hdd`.

---

## Goals

1. **Visible** — one place to see what's running, what's healthy, and what's broken.
2. **Declarative** — the running state matches a git repo. Rebuilding from bare metal is a documented procedure, not tribal knowledge.
3. **Self-service** — provisioning a new VM, LXC, or app is a button or a PR, not a sequence of CLI commands.
4. **Defensible as a portfolio piece** — every choice has a "why," and the README explains it.

## Non-goals

- Full HA across multiple physical hosts (single Proxmox host is fine).
- Production-grade security posture. Hardening is an explicit phase, not the default.
- Reinventing tools that already exist. Prefer well-known OSS over custom.
- **Forcing every existing workload onto Kubernetes.** Hybrid is the design (see below).

## Hybrid by design: LXCs and K8s coexist

Existing LXCs stay LXCs unless there's a concrete reason to move them. Kubernetes earns its keep for *new* workloads or for services that benefit from what the cluster provides (Authentik SSO, automated TLS, GitOps reconciliation, ingress). The platform treats both as first-class:

| Concern | LXC / VM path | K8s path |
|---|---|---|
| Provisioning | Terraform (proxmox provider) | Terraform (Talos VMs) + Argo CD |
| Configuration | Ansible roles | Helm + Kustomize via Argo CD |
| Secrets | SOPS + age (decrypted at deploy) | SOPS + age via Argo CD + KSOPS plugin |
| Metrics | node_exporter scraped by cluster Prometheus | kube-prometheus-stack |
| Logs | Promtail on the LXC → Loki | Promtail DaemonSet → Loki |
| Backups | Proxmox Backup Server (local) | PBS for Talos VMs + Longhorn snapshots for PVs |
| Visibility | Homepage tile + Uptime Kuma check | same |
| Access | Authentik via Traefik forward-auth (LXC behind cluster ingress) | Authentik proxy provider |

### What actually runs on the K8s cluster

The cluster is the homelab's **management, auth, and observability plane** — not a data path for existing workloads. Runtime traffic to game servers and DNS continues to hit those LXCs directly. What flows through the cluster is admin UIs (fronted by Traefik + Authentik), metrics (Prometheus scrapes LXC node_exporters), logs (Promtail on LXC → Loki), and dashboards (Homepage, Grafana, Uptime Kuma).

It runs two things:

**1. The platform tier** — services that make the rest of the homelab nicer:
- Traefik + cert-manager (TLS for cluster *and* LXC services via forward-auth upstreams)
- Authentik (single sign-on in front of everything, including LXC web UIs)
- kube-prometheus-stack + Loki + Promtail (monitors cluster *and* LXCs via node_exporter)
- Homepage + Uptime Kuma (the dashboard, with tiles for both worlds)
- ntfy (self-hosted push notifications, target for Alertmanager)
- Argo CD (the GitOps engine itself)

This is the answer to "why a cluster?" — it's the substrate that ties LXCs and future workloads together under one observable, authenticated, declaratively-managed roof.

**2. New web apps that benefit from the platform tier.** Candidates (none mandatory; add as desired):
- Vaultwarden, Paperless-ngx, Immich, Linkding, Miniflux, code-server, Gitea/Forgejo, n8n, Outline, Vikunja.
- These all have maintained Helm charts and gain real value from SSO + TLS + GitOps.

**What does *not* belong on the cluster** (current state):
- Game servers (Terraria, Factorio, Minecraft) — stateful, raw ports, no SSO/ingress benefit, faster as LXCs.
- Pi-hole — needs host networking on :53.
- Anything else that already works and doesn't pass the migration rubric below.

**Honest framing:** part of the cluster's value is "a place to learn and run new things." That's a legitimate portfolio answer — building and operating the platform tier *is* the demonstration. It's only cosplay if we force-migrate workloads that don't benefit.

### Considered and rejected: skip K8s entirely

The platform tier could have run as LXCs / Docker Compose on the host. Simpler operationally, but the choice was made to use K8s for the GitOps reconciliation story and the portfolio narrative. Recorded here so the rejection is intentional, not an oversight.

### Migration rubric — when to move an LXC into K8s

**Move it** if any apply:
- Would clearly benefit from SSO / automated TLS / ingress already built in K8s.
- Has a maintained Helm chart that matches or beats current config.
- You want declarative reconciliation for it (Argo CD drift correction is genuine value).

**Leave it** if any apply:
- Needs host networking, raw devices, or kernel features (Pi-hole on :53, Tailscale subnet router, hardware-accelerated media transcode).
- Stateful with no good chart and no appetite for writing one.
- It works and there's no portfolio or operational reason to touch it. "If it ain't broke" counts.

### Adopting existing LXCs into the repo (no migration, just management)

This is the practical first step for what's already running. For each existing LXC:
1. Write an Ansible role that describes its *current* state. First run should be a no-op (idempotent).
2. Import it into Terraform state (`terraform import`) so the repo owns its lifecycle.
3. Add node_exporter + Promtail. It now appears in Grafana / Loki.
4. Add a Homepage tile and Uptime Kuma check. It's now on the dashboard.
5. Confirm PBS is backing it up.

This is bounded work — one role per LXC, mostly mechanical — and it's the bridge between "stuff I have running" and "platform I can describe in a portfolio."

### Existing LXC inventory

| CT ID | LXC | Purpose | Verdict | Notes |
|---|---|---|---|---|
| 151 | Corekeeper server | Game server | stay LXC | Stateful world data, raw TCP port; no SSO/ingress benefit |
| 152 | Minecraft server | Game server | stay LXC | World persistence, raw TCP, mods/plugins easier on bare LXC |
| 153 | Terraria server | Game server | stay LXC | Stateful world data, raw TCP port; no SSO/ingress benefit |
| 160 | Pi-hole | DNS + ad-blocking | stay LXC | Host networking on :53; surfaced via Homepage tile + Authentik proxy for the admin UI |
| 161 | network | Tailscale subnet router | stay LXC (repurposed) | Privileged LXC; advertises LAN subnet so all LXCs reachable via Tailscale without installing it on each; replaces jump-host role |

---

## Architecture (target state)

```
┌──────────────────────── Proxmox host ─────────────────────────┐
│                                                                │
│  ┌─ Talos cluster (3 VMs: 1 CP × 4 GB + 2 worker × 6 GB) ─┐  │
│  │  ballooning enabled; game LXCs stopped when inactive   │  │
│  │                                                          │  │
│  │  Platform: Argo CD • Traefik • cert-manager • Authentik │  │
│  │  Observability: Prometheus • Grafana • Loki • Alertmgr  │  │
│  │  Notifications: ntfy        Storage: Longhorn           │  │
│  │  Secrets: SOPS+age (KSOPS)                              │  │
│  │  Apps: Homepage • Uptime Kuma • <user apps>             │  │
│  │                                                          │  │
│  │  All services exposed at *.lab.ryantaylor.tech (LE)     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─ LXC / VMs (non-K8s workloads) ─────────────────────────┐  │
│  │  Pi-hole • Terraria • Factorio • Minecraft • dev VMs    │  │
│  │  (admin UIs fronted by cluster Traefik + Authentik)     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  Proxmox Backup Server (separate VM, local-only)              │
└────────────────────────────────────────────────────────────────┘
         ▲
         │ Terraform (Proxmox provider) + Ansible + Packer
         │
   ┌─────┴──────┐
   │ Git repo   │ ← GitHub Actions builds images, opens PRs,
   │ (this one) │   triggers Terraform; Argo CD reconciles cluster
   └────────────┘
```

---

## Components & choices

| Layer | Choice | Why |
|---|---|---|
| Hypervisor | Proxmox VE | Already running; great API; LXC + KVM in one box |
| Cluster OS | Talos Linux | Immutable, API-driven, no SSH — modern story |
| Cluster shape | 3-node Talos (1 CP × 4 GB + 2 workers × 6 GB) | Feasible on 24 GB because game LXCs stop fully when inactive; ballooning absorbs concurrent peaks |
| GitOps | Argo CD | Recognizable UI, strong industry presence, recruiter-friendly portfolio signal |
| Ingress | Traefik | Native CRDs, dashboard, easy with cert-manager |
| TLS | cert-manager + Let's Encrypt DNS-01 (Cloudflare) | Real wildcard certs for `*.lab.ryantaylor.tech`, services stay internal |
| DNS / domain | `ryantaylor.tech` on Cloudflare; `lab.` subdomain for homelab services | Already owned; great cert-manager support |
| Identity / SSO | Authentik | One login in front of everything (proxy provider for LXC + cluster apps) |
| Storage | Longhorn | Simple, web UI, snapshot support |
| Secrets in git | SOPS + age (decrypted by Argo via KSOPS plugin) | Idiomatic, no extra service to run; Ansible reads the same encrypted files |
| Metrics | kube-prometheus-stack | Prometheus + Grafana + Alertmanager bundled |
| Logs | Loki + Promtail | Pairs with Grafana |
| Synthetic checks | Uptime Kuma | Black-box "is the URL up" view |
| Service tiles | Homepage | Human-facing landing page with status widgets |
| Local DNS | Pi-hole (existing LXC) | Already running; split-horizon for `*.lab.ryantaylor.tech` |
| Backups (VMs/LXC) | Proxmox Backup Server, local-only | Fast restore on local hardware; off-site explicitly out of scope |
| Backups (K8s PVs) | Longhorn snapshots + PBS on Talos VMs | Stay on the same host; no off-site target |
| Remote access | Tailscale | Free, MagicDNS, no inbound ports — replaces a previously failed Cloudflare Tunnel attempt |
| Notifications | ntfy (self-hosted in cluster) | Push-to-phone, also reusable for any future automation |
| Provisioning | Terraform (telmate/proxmox) + Packer + Ansible | IaC for VMs/LXC, golden images, post-boot config |
| CI | GitHub Actions (hosted runners) | Lint, validate, `terraform plan` output on PRs — no homelab access needed |
| CD (Phases 0–2) | Local machine via Tailscale | Solo operator; `terraform apply` and `ansible-playbook` run directly from laptop |
| CD (Phase 3+) | Self-hosted GH Actions runner (small LXC) | Enables `workflow_dispatch` self-service without being at a laptop; outbound-only to GitHub |
| Self-service | Phase 3: GH Actions `workflow_dispatch` from Homepage tiles | Phase 5 stretch: custom self-service portal |

### Decisions locked

- Domain: `ryantaylor.tech` (owned), services at `*.lab.ryantaylor.tech`.
- DNS provider: Cloudflare (already in use).
- TLS: cert-manager + Let's Encrypt DNS-01, single wildcard.
- Secrets: SOPS + age, decrypted by Argo CD (KSOPS) and Ansible from the same encrypted files.
- GitOps: Argo CD.
- Remote access: Tailscale (Cloudflare Tunnels explicitly rejected based on prior frustration).
- SSO: Authentik proxy provider, fronted by Traefik for both cluster and LXC services.
- CI: GitHub Actions hosted runners.
- Backups: PBS local-only; off-site explicitly out of scope.
- Notifications: ntfy self-hosted in cluster.
- Phase 3 self-service: GH Actions `workflow_dispatch` triggered from Homepage tiles.
- Network: flat — single `vmbr0` bridge, no VLANs.
- Naming: `<service>.lab.ryantaylor.tech`; apex `lab.ryantaylor.tech` resolves to Homepage as the dashboard landing page.
- LXC inventory source: manual configuration only — Phase 0.5 Ansible roles are reverse-engineered by hand (~½ day per LXC).
- Cluster shape: **3-node Talos from day one** (1 control plane at 4 GB + 2 workers at 6 GB each). Feasible because game LXCs are fully stopped when inactive, freeing their RAM allocation. Proxmox memory ballooning enabled on the Talos VMs so concurrent peaks (cluster busy + all game servers running) don't OOM.
- Operational pattern: **game LXCs are started on demand, stopped when not in use.** This is load-bearing for the RAM budget — if game LXCs end up left running idle, the cluster has to size down.

### Hardware

| Resource | Current | Notes |
|---|---|---|
| CPU | Intel i7-4790 (4c / 8t) | Fine for homelab; ~1.5x oversubscription on Talos VMs is normal |
| RAM | 24 GB | **The binding constraint.** Drives 3-node sizing (4+6+6) and dependence on game-LXC stop-on-idle pattern |
| GPU | GTX 1650 | Not on critical path; future passthrough opportunity (Jellyfin transcode, small ML) |
| Storage | 200 GB SSD (`data` thin pool, VG `pve`, ~58 GB thin provisioned) + **1 TB HDD (`hdd` thin pool, VG `hdd`, ~980 GB)** | 1 TB configured as LVM thin; all existing LXCs on `data`; Talos VMs will use `hdd` |

**RAM budget at current scale (game LXCs fully stopped when inactive):**

| Workload | Steady state | All game servers active |
|---|---|---|
| Proxmox + ZFS ARC | 3 GB | 3 GB |
| Pi-hole | 0.5 GB | 0.5 GB |
| Minecraft LXC | 0 (stopped) | ~3 GB |
| Factorio LXC | 0 (stopped) | ~2 GB |
| Terraria LXC | 0 (stopped) | ~1 GB |
| Talos CP VM (4 GB allocated) | ~2.5 GB used | ~3 GB used |
| Talos worker 1 (6 GB allocated) | ~4 GB used | ~5 GB used |
| Talos worker 2 (6 GB allocated) | ~4 GB used | ~5 GB used |
| **Total used** | **~14 GB** of 24 GB | **~22.5 GB** of 24 GB |
| **Total allocated** (sum of caps) | 19.5 GB | 25.5 GB |

Steady state is comfortable. The "all game servers active" peak exceeds total allocation by 1.5 GB but **fits within real usage thanks to Proxmox memory ballooning** — Talos VMs return unused allocation to the host under pressure. Concurrent peaks are infrequent by design (game servers are started on demand).

If RAM is later upgraded, sizing increases per VM rather than adding nodes — 3 nodes is the right shape for this cluster regardless.

**Public exposure (documented, not blanket-policy):**

| LXC | Internet-exposed | Reason |
|---|---|---|
| Minecraft | TCP 25565 | Friends play |
| Terraria | TCP 7777 | Friends play |
| Corekeeper | TBD | Friends play |
| Everything else | Tailscale-only | Default |

Game-server LXCs sit *slightly outside* the SSO trust boundary — they're internet-reachable on their game ports. SSO/TLS via cluster Traefik covers their **admin/web UIs** when present, not the game protocols themselves. Implication: keep them patched; don't assume Authentik is in the request path for game traffic.

---

## Phases

Each phase is a shippable milestone with a tagged commit and a README section. Don't skip ahead — earlier phases unblock later ones.

### Phase 0 — Foundation (the boring, load-bearing stuff)
- [x] Proxmox host inventoried, networking documented (flat `vmbr0`, IP plan).
- [x] Repo structure scaffolded: `terraform/`, `ansible/`, `packer/`, `kubernetes/` (Argo root), `docs/`.
- [x] SOPS + age set up; age key backed up *outside* the repo (password manager + offline copy); first secret encrypted and decryptable in CI.
- [x] Tailscale installed in CT 161 (network LXC), configured as subnet router advertising the LAN subnet. Proxmox host stays clean.
- **Exit criteria**: `terraform apply` of an empty change is a clean no-op; SOPS roundtrip works in CI.

### Phase 0.5 — Adopt existing LXCs
Repurpose CT 161 (admin → network): strip it back, install Tailscale, configure as subnet router. Self-hosted GH Actions runner deferred to Phase 3.

For each remaining LXC (Corekeeper, Minecraft, Terraria, Pi-hole — CT IDs 151–153, 160):
- [ ] Ansible role describing current state, idempotent (first run = no-op).
- [ ] `terraform import` so the LXC's lifecycle is owned by the repo.
- [ ] node_exporter + Promtail agents installed (running idle; cluster Prometheus/Loki will scrape them in Phase 2).

Homepage tiles and Uptime Kuma checks are deferred to **Phase 2** — they need services that don't exist yet.

- **Exit criteria**: every running LXC is described by code in this repo. Re-running Ansible is a no-op.

### Phase 1 — Platform (Talos + GitOps + ingress + TLS)
- [x] **Prerequisite: 1 TB drive installed** — drive is online as LVM thin pool `hdd` (VG `hdd`, ~980 GB). Talos VMs will be provisioned onto `hdd`; existing LXCs stay on `data`.
- [ ] Packer builds a Talos boot image (or use upstream factory).
- [ ] Terraform provisions **3 Talos VMs**: 1 control plane (4 GB / 2 vCPU / 40 GB) + 2 workers (6 GB / 4 vCPU / 60 GB each). Memory ballooning enabled on all three.
- [ ] Bootstrap Argo CD pointing at this repo (app-of-apps pattern).
- [ ] KSOPS plugin configured on Argo's repo-server; age key delivered as a cluster secret.
- [ ] Traefik + cert-manager (with Cloudflare DNS-01 issuer) + Authentik installed via Argo CD.
- [ ] Wildcard cert issued for `*.lab.ryantaylor.tech`.
- [ ] One trivial app (e.g., `whoami`) reachable at `https://whoami.lab.ryantaylor.tech` behind Authentik.
- **Exit criteria**: I can `kubectl delete` the whole cluster, re-run Terraform + Argo bootstrap, and the trivial app comes back without manual steps (one documented manual step: providing the age key + Cloudflare API token to the fresh cluster).

### Phase 2 — Visibility (the dashboard story)
- [ ] kube-prometheus-stack via Argo CD; Grafana behind Authentik.
- [ ] Loki + cluster-side Promtail; LXC Promtails (installed in Phase 0.5) start shipping to it.
- [ ] Prometheus configured to scrape: Proxmox host node_exporter, each LXC's node_exporter, in-cluster targets.
- [ ] Uptime Kuma deployed; synthetic checks added for every service in the inventory (cluster + LXC).
- [ ] Homepage deployed as the landing page at `lab.ryantaylor.tech`; tiles added for every service in the inventory; status widgets wired to Uptime Kuma + Prometheus.
- [ ] ntfy server deployed; Alertmanager wired to publish to ntfy topics; phone subscribed.
- **Exit criteria**: one URL (`lab.ryantaylor.tech`) shows host + cluster + LXC service health. Alertmanager pushes a phone notification via ntfy when something is actually broken.

### Phase 3 — Self-service ("1-click")
- [ ] **Self-hosted GH Actions runner** provisioned as a small LXC on the homelab. Polls GitHub for jobs; all connections outbound — no inbound ports or public exposure. Hosted runners continue handling CI jobs that don't need homelab access (lint, validate, plan).
- [ ] GitHub Actions `workflow_dispatch` workflows for: "create dev VM," "create LXC," "deploy app from template." These run on the self-hosted runner so they can reach the Proxmox API and LXC targets directly.
- [ ] Triggers: Homepage tile links (with prefilled inputs) and `gh` CLI.
- [ ] Workflows run Terraform and/or open an Argo-tracked PR; results visible in the GH Actions UI.
- [ ] Packer-built golden images: dev VM (Ubuntu + dotfiles), dev container (devcontainer-style), GUI VM (Ubuntu + RDP/Sunshine).
- [ ] A "new app" template workflow: opens a PR adding an Argo Application, Authentik proxy provider, Homepage tile, and Uptime Kuma monitor in one commit.
- **Exit criteria**: spinning up a fresh dev VM is a single button, takes < 5 min, and ends with an SSH-ready host registered in Tailscale.

### Phase 4 — Resilience (local-only)
PBS already exists (Phase 0). This phase is about making recovery a practiced procedure, not just an assumption.

- [ ] Proxmox Backup Server provisioned (separate VM); first manual backup of an existing LXC verified by restore.
- [ ] PBS retention + scheduling policies set for all VMs/LXCs (daily/weekly/monthly tier).
- [ ] Longhorn snapshot schedule for K8s PVs; recovery rehearsed on a scratch namespace.
- [ ] Documented disaster recovery runbook: "what's recoverable, what isn't, how to rebuild from this repo + local PBS." Explicit about catastrophic host loss = data loss for non-replicated services; this is the chosen tradeoff.
- [ ] Scheduled "DR drill" workflow that monthly restores a tagged backup into a scratch namespace and asserts data integrity.
- **Exit criteria**: the DR drill has run end-to-end at least once; runbook walks through a real recovery I've actually performed.

### Phase 5 — Polish (portfolio finish)
- [ ] Architecture diagram (Excalidraw or D2) committed to `docs/`.
- [ ] README rewrite: what this is, what it demonstrates, how to read the repo.
- [ ] Per-component ADRs in `docs/adr/` for the non-obvious choices (Talos vs k3s, Argo vs Flux, Longhorn vs Rook, local-only backups, Tailscale vs CF Tunnel, RAM budgeting + ballooning approach).
- [ ] Demo script / screencast (optional but high-leverage for portfolio).
- **Exit criteria**: a stranger can read the README and know within 60 seconds what the project is, what's hard about it, and where the interesting code lives.

---

## Out-of-scope (for now, with rationale)

- **Multi-node physical cluster** — no second host yet; revisit if/when there is one.
- **Service mesh (Istio/Linkerd)** — overkill for a homelab; Traefik mTLS is enough.
- **Hardening / pen-test posture** — a possible future phase if pursued; not blocking the portfolio story.
- **Custom self-service portal as an MVP** — deferred to Phase 5 stretch; GitHub Actions is the cheap path to the same capability.
- **Off-site backups** — explicit user decision. Local PBS only. Catastrophic host loss = data loss; trade-off documented in the DR runbook.
- **Cloudflare Tunnels** — rejected after a prior bad experience; Tailscale handles all remote access.
- **Self-hosted forge (Forgejo/Gitea)** — sticking with hosted GitHub for the portfolio.

---

## Risks / things likely to bite

- **Talos learning curve** — no SSH, everything via `talosctl`. Budget a weekend for Phase 1.
- **Longhorn on a single host** — replication factor is moot with one node; storage is a SPOF until there's a second host.
- **Argo bootstrap chicken-and-egg** — the SOPS age key and Cloudflare API token live outside git. Bootstrap is: (1) create cluster, (2) `kubectl create secret` for age key + CF token, (3) `kubectl apply` Argo + root Application, (4) Argo takes over. Document this manual step honestly; don't hide it.
- **KSOPS in Argo** — Argo CD doesn't have native SOPS support like Flux does. KSOPS is a Kustomize plugin baked into the Argo repo-server image (or installed via init-container). Standard pattern, but it's an extra moving part vs. Flux's built-in support — worth being aware of.
- **No off-site backups** — by design, but the DR runbook needs to state this plainly. If the host's drives die, the K8s PVs are gone unless the data is also reproducible from git.
- **ntfy in-cluster is partly self-referential** — if the cluster is down, ntfy can't tell you. Acceptable for homelab scale; mitigation if it bites: a small external watchdog (a `cron` on the Proxmox host pinging the cluster API and sending direct ntfy.sh on failure).
- **Pi-hole is also self-referential** — if Pi-hole goes down, internal `*.lab.ryantaylor.tech` resolution may break, which means the dashboard you'd use to debug it is unreachable. Mitigation: keep `/etc/hosts` entries for the most critical services on the laptop you'd debug from.
- **RAM budget assumes game LXCs are stopped when inactive** — if they're left running idle, ~6 GB of overhead returns and concurrent demand starts pushing into ballooning territory all the time. The pattern of "start on demand, stop after" is a real operational discipline this plan depends on.

---

## Working agreement

- This file is updated whenever scope, sequencing, or component choices change. Don't let it rot.
- Each phase ends with a tagged commit (`phase-1-platform`, etc.) so the history is legible.
- Every non-obvious choice gets one paragraph in `docs/adr/` when it lands — not before.
