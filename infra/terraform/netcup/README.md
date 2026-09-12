# Netcup infrastructure and Docker delivery

Terraform adopts an **already purchased** Netcup server. The community provider
`rixlhq/netcup` is pinned to 1.2.1 with checksums for Linux AMD64 and macOS ARM64.
It is not an official Netcup provider. Its SCP API cannot purchase or delete
servers. This module changes only the server nickname; it checks the exact
server name, IPv4 and AMD64 architecture before that mutation, with
`prevent_destroy` on the resource. OS, disks, boot order, interfaces, credentials
and running services remain outside its lifecycle.

Docker Compose and `deploy/release.sh` own application services, networks and
persistent volumes. Terraform does not run application migrations or SSH
provisioners. A routine code update does not require `terraform apply` and cannot
replace the VPS. DNS remains with the domain's actual authoritative provider;
this module does not assume a domain is hosted at Netcup or rewrite its zone.

## Adopt once

Use Terraform 1.16.2 (CI version). An existing SCP token is required through
`NETCUP_SCP_ACCESS_TOKEN` or `NETCUP_SCP_REFRESH_TOKEN`. Obtain it through the
Netcup SCP API authorization flow; never paste a token in Git, a command argument,
a `.tfvars` file or a saved plan. Browser CCP login is not an API token.

```bash
cd infra/terraform/netcup
umask 077
cp terraform.tfvars.example terraform.tfvars
# Fill identifiers from the selected server's panel and the chosen public domain.
# Load your SCP token into the environment using your private secret manager.
terraform init -lockfile=readonly
terraform import netcup_scp_server.noosphere YOUR_SERVER_ID
terraform plan -out=noosphere.tfplan
terraform apply noosphere.tfplan
```

Review the plan: only the intended nickname should change. If any unrelated
server or configuration change appears, do not apply. Import reads the selected
server into state; it does not install/reinstall the operating system.

State, backup state and saved plans contain infrastructure metadata and must be
private. Their filenames and operator inputs are ignored by Git. Keep an
encrypted backup of the state outside the laptop, or configure your organization's
encrypted remote backend with locking before multiple operators use it. The
state is not an application backup. Do not run concurrent local applies. Losing
state can be repaired with import; it must not cause recreation/reinstallation.
Never remove `prevent_destroy` to bypass an unexpected plan.

## Host and application

Follow [the VPS runbook](../../../docs/runbooks/vps-production.md) for the one-time
OS audit, official Docker installation, restricted SSH, Caddy ingress, private
configuration and encrypted off-site Restic setup. This requires working SSH;
a logged-in Netcup panel alone does not grant OS access. No server password is
reset by this module.

Then use [versioned updates](../../../docs/runbooks/versioned-updates.md).

Provider reference:
https://github.com/rixlhq/terraform-provider-netcup/tree/v1.2.1
