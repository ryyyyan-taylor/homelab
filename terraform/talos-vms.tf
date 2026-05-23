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
# Memory ballooning: dedicated = guaranteed floor, floating = cap.
# Talos VMs return unused RAM to the host under pressure.

resource "proxmox_virtual_environment_vm" "talos_cp" {
  name      = "talos-cp"
  node_name = "rt"
  vm_id     = 200

  started  = false
  on_boot  = true

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
    datastore_id = "hdd"
    interface    = "virtio0"
    size         = 40
    file_format  = "raw"
    discard      = "on"
    cache        = "writeback"
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

  started  = false
  on_boot  = true

  cpu {
    cores   = 4
    sockets = 1
    type    = "host"
  }

  memory {
    dedicated = 4096
    floating  = 6144
  }

  disk {
    datastore_id = "hdd"
    interface    = "virtio0"
    size         = 60
    file_format  = "raw"
    discard      = "on"
    cache        = "writeback"
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

resource "proxmox_virtual_environment_vm" "talos_worker_2" {
  name      = "talos-worker-2"
  node_name = "rt"
  vm_id     = 202

  started  = false
  on_boot  = true

  cpu {
    cores   = 4
    sockets = 1
    type    = "host"
  }

  memory {
    dedicated = 4096
    floating  = 6144
  }

  disk {
    datastore_id = "hdd"
    interface    = "virtio0"
    size         = 60
    file_format  = "raw"
    discard      = "on"
    cache        = "writeback"
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
