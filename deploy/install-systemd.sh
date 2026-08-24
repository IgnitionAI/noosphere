#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then echo "Run this script as root" >&2; exit 1; fi
APP_DIR="${APP_DIR:-/srv/noosphere}"
if [[ ! -f "$APP_DIR/.env" ]]; then echo "Missing $APP_DIR/.env" >&2; exit 1; fi
set -a
# shellcheck disable=SC1090
source "$APP_DIR/.env"
set +a

for unit in noosphere-backup.service noosphere-backup.timer noosphere-monitor.service noosphere-monitor.timer noosphere-restore-drill.service noosphere-restore-drill.timer; do
  sed "s|__APP_DIR__|$APP_DIR|g" "$APP_DIR/deploy/systemd/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now noosphere-backup.timer noosphere-monitor.timer
if [[ "${DEPLOY_PROFILE:-production}" == "production" ]]; then
  systemctl enable --now noosphere-restore-drill.timer
  echo "Noosphere backup, monitoring and restore-drill timers installed"
else
  systemctl disable --now noosphere-restore-drill.timer >/dev/null 2>&1 || true
  echo "Noosphere quickstart backup and monitoring timers installed; monthly restore drills remain optional"
fi
