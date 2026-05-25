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

### DNS Configuration

| Component | Primary | Secondary | Notes |
|---|---|---|---|
| Talos nodes | Cloudflare 1.1.1.1 | Pi-hole 10.0.1.160 | Prevents Pi-hole overload from affecting cluster |
| CoreDNS | Cloudflare 1.1.1.1 | (direct, no secondary) | 3 replicas with topology spread (1 per node); external queries go direct to Cloudflare |
| Pi-hole | — | — | Provides `*.lab.ryantaylor.tech` wildcard DNS for external access (10.0.1.210) |

**DNS resolution flow:**
- **Inside cluster pods**: CoreDNS → local resolution for cluster.local, direct Cloudflare for external
- **Node system DNS**: systemd-resolved → Cloudflare primary, Pi-hole secondary
- **External (Proxmox/network)**: Pi-hole → resolves `*.lab.ryantaylor.tech` to VIP

## Storage

| Pool | Type | Used by | Notes |
|---|---|---|---|
| `data` | LVM-thin (`pve` VG) | All LXCs | ~58 GB |
| `ssd-1` | LVM-thin | Talos VM disks | Intel 2500 Pro SSD; ~219 GB |
| `ssd-2` | LVM-thin (not yet provisioned) | Future backups / redundancy | Intel 2500 Pro SSD; LVM VG must be created before adding as Proxmox storage |
| `old-hdd` | Directory | — | Filesystem mount only; not a Proxmox storage pool |

## Talos Cluster (VMs)

| VM ID | Hostname | IP | Role | vCPU | RAM | Disk |
|---|---|---|---|---|---|---|
| 200 | talos-cp | `10.0.1.200` | control-plane | 2 | 6 GB (no balloon) | 40 GB on `ssd-1`, `cache=writeback` |
| 201 | talos-worker-1 | `10.0.1.201` | worker | 4 | 4–6 GB (balloon) | 60 GB on `ssd-1`, `cache=writeback` |
| 202 | talos-worker-2 | `10.0.1.202` | worker | 4 | 4–6 GB (balloon) | 60 GB on `ssd-1`, `cache=writeback` |

- Talos v1.13.0, Kubernetes v1.36.0
- Secrets: `kubernetes/talos/secrets.sops.yaml` (age-encrypted)
- NIC: `ens18`
- Known gotcha | Talos v1.13 `talosctl gen config` produces multi-document YAML. The second document is `kind: HostnameConfig` with `auto: stable`. To set a static hostname, change that document to `hostname: <name>` — do NOT use `machine.network.hostname` in the main document; it conflicts and causes `"static hostname is already set in v1alpha1 config"`. JSON6902 patches are unsupported on multi-document configs; use strategic-merge patches for the main doc and edit the HostnameConfig document directly in the generated file. After applying, a reboot is required for the kubelet to re-register under the new name. Delete the old stale node object with `kubectl delete node <old-name>` after the node rejoins.
- Known gotcha | **Proxmox host kernel slab leak**: Heavy Kubernetes networking churn (Flannel/kube-proxy restarts, iptables cycling) causes `kmalloc-rnd-10-*` slab accumulation in `SUnreclaim`. This is unreclaimable and does not self-heal. Symptom: Proxmox host `free -h` shows near-zero available memory despite low RSS in `ps`. OOM killer will fire on KVM processes once swap saturates. Recovery: cleanly shut down VMs, reboot the host. Detection: PrometheusRule `ProxmoxHostSlabLeakWarning` fires at 4 GB SUnreclaim; `ProxmoxHostSlabLeakCritical` at 10 GB.
- Known gotcha | **Worker unreachable taints**: After a host reboot or network disruption, workers may accumulate `node.kubernetes.io/unreachable:NoSchedule` and `node.kubernetes.io/unreachable:NoExecute` taints that prevent pod scheduling even after the nodes are Ready. Clear manually: `kubectl taint node <name> node.kubernetes.io/unreachable:NoSchedule- node.kubernetes.io/unreachable:NoExecute-`

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
| 11 | metrics-server | `kube-system` | metrics.k8s.io API — enables kubectl top + Homepage kubernetes widget |
| 11 | monitoring-config | `monitoring` | SOPS secrets + IngressRoutes for monitoring stack |
| 12 | monitoring | `monitoring` | kube-prometheus-stack (Prometheus + Grafana + Alertmanager) |
| 13 | loki-config | `loki` | Namespace (privileged PSA) + IngressRoute |
| 14 | loki | `loki` | Loki log aggregation (single-binary mode) |
| 15 | promtail | `loki` | Promtail DaemonSet — cluster pod logs → Loki |
| 16 | uptime-kuma | `uptime-kuma` | Synthetic uptime checks for all services |
| 17 | homepage | `homepage` | Dashboard landing page at `lab.ryantaylor.tech` |
| 1 | argocd-image-updater | `argocd` | Watches image registries and auto-updates app image tags |

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
| Entrypoints | `web` (:80, redirects to HTTPS), `websecure` (:443), `ldap` (:389 TCP → Authentik LDAP outpost) |
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
| LDAP outpost | Embedded outpost also serves LDAP on pod port 3389; exposed via `authentik-ldap` Service + Traefik TCP IngressRouteTCP at `10.0.1.210:389` |
| LDAP bind account | Authentik user `ldap-bind` — password in `ansible/group_vars/all/secrets.sops.yaml` |
| LDAP admin group | `lxc-admins` Authentik group — members get passwordless sudo on all LXCs via SSSD |
| Known gotcha | Authentik 2026.x changed the Traefik forward-auth path from `/auth/tr` → `/auth/traefik`. Middleware address must end in `/outpost.goauthentik.io/auth/traefik` |
| Known gotcha | ArgoCD v2.14.x schema doesn't include `terminatingReplicas` (added in k8s 1.36) — add `ignoreDifferences` with `jqPathExpressions: [.status.terminatingReplicas]` on Deployment and StatefulSet |

