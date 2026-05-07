# Homelab Platform — Plan

A portfolio-grade homelab built as a coherent platform: declarative, observable, self-service. The pitch is **"my homelab is a Kubernetes platform team in miniature."**

Status: **mostly built, feature backlog active**. Core infrastructure is deployed and healthy. This document tracks future work and dependency notes.

---

## Current state

**Running and stable:**
- ✅ Talos cluster (3 nodes, K8s v1.36.0)
- ✅ ArgoCD (GitOps, KSOPS secrets)
- ✅ Traefik + cert-manager (TLS, ingress)
- ✅ Authentik (SSO, deployed but not yet wired into everything)
- ✅ Observability: Prometheus + Grafana + Alertmanager + Loki + Promtail
- ✅ Notifications: ntfy → phone
- ✅ Dashboard: Homepage + Uptime Kuma
- ✅ All 5 LXCs adopted into Ansible/Terraform
- ✅ Proxmox host metrics flowing to Prometheus

**Working on or planned:**
- [ ] SSO wiring (Phase 2.5, below)
- [ ] Self-service provisioning (Phase 3)
- [ ] DR runbook + backup validation
- [ ] Documentation polish

---

## Architecture & design decisions

See `docs/inventory.md` for service details, hardware specs, and IP plan.

### Hybrid by design

- **K8s runs the platform tier**: Traefik + Authentik + observability + GitOps.
- **LXCs stay LXCs**: game servers, Pi-hole, Tailscale subnet router (see migration rubric in full PLAN for why).
- Prometheus scrapes both K8s and LXCs; Loki aggregates both.

### Key constraints

- **24 GB RAM** is the binding constraint. Cluster is 1 CP (4 GB) + 2 workers (6 GB each). Game LXCs must be stopped when idle to stay within budget. Memory ballooning on Talos VMs handles occasional peaks.
- **Single Proxmox host** means no HA; Longhorn replication is per-node only. Good for portfolio, not production.
- **Tailscale for remote access** — Cloudflare Tunnels explicitly rejected.
- **Local PBS backups only** — off-site backups out of scope.

---

## Features — ordered by dependency

### Phase 2.5: Authentik SSO wiring

**Status:** Authentik is deployed and healthy. Grafana is already wired (auth.proxy). Everything else needs updates.

**Prerequisite:** at least one Authentik user + group must exist (configure in Authentik UI first).

| Service | Method | Notes |
|---|---|---|
| **ArgoCD** | Native OIDC | Create OAuth2 provider in Authentik; patch `argocd-cm` with `oidc.config`; map groups to roles; disable local `admin`. Most involved. |
| **Traefik dashboard** | Forward-auth middleware | Add `authentik-forwardauth` to IngressRoute. |
| **Prometheus** | Forward-auth middleware | Add `authentik-forwardauth` to IngressRoute. |
| **Alertmanager** | Forward-auth middleware | Add `authentik-forwardauth` to IngressRoute. |
| **Uptime Kuma** | Forward-auth middleware | Add `authentik-forwardauth` to IngressRoute. Uptime Kuma's own login still works behind it. |
| **Pi-hole admin UI** | Authentik proxy provider | Create proxy provider in Authentik; expose at `pihole.lab.ryantaylor.tech` via IngressRoute. Update Homepage to link here. |
| ✅ **Grafana** | Already done | — |
| **Homepage** | Skip | Internal-only, Tailscale is the gate. |
| **ntfy** | Skip | By design — Alertmanager uses ntfy tokens directly. |

**Tasks:**
- [ ] Create Authentik user + group (UI)
- [ ] Create OAuth2/OIDC provider + app for ArgoCD; store client secret in SOPS
- [ ] Patch `argocd-cm` with OIDC config; map Authentik groups to ArgoCD roles
- [ ] Verify ArgoCD login via Authentik; disable local `admin` account
- [ ] Add `authentik-forwardauth` middleware to Traefik dashboard, Prometheus, Alertmanager, Uptime Kuma IngressRoutes
- [ ] Create Authentik proxy provider for Pi-hole; add IngressRoute at `pihole.lab.ryantaylor.tech`
- [ ] Update Homepage configmap to link Pi-hole at the new subdomain
- **Exit criteria:** every admin UI requires Authentik login. No `*.lab.ryantaylor.tech` service is reachable without SSO.

**Effort:** 1–2 hours (ArgoCD OIDC is the heavy lifting; the rest is copy-paste middleware).

---

### Phase 3: Self-service provisioning (GH Actions workflows)

**Prerequisite:** Phase 2.5 (SSO wiring). Optional but sensible to wire SSO first.

**Concept:** GitHub Actions workflows that let you spin up infrastructure from the repo. Self-hosted runner polls GitHub; all connections outbound.

- [ ] Provision self-hosted GH Actions runner as a small LXC (CT TBD)
- [ ] Terraform-based `workflow_dispatch` workflow: "Create dev VM" (size, OS, registers in Tailscale)
- [ ] Terraform-based workflow: "Create LXC" (size, roles, template)
- [ ] Argo Application template workflow: opens a PR wiring a new app (IngressRoute, Authentik provider, Homepage tile, Uptime Kuma monitor)
- [ ] Packer golden images: dev VM, dev container, GUI VM
- [ ] Homepage tile links to GitHub Actions UI, showing status of recent runs

**Exit criteria:** spinning up a dev VM takes one action from GitHub + 5 minutes.

**Effort:** 2–3 weekends (runner setup + workflow scaffolding + golden images).

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

### Phase 5: Documentation & portfolio finish

**Prerequisite:** Phases 2.5, 3, 4 complete (or at least milestones reached).

- [ ] Architecture diagram (Excalidraw or D2)
- [ ] README rewrite: what this is, what it demonstrates, where to read the code
- [ ] ADRs in `docs/adr/`: Talos vs k3s, Argo vs Flux, Longhorn vs Rook, local-only backups, Tailscale, RAM budgeting, etc.
- [ ] Optional: screencast or demo script

**Exit criteria:** a stranger can understand the project in 60 seconds.

**Effort:** 1 weekend.

---

### Future candidates (Phase 5+, optional)

If the portfolio story is solid, consider:

- **Vaultwarden / Paperless / Immich / other apps** — maintained Helm charts, gain real value from SSO + TLS + GitOps
- **Hardening / security audit** — PodSecurityPolicy, network policies, RBAC reviews
- **Multi-node physical cluster** — revisit only if a second host is added
- **Off-site backups** — currently out of scope (local-only by design)
- **Custom self-service portal** — GitHub Actions is sufficient for now

---

## Key gotchas

- **ArgoCD OIDC depends on Authentik user/group existing.** Set those up in the UI first.
- **Forward-auth middleware gets added to IngressRoutes.** Middleware is already deployed (`authentik-forwardauth`); just reference it in the route metadata.
- **Pi-hole proxy provider needs to forward to `http://10.0.1.160/admin`** — use the LXC's internal IP, not a public domain.
- **Memory budget assumes game LXCs are stopped when idle.** This is an operational discipline, not enforced by code.
- **Longhorn on a single host is a SPOF** — PV replication is moot until a second node exists.

---

## Working agreement

- This file is updated whenever scope or dependencies change. Don't let it rot.
- Completed work gets trimmed down and archived to `docs/` (gotchas, runbooks).
- Every non-obvious choice gets an ADR in `docs/adr/` when it ships.
