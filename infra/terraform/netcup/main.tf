terraform {
  required_version = ">= 1.5.7, < 2.0.0"
  required_providers {
    netcup = {
      source  = "rixlhq/netcup"
      version = "1.2.1"
    }
  }
}

# Authentication comes from NETCUP_SCP_ACCESS_TOKEN or NETCUP_SCP_REFRESH_TOKEN.
# Do not pass credentials as Terraform variables or commit them to state inputs.
provider "netcup" {}

data "netcup_scp_server" "existing" {
  server_id = var.server_id
}

# Adopt the purchased server; never install an image or create/delete a VPS.
resource "netcup_scp_server" "noosphere" {
  server_id = var.server_id
  nickname  = var.nickname

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.netcup_scp_server.existing.name == var.expected_server_name
      error_message = "The Netcup server identity differs from the explicitly selected Noosphere server."
    }
    precondition {
      condition     = contains([for ip in data.netcup_scp_server.existing.ipv4addresses : ip.ip], var.expected_ipv4)
      error_message = "The selected server does not own the expected IPv4 address."
    }
    precondition {
      condition     = upper(data.netcup_scp_server.existing.architecture) == "AMD64"
      error_message = "Noosphere deployment requires an AMD64 server."
    }
  }
}

output "server_ipv4" {
  value = var.expected_ipv4
}

output "application_url" {
  value = "https://${var.application_hostname}"
}

output "mcp_url" {
  value = "https://${var.application_hostname}/mcp"
}
