# Homelab Inventory

## Physical Host

| | |
|---|---|
| Hostname | `rt` |
| CPU | Intel i7-4790 (4c / 8t) |
| RAM | 24 GB |
| GPU | GTX 1650 (not in use) |
| OS | Proxmox VE 9.x |
| IP | `10.0.1.135` |

## Network

Single flat bridge — no VLANs.

| | |
|---|---|
| Bridge | `vmbr0` |
| Subnet | `10.0.1.0/24` |
| Gateway | `10.0.1.1` |

IP convention: containers use `10.0.1.<CT ID>` (e.g. CT 152 → `10.0.1.152`).

| Range | Managed by |
|---|---|
| `10.0.1.1 – 10.0.1.149` | Router DHCP |
| `10.0.1.150+` | Static assignments (Proxmox host, LXCs, VMs) |

## Storage

| Pool | VG | Total | Used by |
|---|---|---|---|
| `data` | `pve` | ~58 GB | All existing LXCs |
| `hdd` | `hdd` | ~980 GB | Talos VMs (Phase 1) |
| `old-hdd` | — | — | Filesystem mount only; not Proxmox storage |

## Talos Cluster (VMs)

| VM ID | Hostname | IP | Role | vCPU | RAM | Disk |
|---|---|---|---|---|---|---|
| 200 | talos-t0g-4zz | `10.0.1.200` | control-plane | 2 | 4 GB | 40 GB on `hdd` |
| 201 | talos-h1c-3en | `10.0.1.201` | worker | 4 | 6 GB | 60 GB on `hdd` |
| 202 | talos-v2f-zv3 | `10.0.1.202` | worker | 4 | 6 GB | 60 GB on `hdd` |

- Talos v1.13.0, Kubernetes v1.36.0
- Secrets: `kubernetes/talos/secrets.sops.yaml` (age-encrypted)
- NIC: `ens18`

## LXC Containers

| CT ID | Hostname | IP | Purpose | Notes |
|---|---|---|---|---|
| 151 | corekeeper | `10.0.1.151` | Corekeeper game server | Internet-exposed (port TBD) |
| 152 | minecraft | `10.0.1.152` | Minecraft server | Internet-exposed TCP 25565 |
| 153 | terraria | `10.0.1.153` | Terraria server | Internet-exposed TCP 7777 |
| 160 | pi-hole | `10.0.1.160` | DNS + ad-blocking | Host networking on :53 |
| 161 | network | `10.0.1.161` | Tailscale subnet router | Privileged LXC; advertises `10.0.1.0/24` |

---

## Kubernetes Platform Services

All services below are deployed via ArgoCD (app-of-apps pattern). Source of truth: `kubernetes/apps/platform/`. Sync is automated with self-heal and prune enabled.

### Cluster-wide

| Item | Detail |
|---|---|
| Ingress entrypoint | Traefik at `10.0.1.210` (MetalLB VIP) |
| TLS | Let's Encrypt prod wildcard `*.lab.ryantaylor.tech` via cert-manager + Cloudflare DNS-01 |
| DNS | Pi-hole wildcard: `address=/.lab.ryantaylor.tech/10.0.1.210` → all subdomains resolve automatically |
| Secrets encryption | SOPS + age. Public key: `age1pht0t0fr9gr8tf2vqm5y4s8lrg6g2xtql5m2xgzm4lv38mhaqfsslekwsa` |
| Secret decryption in-cluster | KSOPS sidecar on ArgoCD repo-server; age private key in `argocd/ksops-age-key` Secret |
| Default StorageClass | `local-path` (local-path-provisioner) |

### ArgoCD

| | |
|---|---|
| Namespace | `argocd` |
| URL | `https://argocd.lab.ryantaylor.tech` *(to be added)* |
| Bootstrap | `kubectl apply -f kubernetes/bootstrap/` |
| App config | `kubernetes/apps/` (app-of-apps via `root-app.yaml`) |

### Sync Wave Order

