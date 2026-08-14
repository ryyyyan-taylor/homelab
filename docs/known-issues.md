# Known Issues

Open, currently-unresolved faults — not gotchas with a working fix already
applied (those live in [gotchas.md](gotchas.md)). Update status here as
these get worked. Moved out of `PLAN.md` on 2026-08-14 so the plan stays a
working document; this is the durable record of open faults.

## Flannel CNI fault on talos-qif-ocq — cross-node pod networking fails

**Status: OPEN**, found 2026-08-07 while investigating the Proxmox host
memory leak (unrelated root cause — see [gotchas.md](gotchas.md)).

**Before proposing a fix, read [gotchas.md](gotchas.md#talos--reverted-approaches-do-not-revisit)**
— two `machine.files` boot-hook approaches were already tried for this exact
fault and reverted after causing a reboot loop on both workers (Talos `/etc`
is read-only at runtime).

`promtail-6zz29` on `talos-qif-ocq` (10.0.1.202 / worker-2, VM 202) sits at
`0/1 Running` indefinitely. Every log push to `loki.loki.svc.cluster.local:3100`
fails with `context deadline exceeded`, which is what keeps its readiness
probe red. `loki-0` itself is healthy (`2/2`) but runs on a *different* node
(`talos-2q4-izc`, 10.0.1.201), so this reads as a **cross-node pod-network
dataplane failure from worker-2**, not a promtail or Loki problem.

Separately, that node's pod sandbox creation failed repeatedly right after
boot with:

```
plugin type="flannel" failed (add): failed to load flannel 'subnet.env' file:
open /run/flannel/subnet.env: no such file or directory
```

Those two symptoms may or may not be the same fault — the `subnet.env` errors
cluster around startup (consistent with a flannel-not-ready race), while the
Loki push timeout persists long after boot. Don't assume one explains the
other without checking.

**Why it matters:** before the 2026-08-07 host reboot the cluster had
accumulated an enormous restart storm concentrated in the network tier —
`metallb-speaker-dx2zx` **1370** restarts, `kube-flannel-9tk65` **450**,
`metallb-speaker-kmjrj` 411, `kube-flannel-qbhgp` 182, `metrics-server` 114,
`kube-proxy-nshlr` 87. This flannel fault is the most likely driver. The
reboot reset all restart counters, so recurrence will now be visible from a
clean baseline.

**Explicitly NOT the cause of the host slab leak.** That was the io_uring
iovec leak (CVE-2026-23259), proven separately: the leak grew at a constant
270–400 MB/h across a 10-hour window with *zero* pod restarts cluster-wide.
Fixed via `aio=threads`. Do not re-derive "networking churn causes the slab
leak" — it was tested and disproven.

**Leads to start from:**
- `kubectl logs -n kube-system <kube-flannel pod on talos-qif-ocq>` — check
  for subnet lease/VXLAN errors.
- Confirm `/run/flannel/subnet.env` now exists on that node and matches its
  assigned podCIDR (`kubectl get node talos-qif-ocq -o jsonpath='{.spec.podCIDR}'`).
- Test pod-to-pod across nodes directly (exec into a pod on worker-2, curl a
  pod IP on worker-1) to confirm whether the whole cross-node path is down or
  only Service/ClusterIP resolution.
- VXLAN needs UDP 8472 between node IPs — worth ruling out at the Proxmox
  bridge/firewall layer, since `network_device { firewall = true }` is set on
  all three Talos VMs in Terraform.

## CT161 (network) subnet router doesn't NAT forwarded traffic

**Status: OPEN**, found while setting up Aider (a local coding assistant
pointed at Ollama on CT170) from `ryan-desktop`.

CT161 advertises `10.0.1.0/24` as a Tailscale subnet route, letting remote
tailnet devices reach the LAN. That part works for devices that are actually
remote. It breaks for a tailnet client that's *also already on the LAN*
(e.g. `ryan-desktop`, both physically on `10.0.1.0/24` and joined to the
tailnet): with `--accept-routes` enabled, the client starts preferring the
tailscale-advertised route over its own direct LAN interface (confirmed via
`ip route get` — traffic to `10.0.1.170` correctly showed `dev tailscale0
src 100.x.x.x`, overriding the local connected route). CT161 forwards that
traffic onward *without masquerading it* — the destination device (e.g. CT170)
sees the real tailnet source IP (`100.x.x.x`) and, having no idea how to route
back to `100.64.0.0/10` (it's not a tailnet member and the LAN's physical
router doesn't know about the tailnet either), the reply just vanishes.
Symptom: not "connection refused" (that's the nftables firewall's normal
reject behavior) but a plain **connection timeout** — the request leaves,
nothing ever comes back.

**Worse, this isn't scoped to one destination** — enabling `--accept-routes`
changes the routing preference for the *entire* `10.0.1.0/24` subnet from
that client, not just the one host you're trying to reach. This actually
broke `ryan-desktop`'s SSH access to the Proxmox host itself (10.0.1.135)
mid-session, since that traffic also got rerouted through the same broken
path. Reverted immediately with `tailscale up --accept-routes=false`.

**Workaround in place:** for Aider's desktop-to-Ollama access, allow-listed
`ryan-desktop`'s direct LAN IP in `ollama_api_allowed_sources` instead of
routing through Tailscale — see the `ollama` Ansible role / [LXC-Ollama
wiki page](https://github.com/ryyyyan-taylor/homelab/wiki/LXC-Ollama).

**Real fix (not yet done):** add a MASQUERADE rule on CT161 for traffic it
forwards from the tailnet onto the LAN (`nft add rule ip nat postrouting
oifname "eth0" ip saddr 100.64.0.0/10 masquerade`, or the iptables
equivalent) so forwarded traffic appears to originate from CT161's own LAN
IP — non-tailnet LAN devices would then just reply to CT161 directly, a
normal LAN neighbor, no special routing knowledge required on their end.
Not applied yet because testing it means deliberately re-enabling
`--accept-routes` on a machine this session depends on for LAN access to
the whole lab — worth doing as a deliberate, isolated step, not a side
effect of unrelated work.

## sssd / Authentik LDAP outpost: rootDSE incompatibility blocks all LDAP logins

**Status: OPEN.** Affects every LXC (151–153, 160, 161, 170), not just one.
Root SSH access is unaffected (doesn't go through sssd/LDAP) — only the
LDAP-resolved `rt` user (SSH + passwordless sudo) is broken.

**How this was found:** while working on CT170 (Ollama), `sssd` reported its
LDAP backend "offline." Initial diagnosis was a stale password in
`ansible/inventory/group_vars/all/secrets.sops.yaml`. That turned out to be
half right and half wrong:

1. **First real problem (fixed):** the `ldap-bind` service account **did not
   exist in Authentik at all** — Directory → Users showed only
   `semaphore-admin`, `rt`, `akadmin`. It was apparently never recreated after
   the cluster rebuild, even though the LDAP outpost/provider config and all
   the `sssd.conf` references to `cn=ldap-bind,ou=users,...` were still in
   place. No password could ever have matched, because there was nothing to
   match against.
   - **Fix applied:** created a new Service Account named `ldap-bind` in
     Authentik with a password, updated the secret with
     `sops set ansible/inventory/group_vars/all/secrets.sops.yaml
     '["ldap_bind_password"]' '"<new password>"'`, re-ran `adopt-lxcs.yml`
     against all LXCs.
   - **Verified working:** `ldapsearch -x -H ldap://10.0.1.210 -D
     'cn=ldap-bind,ou=users,dc=ldap,dc=goauthentik,dc=io' -w '<password>' -b ''
     -s base '(objectclass=*)'` succeeds and returns full rootDSE data
     including `namingContexts: dc=ldap,dc=goauthentik,dc=io`. The credential
     itself is now genuinely correct.

2. **Second, separate problem (still open):** even with the correct
   credential, `sssd` still can't resolve LDAP users — `getent passwd rt` and
   `id rt` both return "no such user" on every LXC tested (CT161, CT170).
   - `sssd`'s connection setup does a rootDSE probe
     (`sdap_get_rootdse_send`/`sdap_get_rootdse_done`) as one of its first
     steps on every new connection. Against Authentik's outpost, this search
     returns `Success(0)` at the protocol level but with **empty values** for
     `namingContexts`/`defaultNamingContext` — even though the exact same
     query, run manually via authenticated `ldapsearch`, returns them
     populated.
   - `sssd`'s `sdap_set_config_options_with_rootdse` treats a failed
     `get_naming_context` as fatal ("get_naming_context failed") and the
     request never proceeds to the actual user lookup — **even though
     `ldap_search_base = dc=ldap,dc=goauthentik,dc=io` is already explicitly
     set in `sssd.conf`** and shouldn't require rootDSE auto-detection at all.
   - A plain anonymous `ldapsearch` (no bind DN) against rootDSE gets
     `Insufficient access (50)` — suggesting Authentik's outpost requires
     authentication even for rootDSE, which may not be happening yet at the
     point in `sssd`'s connection sequence where it issues this probe (no
     explicit "bind" step appears in the `sssd` debug log before the rootDSE
     search, at least not at the current debug verbosity).
   - **Ruled out:** explicitly setting `ldap_schema = rfc2307` in
     `sssd.conf` (to skip AD-vs-generic-LDAP schema auto-detection, which is
     bundled into the same rootDSE-dependent routine) — tested on CT161, no
     effect, reverted.
   - **This has likely been broken for a while, silently.** `sssd` caches
     credentials (`cache_credentials: true`), so every existing LXC
     authenticated successfully *once*, a long time ago, and has been serving
     `rt`/sudo from that local cache ever since — never needing a fresh bind.
     CT170, a brand-new container with zero cache, was the first thing to
     actually need a live bind and immediately exposed it.

**Next steps (not yet tried):**
- Check Authentik's LDAP Provider config itself (not just the user account)
  for a "Bind mode" or search-permission/ACL setting that could affect
  anonymous/pre-bind rootDSE visibility — plausibly something else that reset
  during the cluster rebuild alongside the missing service account.
- Search for known Authentik LDAP outpost ↔ sssd interop issues upstream —
  Authentik's LDAP server is a simplified/custom implementation, not full
  OpenLDAP/AD, so a rootDSE gap like this is plausible as an upstream
  limitation rather than something fixable purely from the `sssd.conf` side.
- Consider raising `sssd`'s debug level (`debug_level` in `sssd.conf`) to
  confirm definitively whether the rootDSE probe is happening before or after
  a real bind.

## CT161 (network) live config drifted from Terraform

**Status: OPEN**, flagged during CT170 (Ollama) work, not fixed.

`terraform plan` shows a pending, un-applied diff: Terraform declares
`cores=4`/`memory=8192` for CT161, but the **live** container is actually
running `cores=2`/`memory=2048`. Someone resized it outside Terraform at some
point (Proxmox UI/CLI directly), or the repo's declared spec was bumped
without ever being applied. Not touched — it's the live Tailscale subnet
router, and applying the diff would resize/restart it, which needs to be a
deliberate, scheduled action, not a side effect of unrelated work.

**Next step:** decide which is actually intended — `terraform apply` to bump
the live container to 4c/8GB, or edit `terraform/lxcs.tf` down to match the
live 2c/2GB reality — then apply whichever one is correct.

## ArgoCD `metrics-server` app stuck in Unknown sync status

**Status: OPEN**, cosmetic, low priority. `ComparisonError` dated
2026-05-23: `.status.terminatingReplicas: field not declared in schema`. The
`metrics-server` pod itself is Running/healthy — this is purely an ArgoCD
schema-diffing quirk against a field that field ArgoCD's older API model
doesn't recognize, not a real functional problem.

## ArgoCD `semaphore` app OutOfSync

**Status: OPEN**, cosmetic, low priority. `SharedResourceWarning`:
`Secret/semaphore-general is part of applications argocd/semaphore and
semaphore-config`. Doesn't affect functionality, just keeps the app showing
OutOfSync instead of Synced.
