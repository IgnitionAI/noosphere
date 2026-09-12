#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then echo "Run this script as root" >&2; exit 1; fi
: "${SSH_ALLOWED_CIDR:?Set SSH_ALLOWED_CIDR to the administrator IP or VPN CIDR}"
SSH_PORT="${SSH_PORT:-22}"
external_interface="${EXTERNAL_INTERFACE:-$(ip route show default | awk 'NR==1 {print $5}')}"
if [[ -z "$external_interface" ]]; then echo "Unable to detect the public network interface" >&2; exit 1; fi

# Validate the operator address before installing packages or changing rules.
ssh_family="$(python3 - "$SSH_ALLOWED_CIDR" <<'PYIP'
import ipaddress
import sys
print(ipaddress.ip_network(sys.argv[1], strict=False).version)
PYIP
)"
if command -v ufw >/dev/null 2>&1; then
  echo "This host already has UFW installed. Migrate its rules before using the iptables-persistent deployment profile." >&2
  exit 1
fi
# Preserve unknown firewall policy by refusing to modify it. Even an earlier broad
# SSH ACCEPT would bypass our CIDR rule and the final default DROP policy.
for binary in iptables ip6tables; do
  rules="$("$binary" -S INPUT)"
  INPUT_RULES="$rules" python3 - "$binary" "$SSH_ALLOWED_CIDR" "$SSH_PORT" <<'PYRULES'
import ipaddress
import os
import shlex
import sys

binary, cidr, port = sys.argv[1:]
network = ipaddress.ip_network(cidr, strict=False)
family = 4 if binary == "iptables" else 6
allowed = {
    ("-i", "lo", "-j", "ACCEPT"),
    ("-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"),
    ("-p", "tcp", "-m", "multiport", "--dports", "80,443", "-j", "ACCEPT"),
    ("-p", "icmp" if family == 4 else "ipv6-icmp", "-j", "ACCEPT"),
}
if network.version == family:
    allowed.add(("-s", str(network), "-p", "tcp", "--dport", port, "-j", "ACCEPT"))
for line in os.environ["INPUT_RULES"].splitlines():
    parts = shlex.split(line)
    if not parts or parts in (["-P", "INPUT", "ACCEPT"], ["-P", "INPUT", "DROP"]):
        continue
    rule = parts[2:]
    # iptables-save adds the TCP match module and canonicalizes host prefixes.
    if "--dport" in rule and "-m" in rule:
        pos = rule.index("-m")
        if rule[pos:pos + 2] == ["-m", "tcp"]:
            del rule[pos:pos + 2]
    if "--ctstate" in rule:
        pos = rule.index("--ctstate") + 1
        rule[pos] = ",".join(sorted(rule[pos].split(","), reverse=True))
    if "-s" in rule:
        pos = rule.index("-s") + 1
        rule[pos] = str(ipaddress.ip_network(rule[pos], strict=False))
    if parts[:2] != ["-A", "INPUT"] or tuple(rule) not in allowed:
        sys.exit("Unmanaged INPUT rule detected; review existing firewall policy before hardening. No changes applied.")
PYRULES
done
export DEBIAN_FRONTEND=noninteractive
apt-get update
# Debian 13 makes UFW and iptables-persistent mutually exclusive.
apt-get install -y ca-certificates curl restic iptables-persistent
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Install Docker Engine and the Compose plugin from Docker's official repository before hardening the host" >&2
  exit 1
fi
systemctl enable --now docker

ensure_rule() {
  local binary="$1"; shift
  "$binary" -C INPUT "$@" 2>/dev/null || "$binary" -A INPUT "$@"
}
for binary in iptables ip6tables; do
  ensure_rule "$binary" -i lo -j ACCEPT
  ensure_rule "$binary" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  ensure_rule "$binary" -p tcp -m multiport --dports 80,443 -j ACCEPT
done
ensure_rule iptables -p icmp -j ACCEPT
ensure_rule ip6tables -p ipv6-icmp -j ACCEPT
if [[ "$ssh_family" == 4 ]]; then
  ensure_rule iptables -s "$SSH_ALLOWED_CIDR" -p tcp --dport "$SSH_PORT" -j ACCEPT
else
  ensure_rule ip6tables -s "$SSH_ALLOWED_CIDR" -p tcp --dport "$SSH_PORT" -j ACCEPT
fi
# Only set the default policy after the established-session and SSH rules exist.
iptables -P INPUT DROP
ip6tables -P INPUT DROP

iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -C DOCKER-USER -i "$external_interface" -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 2 -i "$external_interface" -p tcp --dport 80 -j ACCEPT
iptables -C DOCKER-USER -i "$external_interface" -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 3 -i "$external_interface" -p tcp --dport 443 -j ACCEPT
iptables -C DOCKER-USER -i "$external_interface" -j DROP 2>/dev/null || iptables -I DOCKER-USER 4 -i "$external_interface" -j DROP
netfilter-persistent save
systemctl enable netfilter-persistent

echo "Host hardened. Only restricted SSH, HTTP and HTTPS are accepted from the public interface."