### kube-prometheus-stack

| | |
|---|---|
| Version | 84.5.0 (chart) |
| Namespace | `monitoring` |
| Helm repo | `https://prometheus-community.github.io/helm-charts` |
| Grafana URL | `https://grafana.lab.ryantaylor.tech` |
| Prometheus URL | `https://prometheus.lab.ryantaylor.tech` |
| Alertmanager URL | `https://alertmanager.lab.ryantaylor.tech` |
| Grafana auth | Authentik forward-auth + Grafana auth.proxy (auto-login via X-Authentik-Username header) |
| Grafana admin password | `monitoring/monitoring-secrets` Secret, key `grafana-admin-password` (SOPS: `monitoring-config/monitoring-secrets.sops.yaml`) |
| Grafana dashboards | Node Exporter Full (ID 1860) auto-provisioned via `grafana.dashboards` in Helm values — shows CPU/RAM/disk/network for all LXCs + Proxmox host |
| Grafana dashboards | Game Servers — custom ConfigMap (`monitoring-config/game-servers-dashboard.yaml`, label `grafana_dashboard: "1"`) — CPU%, RAM%, network, disk gauges, and live Loki log panels for Minecraft/Terraria/Corekeeper |
| Prometheus retention | 30d, 20Gi PVC on `local-path` |
| Alertmanager config | `monitoring/alertmanager-config` Secret (SOPS: `monitoring-config/alertmanager-config.sops.yaml`) |
| Alertmanager destination | ntfy at `http://ntfy.ntfy.svc.cluster.local/homelab-alerts`, topic `homelab-alerts` |
| Proxmox host scrape | `10.0.1.135:9100` — job `proxmox-host-node-exporter` |
| LXC scrape targets | 10.0.1.151–153, 160–161 on port 9100 — job `lxc-node-exporter` |
| Disabled monitors | kubeScheduler, kubeControllerManager, kubeEtcd, kubeProxy (Talos doesn't expose these) |
| LXC alert rules | `monitoring-config/lxc-alerts.yaml` — fires on: node_exporter unreachable >5m, disk >90%, memory >90% |
| Known gotcha | `ServerSideApply=true` required — chart installs many CRDs that would conflict with ArgoCD's default 3-way merge |
| Known gotcha | `monitoring` namespace must have `pod-security.kubernetes.io/enforce: privileged` for node-exporter (hostNetwork/hostPID/hostPath) |
| Known gotcha | local-path PVCs + subPath bind mounts: kubelet's fsGroup chown does NOT propagate through the subPath. Init container must mount with the same `subPath` and `mountPath` as the main container, then chown there |
| Known gotcha | Control plane VM must NOT balloon — when ballooned to floor (2 GB) under kube-prometheus-stack load, kube-apiserver OOMs in a Go runtime crash loop. Set `dedicated = 4096` (no `floating`) in Terraform |
| Known gotcha | Grafana init-chown-data drops all caps except CHOWN; after Grafana writes 0700 dirs to the PVC, rolling updates fail traversing them. Fix: add `DAC_OVERRIDE` via `grafana.initChownData.securityContext.capabilities.add` |
| Known gotcha | `prometheusAdapter.enabled: true` does not render resources when `fullnameOverride: monitoring` is set — use standalone metrics-server instead |
| Known gotcha | Grafana 13 App Platform (grafana-apiserver) uses a separate `resource-db` SQLite file for unified storage. 3 concurrent job drivers contend on `resource_version` table at startup — enable `database.wal: true` in grafana.ini to enable WAL mode and eliminate SQLITE_BUSY errors |
| Known gotcha | Grafana 13 plugin loading (grafana-exploretraces, lokiexplore, metricsdrilldown, pyroscope) takes 1.5–2 min with network timeouts; total startup is ~3.5 min. Liveness probe must have `initialDelaySeconds: 180` + `failureThreshold: 10` (280s total) to survive. Default 60s delay kills Grafana before HTTP server opens |
| Known gotcha | `grafana-sc-dashboard` and `grafana-sc-datasources` sidecars have no default resource limits — set `sidecar.resources.limits.memory: 128Mi` or node OOM killer will target them during pressure |

### metrics-server

| | |
|---|---|
| Version | 3.12.2 (chart) |
| Namespace | `kube-system` |
| Helm repo | `https://kubernetes-sigs.github.io/metrics-server/` |
| Purpose | Serves `metrics.k8s.io/v1beta1` — enables `kubectl top nodes/pods` and Homepage kubernetes widget CPU/memory display |
| Known gotcha | Talos kubelet TLS certs are signed by the Talos CA. metrics-server must use `--kubelet-insecure-tls` to skip cert verification when scraping kubelet |

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

### Loki

| | |
|---|---|
| Version | 6.29.0 (chart), Loki 3.x |
| Namespace | `loki` |
| Helm repo | `https://grafana.github.io/helm-charts` |
| URL | `https://loki.lab.ryantaylor.tech` |
| Mode | Single-binary (1 replica) |
| Storage | Filesystem, 10Gi PVC on `local-path` at `/var/loki` |
| Auth | Disabled (`auth_enabled: false`) — internal-only, behind Pi-hole wildcard DNS |
| Schema | v13 (tsdb + filesystem, from 2024-04-01) |
| Grafana datasource | `http://loki.loki.svc.cluster.local:3100` — added via `additionalDataSources` in kube-prometheus-stack values |
| Push endpoint | `http://loki.loki.svc.cluster.local:3100/loki/api/v1/push` (cluster Promtail) |
| Push endpoint (LXC) | `http://loki.lab.ryantaylor.tech/loki/api/v1/push` (LXC Promtail via Traefik) |
| Known gotcha | Loki 6.x chart omits `spec.updateStrategy.type` and `spec.persistentVolumeClaimRetentionPolicy` in the rendered StatefulSet; k8s 1.36 defaults both, causing a permanent OutOfSync. Fix: add global `resource.customizations.ignoreDifferences.apps_StatefulSet` to `argocd-cm` (in bootstrap). App-level `ignoreDifferences.jqPathExpressions` alone is insufficient when global argocd-cm customizations are not set. |

### Promtail (cluster)

| | |
|---|---|
| Version | 6.16.6 (chart) |
| Namespace | `loki` |
| Helm repo | `https://grafana.github.io/helm-charts` |
| Type | DaemonSet — ships cluster pod logs to Loki |
| Loki target | `http://loki.loki.svc.cluster.local:3100/loki/api/v1/push` |
| Scrapes | `/var/log/pods/` on each node (standard kubelet log path) |

### Promtail (LXC)

| | |
|---|---|
| Version | 3.0.0 (binary) |
| Managed by | Ansible `base` role |
| Installed on | All LXCs: CT 151–153, 160–161 |
| Config | `/etc/promtail/config.yml` (template: `ansible/roles/base/templates/promtail-config.yml.j2`) |
| Loki target | `http://loki.lab.ryantaylor.tech/loki/api/v1/push` |
| Labels | `job: lxc`, `host: <hostname>` (system logs); `job: game_server`, `host: <hostname>` (game logs) |
| Log paths (all LXCs) | `/var/log/*.log`, `/var/log/syslog` |
| Log paths (game servers) | `/home/*/log/*.log` (LGSM console logs), `/home/*/serverfiles/logs/*.log` (Minecraft game logs) — set via `group_vars/game_servers/vars.yml` |

### Homepage

| | |
|---|---|
| Version | v0.10.9 |
| Namespace | `homepage` |
| Image | `ghcr.io/gethomepage/homepage:v0.10.9` |
| URL | `https://lab.ryantaylor.tech` (apex) |
| TLS cert | `homepage/apex-lab-tls` — separate Certificate resource (apex not covered by wildcard) |
| Auth | None — dashboard is internal-only via Tailscale |
| Config | ConfigMap `homepage-config` — settings, services, widgets, kubernetes config |
| Kubernetes integration | ClusterRole `homepage` via in-cluster ServiceAccount — reads nodes/pods/deployments |
| Minecraft widget | `type: minecraft, url: udp://10.0.1.152:25565` — shows server status and player count when CT 152 is running |
| Known gotcha | cert-manager v1.16 Cloudflare bug prevents apex + wildcard sharing SANs. Apex cert is its own Certificate resource in the `homepage` namespace; IngressRoute references it via `tls.secretName: apex-lab-tls` |

### Uptime Kuma

| | |
|---|---|
| Version | 1.23.16 |
| Namespace | `uptime-kuma` |
| Image | `louislam/uptime-kuma:1.23.16` |
| URL | `https://uptime.lab.ryantaylor.tech` |
| Auth | Built-in (set admin account on first visit) |
| Storage | 2Gi PVC on `local-path` at `/app/data` (SQLite) |
| Notes | Auth is Uptime Kuma's own login — no Authentik forward-auth. Status pages are publicly accessible. |

### ArgoCD Image Updater

| | |
|---|---|
| Version | 1.1.5 (chart), v1.1.1 (app) |
| Namespace | `argocd` |
| Helm repo | `https://argoproj.github.io/argo-helm` |
| Purpose | Watches ghcr.io for new image tags and commits updated tag back to repo (or updates live ArgoCD apps) |
| Registry | `ghcr.io` — credentials from `argocd/ghcr-credentials` Secret (not in repo — create manually after rebuild) |
| Credentials secret | `kubectl -n argocd create secret generic ghcr-credentials --from-literal=username=ryyyyan-taylor --from-literal=password=<github-pat>` — PAT needs `read:packages` scope |
| Notes | No `ImageUpdater` CRs configured yet — secret is pre-provisioned for when auto-update annotations are added to apps |

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
| ghcr-credentials | `argocd/ghcr-credentials` Secret (not in repo — create manually) | GitHub PAT (`read:packages`) for ArgoCD Image Updater to pull from ghcr.io |

## Cluster Rebuild

See `MIGRATION.md` in the repo root for the full step-by-step rebuild guide. High-level order:

1. Terraform destroy + apply Talos VMs (use `-target` for the 3 VM resources)
2. Generate fresh Talos secrets + machine configs, SOPS-encrypt, commit
3. `talosctl apply-config --insecure` to each node, then `talosctl bootstrap`
4. `kubectl apply -k kubernetes/bootstrap/argocd/` — install ArgoCD with KSOPS CMP
5. `kubectl -n argocd create secret generic ksops-age-key --from-file=keys.txt=~/.config/sops/age/keys.txt`
6. `kubectl apply -f kubernetes/bootstrap/root-app.yaml` — ArgoCD syncs all apps in wave order
7. Reconfigure Authentik (postgres PV is lost on rebuild — ~10 min of UI work)