| Wave | App | Namespace | Purpose |
|---|---|---|---|
| 0 | cert-manager | `cert-manager` | TLS certificate controller |
| 1 | cert-manager-config | `cert-manager` | ClusterIssuers + Cloudflare token |
| 2 | metallb | `metallb-system` | Layer-2 load balancer |
| 3 | metallb-config | `metallb-system` | IP pool `10.0.1.210/32` + L2Advertisement |
| 4 | traefik | `traefik` | Ingress controller |
| 5 | traefik-config | `traefik` | Wildcard cert + TLSStore + dashboard IngressRoute |
| 6 | local-path-provisioner | `local-path-storage` | Default StorageClass for PVCs |
| 7 | authentik-config | `authentik` | SOPS secrets + Authentik IngressRoute |
| 8 | authentik | `authentik` | SSO provider (Helm) |
| 9 | whoami | `whoami` | SSO smoke-test app |
| 10 | ntfy | `ntfy` | Push notifications (Alertmanager target) |

### cert-manager

| | |
|---|---|
| Version | v1.16.1 |
| Namespace | `cert-manager` |
| Helm repo | `https://charts.jetstack.io` |
| ClusterIssuers | `letsencrypt-staging`, `letsencrypt-prod` |
| Challenge type | DNS-01 via Cloudflare API token |
| Cloudflare token secret | `cert-manager/cloudflare-api-token` (SOPS: `cert-manager-config/cloudflare-token.sops.yaml`) |
| Wildcard cert | `*.lab.ryantaylor.tech` — Secret `traefik/wildcard-lab-ryantaylor-tech-tls` |
| Known gotcha | cert-manager v1.16 Cloudflare bug: if cert has two SANs sharing the same `_acme-challenge` name, the DELETE call fails with empty zone ID. Fix: wildcard cert covers only `*.lab.ryantaylor.tech` (no apex). If renewal gets stuck: `kubectl -n traefik delete certificaterequest <name>` |

### MetalLB

| | |
|---|---|
| Version | v0.14.8 |
| Namespace | `metallb-system` |
| Helm repo | `https://metallb.github.io/metallb` |
| Mode | L2 |
| VIP | `10.0.1.210/32` |
| Known gotcha | Talos requires `pod-security.kubernetes.io/enforce: privileged` label on `metallb-system` namespace for the speaker pod |

### Traefik

| | |
|---|---|
| Version | v34.4.0 (chart) |
| Namespace | `traefik` |
| Helm repo | `https://traefik.github.io/charts` |
| External IP | `10.0.1.210` (MetalLB VIP) |
| Dashboard | `https://traefik.lab.ryantaylor.tech` |
| Entrypoints | `web` (:80, redirects to HTTPS), `websecure` (:443) |
| TLS | Default TLSStore set to wildcard cert — all IngressRoutes use `tls: {}` |
| Cross-namespace IngressRoutes | Enabled (`allowCrossNamespace: true`) |
| Known gotcha | Chart v34 removed `ports.web.redirectTo` — use `ports.web.redirections.entryPoint` instead |

### local-path-provisioner

| | |
|---|---|
| Version | v0.0.35 |
| Namespace | `local-path-storage` |
| Source | `https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.35/deploy/local-path-storage.yaml` |
| StorageClass | `local-path` (default) |
| Storage path | `/opt/local-path-provisioner` on each node |
| Notes | Patched via Kustomize to set `storageclass.kubernetes.io/is-default-class: "true"` |
| Known gotcha | Talos requires `pod-security.kubernetes.io/enforce: privileged` label on `local-path-storage` namespace — the helper pod uses hostPath volumes which `baseline` policy forbids |

### Authentik

| | |
|---|---|
| Version | 2026.2.2 (chart + app) |
| Namespace | `authentik` |
| Helm repo | `https://charts.goauthentik.io` |
| URL | `https://authentik.lab.ryantaylor.tech` |
| Database | Bundled PostgreSQL (bitnami subchart), 8 Gi PVC on `local-path` |
| Cache | Bundled Redis (no persistence) |
| Secrets | `authentik/authentik-secrets` (SOPS: `authentik-config/authentik-secrets.sops.yaml`) |
| Secret keys | `secret-key`, `postgresql-password`, `postgresql-postgres-password` |
| Secret injection | `global.env` with `valueFrom.secretKeyRef`; postgres subchart uses `postgresql.auth.existingSecret` |
| IngressRoute | `authentik-config/ingressroute.yaml` — deployed at wave 7 before Helm pods start |
| Forward auth | Embedded outpost (`authentik Embedded Outpost`) — Go router on port 9000 inside server pod |
| Known gotcha | Authentik 2026.x changed the Traefik forward-auth path from `/auth/tr` → `/auth/traefik`. Middleware address must end in `/outpost.goauthentik.io/auth/traefik` |
| Known gotcha | ArgoCD v2.14.x schema doesn't include `terminatingReplicas` (added in k8s 1.36) — add `ignoreDifferences` with `jqPathExpressions: [.status.terminatingReplicas]` on Deployment and StatefulSet |

