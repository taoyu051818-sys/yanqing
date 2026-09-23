#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
base=/home/ubuntu/yanqing-domain
node=/opt/node-v24.19.0/bin/node
archive=${1:?}; digest=${2:?}; commit=${3:?}; inbox=${4:?}
[[ "$commit" =~ ^[a-f0-9]{40}$ && "$digest" =~ ^[a-f0-9]{64}$ ]]
exec 9>"$base/ops/operation.lock"
flock -n 9
candidate="$base/releases/api-${commit:0:12}"
receipt="$base/ops/receipts/$commit"
previous=$(systemctl show yanqing-api -p WorkingDirectory --value)
[[ "$previous" == "$base/releases/api-"* ]]
systemctl is-active --quiet yanqing-api
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$digest"
test ! -e "$candidate"; test ! -e "$receipt"
mkdir -p "$candidate" "$receipt"
tar -xzf "$archive" --no-same-owner -C "$candidate"
(cd "$candidate" && sha256sum -c FILES.sha256 > "$receipt/files-verified.log")
test "$("$node" -p "JSON.parse(require('fs').readFileSync(process.argv[1])).commit" "$candidate/RELEASE.json")" = "$commit"
export PATH=/opt/node-v24.19.0/bin:$PATH
(cd "$candidate" && pnpm --filter api... install --frozen-lockfile > "$receipt/dependencies.log" 2>&1)
(cd "$candidate" && sha256sum -c FILES.sha256 > "$receipt/files-after-install.log")
printf '%s\n' "$previous" > "$receipt/previous-release"
cp /etc/systemd/system/yanqing-api.service.d/90-release.conf "$receipt/90-release.conf"
sha256sum "$base/.env.api" "$base/.env.boss" > "$receipt/environment.sha256"
cp "$inbox/prepare-migration.mjs" "$receipt/prepare-migration.mjs"
cp "$inbox/prepare-migration.sh" "$receipt/prepare-migration.sh"
"$node" --env-file="$base/.env.api" "$inbox/prepare-migration.mjs" "$candidate" "$previous" "$receipt" "$base"
echo "PREPARED commit=$commit receipt=$receipt"
