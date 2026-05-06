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

| VM ID | Hostname | IP | Role | Notes |
|---|---|---|---|---|
| 200 | talos-t0g-4zz | `10.0.1.200` | control-plane | 2 vCPU / 4 GB, 40 GB on `hdd` |
| 201 | talos-h1c-3en | `10.0.1.201` | worker | 4 vCPU / 6 GB, 60 GB on `hdd` |
| 202 | talos-v2f-zv3 | `10.0.1.202` | worker | 4 vCPU / 6 GB, 60 GB on `hdd` |

Talos v1.13.0, Kubernetes v1.36.0. Secrets: `kubernetes/talos/secrets.sops.yaml` (age-encrypted). NIC: `ens18`.

## Containers

| CT ID | Hostname | IP | Purpose | Notes |
|---|---|---|---|---|
| 151 | corekeeper | `10.0.1.151` | Corekeeper game server | Internet-exposed (port TBD) |
| 152 | minecraft | `10.0.1.152` | Minecraft server | Internet-exposed TCP 25565 |
| 153 | terraria | `10.0.1.153` | Terraria server | Internet-exposed TCP 7777 |
| 160 | pi-hole | `10.0.1.160` | DNS + ad-blocking | Host networking on :53 |
| 161 | network | `10.0.1.161` | Tailscale subnet router | Privileged LXC; advertises `10.0.1.0/24` |
