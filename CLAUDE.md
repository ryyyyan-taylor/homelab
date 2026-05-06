# Claude Code — Homelab Guidelines

## Documentation

**Always keep `docs/inventory.md` up to date as we work.** Any time we:
- Add, remove, or reconfigure a service
- Change a URL, port, version, or StorageClass
- Add or modify infrastructure (LXCs, VMs, storage pools)
- Change secrets locations or encryption setup
- Add a new ArgoCD application or wave

…update the relevant section of `docs/inventory.md` in the same commit. The doc is the source of truth for "what is running, where, and how."

## Proxmox / LXC rules

- Never install services directly on the Proxmox host — always use a dedicated LXC.
- Never SSH into LXCs to run commands. Provide `pct exec` commands for the user to run on the Proxmox host.
- `pct exec` does not inherit PATH — always use full binary paths (e.g. `/usr/local/bin/pihole`).
- `bpg/proxmox` Terraform resources must always include `ip_config` — omitting it strips IPs from running containers immediately.

## Kubernetes / ArgoCD rules

- All secrets are SOPS-encrypted with age. Never commit plaintext secrets.
- KSOPS only runs in Kustomize-sourced ArgoCD apps — Helm apps cannot use KSOPS directly.
- For Helm apps that need secrets: deploy the SOPS secret via a companion Kustomize app at a lower sync-wave, then reference it via `secretKeyRef` in the Helm values.
- IngressRoutes use `tls: {}` — the default TLSStore holds the `*.lab.ryantaylor.tech` wildcard cert.
- All subdomains of `*.lab.ryantaylor.tech` resolve automatically via Pi-hole wildcard DNS — no extra DNS entries needed for new services.
