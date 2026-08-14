# Gotchas

Durable operational lessons — things that already have a working fix in
place, kept so the fix doesn't get accidentally reverted or re-derived from
scratch. Open, unresolved faults live in [known-issues.md](known-issues.md)
instead. Moved out of `PLAN.md` on 2026-08-14 so the plan stays a working
document.

- **etcd on Proxmox VMs requires `cache=writeback`.** `cache=none` (O_DIRECT)
  with LVM thin provisioning starves etcd fsync even on decent SSDs. This
  caused the previous cluster corruption. Set `cache=writeback` in
  `terraform/talos-vms.tf` disk blocks — it's already done, don't revert it.
- **ArgoCD OIDC depends on Authentik user/group existing.** Set those up in
  the UI first.
- **Forward-auth middleware gets added to IngressRoutes.** Middleware is
  already deployed (`authentik-forwardauth`); just reference it in the route
  metadata.
- **Pi-hole proxy provider needs to forward to `http://10.0.1.160/admin`** —
  use the LXC's internal IP, not a public domain.
- **Memory budget assumes game LXCs are stopped when idle.** This is an
  operational discipline, not enforced by code.
- **Longhorn on a single host is a SPOF** — PV replication is moot until a
  second node exists.
- **Proxmox host is pinned to kernel `6.14.11-9-pve`** (held via
  `apt-mark hold`) because the NVIDIA driver doesn't build against newer
  kernels yet. Boot default uses `GRUB_DEFAULT=saved` + `grub-set-default` —
  a static `GRUB_DEFAULT="<title>"` silently failed to take effect (suspected
  LVM `grubenv` reliability issue). If the host ever boots the wrong kernel,
  re-run `grub-set-default`, don't just re-edit `/etc/default/grub`.

## Talos — reverted approaches, do not revisit

Tried during Phase 2 (cluster startup robustness) cleanup attempts for the
flannel/`cni0` fault (see [known-issues.md](known-issues.md), "Flannel CNI
fault on talos-qif-ocq"). Both caused a reboot loop on **both** workers and
were reverted:

- ❌ `machine.files` drop-in at
  `/etc/systemd/system/kubelet.service.d/10-cleanup.conf` — Talos `/etc` is
  read-only at runtime; this doesn't work as a live fix mechanism.
- ❌ `ip link del cni0` as a boot hook via the same `machine.files`
  mechanism — same read-only-`/etc` problem.

Any future fix for the flannel fault needs a different delivery mechanism
than `machine.files` boot hooks.

## Ansible / `adopt-lxcs.yml`

- **Bootstrap ordering bug, affects every fresh LXC:** the `base` role's
  "Ensure rt home directory exists" task runs *before* `sssd` (which is what
  makes the LDAP-resolved `rt` user resolvable at all) — fails with `chown
  failed: failed to look up user rt` on any container that's never had
  `sssd` run before. **Workaround for first-time bootstrap:** run with
  `-e base_manage_rt_user=false` on the first pass, then a normal second run
  once `sssd` is live. Not restructured (existing hosts' behavior with a
  role-order fix unverified) — just documenting the workaround.
