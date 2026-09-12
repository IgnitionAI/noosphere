variable "server_id" {
  type        = number
  description = "Existing SCP server ID, shown in the Netcup server page URL."
  validation {
    condition     = var.server_id > 0 && floor(var.server_id) == var.server_id
    error_message = "server_id must be a positive integer."
  }
}

variable "expected_server_name" {
  type        = string
  description = "Exact existing Netcup server name, used to prevent adopting another server."
}

variable "expected_ipv4" {
  type        = string
  description = "IPv4 verified in the selected server's Netcup panel."
  validation {
    condition     = can(cidrnetmask("${var.expected_ipv4}/32"))
    error_message = "Provide a valid IPv4 address."
  }
}

variable "nickname" {
  type        = string
  default     = "Noosphere"
  description = "Display label in Netcup. This is the only server attribute changed."
}

variable "application_hostname" {
  type        = string
  description = "Public hostname whose DNS is separately pointed to the server."
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,}$", var.application_hostname))
    error_message = "Provide a hostname without a scheme, path or port."
  }
}
