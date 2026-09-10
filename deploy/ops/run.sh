#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
base=/home/ubuntu/yanqing-domain
release=$(systemctl show yanqing-api -p WorkingDirectory --value)
[[ "$release" == "$base/releases/api-"* ]]
tooling=$(cat "$base/ops/tooling-release")
[[ "$tooling" == "$base/releases/api-"* ]]
export OPS_ACTIVE_RELEASE="$release"
case "${1:-}" in
backup)
  exec 9>"$base/ops/operation.lock"
  flock -n 9 || { echo 'Release/backup already running'; exit 1; }
  export OPS_BACKUP_ROOT="$base/backups/verified"
  exec /opt/node-v24.19.0/bin/node --env-file="$base/.env.api" "$tooling/apps/api/scripts/ops/backup.mjs"
  ;;
monitor)
  exec /opt/node-v24.19.0/bin/node "$tooling/apps/api/scripts/ops/monitor.mjs"
  ;;
*) echo 'Expected backup or monitor'; exit 1 ;;
esac