### ntfy

| | |
|---|---|
| Version | v2.11.0 |
| Namespace | `ntfy` |
| Image | `binwiederhier/ntfy:v2.11.0` |
| URL | `https://ntfy.lab.ryantaylor.tech` |
| Auth | ntfy built-in (`auth-default-access: deny-all`) — no Authentik forward-auth |
| Storage | 2Gi PVC on `local-path` at `/var/lib/ntfy` (auth DB + cache DB + attachments) |
| Post-deploy setup | See "ntfy user setup" below |
| Notes | Intentionally NOT behind Authentik — Alertmanager and phone app use ntfy tokens directly |

**ntfy user setup (run once after first deploy):**
```bash
# Create admin user (for web UI)
kubectl exec -n ntfy deploy/ntfy -- ntfy user add --role=admin <username>

# Create publisher token for Alertmanager
kubectl exec -n ntfy deploy/ntfy -- ntfy token add <username>

# Grant subscriber access to a topic (phone app)
kubectl exec -n ntfy deploy/ntfy -- ntfy access <username> homelab-alerts read-write
```

### whoami (SSO smoke test)

| | |
|---|---|
| Namespace | `whoami` |
| URL | `https://whoami.lab.ryantaylor.tech` |
| Image | `traefik/whoami:latest` |
| Purpose | Verifies end-to-end SSO: Traefik → Authentik forward-auth → authenticated response with `X-Authentik-*` headers |
| Middleware | `authentik-forwardauth` (Traefik namespace, cross-namespace reference) |

---

## LXC Service Details

### Pi-hole (CT 160)

| | |
|---|---|
| Version | v6 |
| IP | `10.0.1.160` |
| DNS port | :53 (host networking) |
| Web UI | `http://10.0.1.160/admin` |
| Wildcard DNS | `address=/.lab.ryantaylor.tech/10.0.1.210` |
| DNS config method | Pi-hole v6 FTL CLI — `/etc/dnsmasq.d/` is ignored in v6 |

To update DNS entries (run on Proxmox host):
```bash
pct exec 160 -- /usr/local/bin/pihole-FTL --config misc.dnsmasq_lines '["address=/.lab.ryantaylor.tech/10.0.1.210"]'
pct exec 160 -- /usr/local/bin/pihole reloaddns
```

### Tailscale Subnet Router (CT 161)

| | |
|---|---|
| IP | `10.0.1.161` |
| Advertises | `10.0.1.0/24` |
| Type | Privileged LXC |

### Game Servers

| CT | Game | Port | Notes |
|---|---|---|---|
| 151 | Corekeeper | TBD | Internet-exposed |
| 152 | Minecraft | TCP 25565 | Internet-exposed |
| 153 | Terraria | TCP 7777 | Internet-exposed |

---

## Secrets & Keys

| Secret | Location | Notes |
|---|---|---|
| Age private key (local) | `~/.config/sops/age/keys.txt` | Used to encrypt/decrypt all SOPS files |
| Age public key | `age1pht0t0fr9gr8tf2vqm5y4s8lrg6g2xtql5m2xgzm4lv38mhaqfsslekwsa` | In `.sops.yaml` |
| Age private key (in-cluster) | `argocd/ksops-age-key` Secret | Mounted into ArgoCD repo-server sidecar |
| Cloudflare API token | `cert-manager-config/cloudflare-token.sops.yaml` | DNS-01 challenge for cert-manager |
| Talos secrets | `kubernetes/talos/secrets.sops.yaml` | Cluster bootstrap secrets |
| Authentik secrets | `authentik-config/authentik-secrets.sops.yaml` | secret-key + postgres passwords |

## One-manual-step Rebuild

To rebuild the cluster from scratch:

1. Provision Talos VMs via Terraform
2. Apply Talos config: `talosctl apply-config ...`
3. Import age private key into cluster: `kubectl -n argocd create secret generic ksops-age-key --from-file=keys.txt=~/.config/sops/age/keys.txt`
4. Bootstrap ArgoCD: `kubectl apply -f kubernetes/bootstrap/`
5. ArgoCD syncs everything in wave order automatically
