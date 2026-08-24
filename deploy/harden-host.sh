#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then echo "Run this script as root" >&2; exit 1; fi
: "${SSH_ALLOWED_CIDR:?Set SSH_ALLOWED_CIDR to the administrator IP or VPN CIDR}"
SSH_PORT="${SSH_PORT:-22}"
external_interface="${EXTERNAL_INTERFACE:-$(ip route show default | awk 'NR==1 {print $5}')}"
if [[ -z "$external_interface" ]]; then echo "Unable to detect the public network interface" >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl restic ufw iptables-persistent
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository before hardening the host" >&2
  exit 1
fi
systemctl enable --now docker

ufw default deny incoming
ufw default allow outgoing
ufw allow from "$SSH_ALLOWED_CIDR" to any port "$SSH_PORT" proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -C DOCKER-USER -i "$external_interface" -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 2 -i "$external_interface" -p tcp --dport 80 -j ACCEPT
iptables -C DOCKER-USER -i "$external_interface" -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 3 -i "$external_interface" -p tcp --dport 443 -j ACCEPT
iptables -C DOCKER-USER -i "$external_interface" -j DROP 2>/dev/null || iptables -A DOCKER-USER -i "$external_interface" -j DROP
netfilter-persistent save

echo "Host hardened. Only restricted SSH, HTTP and HTTPS are accepted from the public interface."
