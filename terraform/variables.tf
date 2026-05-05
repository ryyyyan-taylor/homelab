variable "proxmox_endpoint" {
  description = "Proxmox API endpoint"
  type        = string
  default     = "https://10.0.1.135:8006"
}

variable "proxmox_api_token" {
  description = "Proxmox API token in the form user@realm!tokenid=secret"
  type        = string
  sensitive   = true
}

variable "talos_iso_file_id" {
  description = "Proxmox volume ID of the Talos metal ISO"
  type        = string
  default     = "local:iso/talos-metal-amd64.iso"
}
