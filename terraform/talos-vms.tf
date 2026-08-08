# Talos cluster — 1 control plane + 2 workers
#
# Planned IPs (set in Talos machine config, not by Proxmox):
#   talos-cp:       10.0.1.200
#   talos-worker-1: 10.0.1.201
#   talos-worker-2: 10.0.1.202
#
# Bootstrap procedure (one-time, after terraform apply):
#   1. Start each VM — they boot from ISO into Talos maintenance mode
#   2. Apply machine configs: talosctl apply-config --insecure --nodes <ip> --file <cfg>
#   3. talosctl bootstrap --nodes 10.0.1.200
#   4. VMs reboot from disk; detach ISO from each VM in Proxmox UI
#
# No ballooning on any node — control-plane and workers all run with a
# fixed dedicated allocation. Ballooning previously caused guest-level
# OOMs under load (workloads pinned at the dedicated floor, never
# actually reaching the floating cap); see per-VM notes below.

resource "proxmox_virtual_environment_vm" "talos_cp" {
  name      = "talos-cp"
  node_name = "rt"
  vm_id     = 200

  started = false
  on_boot = true

  cpu {
    cores   = 2
    sockets = 1
    type    = "host"
  }

  # Control plane never balloons — API server OOMs took down the cluster
  # when ballooned to dedicated floor under kube-prometheus-stack load.
  # 6 GB needed because etcd + API server hold all kube-prometheus-stack
  # CRDs/objects in memory; 4 GB hit 97% under steady-state load.
  memory {
    dedicated = 6144
  }

  disk {
    datastore_id = "ssd-1"
    interface    = "virtio0"
    size         = 40
    file_format  = "raw"
    discard      = "on"
    cache        = "writeback"
    # aio=io_uring leaks iovecs on 6.14.x (CVE-2026-23259); host kernel is
    # pinned to 6.14.11-9-pve for the NVIDIA driver, so avoid the path.
    aio = "threads"
  }

  cdrom {
    file_id   = var.talos_iso_file_id
    interface = "ide2"
  }

  network_device {
    bridge   = "vmbr0"
    model    = "virtio"
    firewall = true
  }

  operating_system {
    type = "l26"
  }

  boot_order = ["ide2", "virtio0"]

  lifecycle {
    ignore_changes = [
      started,
      boot_order, # changes after bootstrap when ISO is removed
      cdrom,      # ISO detached manually post-bootstrap
    ]
  }
}

resource "proxmox_virtual_environment_vm" "talos_worker_1" {
  name      = "talos-worker-1"
  node_name = "rt"
  vm_id     = 201

  started = false
  on_boot = true

  cpu {
    cores   = 4
    sockets = 1
    type    = "host"
  }

  # No ballooning — pinned at the dedicated floor with the rest of the
  # cluster's memory pressure caused guest-level OOMs (same failure mode
  # already fixed on talos_cp; see note above).
  memory {
    dedicated = 6144
  }

  disk {
    datastore_id = "ssd-1"
    interface    = "virtio0"
    size         = 60
    file_format  = "raw"
    discard      = "on"
    cache        = "writeback"
    # aio=io_uring leaks iovecs on 6.14.x (CVE-2026-23259); host kernel is
    # pinned to 6.14.11-9-pve for the NVIDIA driver, so avoid the path.
    aio = "threads"
  }

  cdrom {
    file_id   = var.talos_iso_file_id
    interface = "ide2"
  }

  network_device {
    bridge   = "vmbr0"
    model    = "virtio"
    firewall = true
  }

  operating_system {
    type = "l26"
  }

  boot_order = ["ide2", "virtio0"]

  # scsi1 (out-of-band, not expressible here): the 1TB photos drive,
  # attached by hand via `qm set 201 -scsi1
  # /dev/disk/by-id/ata-WDC_WD1003FZEX-00MK2A0_WD-WCC3FP7Y4VCR,discard=on`.
  # The provider's disk{} block only manages datastore-backed volumes, not
  # raw host block-device passthrough — same category of exception as the
  # GPU device lines in /etc/pve/lxc/170.conf. `disk` is ignored below so a
  # future apply doesn't see it as drift and remove it.
  lifecycle {
    ignore_changes = [
      started,
      boot_order,
      cdrom,
      disk,
    ]
  }
}

resource "proxmox_virtual_environment_vm" "talos_worker_2" {
  name      = "talos-worker-2"
  node_name = "rt"
  vm_id     = 202

  started = false
  on_boot = true

  cpu {
    cores   = 4
    sockets = 1
    type    = "host"
  }

  # No ballooning — pinned at the dedicated floor with the rest of the
  # cluster's memory pressure caused guest-level OOMs (same failure mode
  # already fixed on talos_cp; see note above).
  memory {
    dedicated = 6144
  }

  disk {
    datastore_id = "ssd-1"
    interface    = "virtio0"
    size         = 60
    file_format  = "raw"
    discard      = "on"
    cache        = "writeback"
    # aio=io_uring leaks iovecs on 6.14.x (CVE-2026-23259); host kernel is
    # pinned to 6.14.11-9-pve for the NVIDIA driver, so avoid the path.
    aio = "threads"
  }

  cdrom {
    file_id   = var.talos_iso_file_id
    interface = "ide2"
  }

  network_device {
    bridge   = "vmbr0"
    model    = "virtio"
    firewall = true
  }

  operating_system {
    type = "l26"
  }

  boot_order = ["ide2", "virtio0"]

  lifecycle {
    ignore_changes = [
      started,
      boot_order,
      cdrom,
    ]
  }
}
