resource "proxmox_virtual_environment_container" "corekeeper" {
  node_name     = "rt"
  vm_id         = 151
  unprivileged  = true
  started       = true
  start_on_boot = false # start on demand; auto-start would eat RAM reserved for Talos

  cpu {
    architecture = "amd64"
    cores        = 4
  }

  memory {
    dedicated = 8192
    swap      = 512
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }

  initialization {
    hostname = "corekeeper"

    ip_config {
      ipv4 {
        address = "10.0.1.151/24"
        gateway = "10.0.1.1"
      }
      ipv6 {
        address = "dhcp"
      }
    }
  }

  disk {
    datastore_id = "local-lvm"
    size         = 8
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    firewall    = true
    mac_address = "BC:24:11:44:10:59"
  }

  features {
    nesting = true
  }

  operating_system {
    template_file_id = "local:vztmpl/placeholder"
    type             = "debian"
  }

  lifecycle {
    ignore_changes = [
      started,
      operating_system,
    ]
  }
}

resource "proxmox_virtual_environment_container" "minecraft" {
  node_name     = "rt"
  vm_id         = 152
  unprivileged  = true
  started       = true
  start_on_boot = false

  cpu {
    architecture = "amd64"
    cores        = 4
  }

  memory {
    dedicated = 8192
    swap      = 512
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }

  initialization {
    hostname = "minecraft"

    ip_config {
      ipv4 {
        address = "10.0.1.152/24"
        gateway = "10.0.1.1"
      }
    }
  }

  disk {
    datastore_id = "local-lvm"
    size         = 8
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    firewall    = true
    mac_address = "BC:24:11:CE:C8:D9"
  }

  features {
    nesting = true
  }

  operating_system {
    template_file_id = "local:vztmpl/placeholder"
    type             = "debian"
  }

  lifecycle {
    ignore_changes = [started, operating_system]
  }
}

resource "proxmox_virtual_environment_container" "terraria" {
  node_name     = "rt"
  vm_id         = 153
  unprivileged  = true
  started       = true
  start_on_boot = false

  cpu {
    architecture = "amd64"
    cores        = 4
  }

  memory {
    dedicated = 8192
    swap      = 512
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }

  initialization {
    hostname = "terraria"

    ip_config {
      ipv4 {
        address = "10.0.1.153/24"
        gateway = "10.0.1.1"
      }
      ipv6 {
        address = "dhcp"
      }
    }
  }

  disk {
    datastore_id = "local-lvm"
    size         = 8
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    firewall    = true
    mac_address = "BC:24:11:95:9D:14"
  }

  features {
    nesting = true
  }

  operating_system {
    template_file_id = "local:vztmpl/placeholder"
    type             = "debian"
  }

  lifecycle {
    ignore_changes = [started, operating_system]
  }
}

resource "proxmox_virtual_environment_container" "pihole" {
  node_name     = "rt"
  vm_id         = 160
  unprivileged  = true
  started       = true
  start_on_boot = true

  cpu {
    architecture = "amd64"
    cores        = 1
  }

  memory {
    dedicated = 512
    swap      = 512
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }

  initialization {
    hostname = "pi-hole"

    ip_config {
      ipv4 {
        address = "10.0.1.160/24"
        gateway = "10.0.1.1"
      }
      ipv6 {
        address = "dhcp"
      }
    }
  }

  disk {
    datastore_id = "local-lvm"
    size         = 8
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    firewall    = true
    mac_address = "BC:24:11:A1:57:76"
  }

  features {
    nesting = true
  }

  operating_system {
    template_file_id = "local:vztmpl/placeholder"
    type             = "debian"
  }

  lifecycle {
    ignore_changes = [operating_system]
  }
}

# CT 161 — Tailscale subnet router (repurposed from "admin")
# TUN device passthrough is set directly in Proxmox and not tracked by Terraform:
#   lxc.cgroup2.devices.allow: c 10:200 rwm
#   lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
resource "proxmox_virtual_environment_container" "network" {
  node_name     = "rt"
  vm_id         = 161
  unprivileged  = true
  started       = true
  start_on_boot = true

  cpu {
    architecture = "amd64"
    cores        = 4
  }

  memory {
    dedicated = 8192
    swap      = 512
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }

  initialization {
    hostname = "network"

    ip_config {
      ipv4 {
        address = "10.0.1.161/24"
        gateway = "10.0.1.1"
      }
      ipv6 {
        address = "dhcp"
      }
    }
  }

  disk {
    datastore_id = "local-lvm"
    size         = 8
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    firewall    = true
    mac_address = "BC:24:11:42:E7:A2"
  }

  features {
    nesting = true
  }

  operating_system {
    template_file_id = "local:vztmpl/placeholder"
    type             = "debian"
  }

  lifecycle {
    ignore_changes = [operating_system]
  }
}
