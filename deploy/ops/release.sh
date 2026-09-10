#!/usr/bin/env bash
# Same-schema API releases only. Database restore is never a rollback action.
set -Eeuo pipefail
umask 077
base=${OPS_BASE:-/home/ubuntu/yanqing-domain}
node=${OPS_NODE:-/opt/node-v24.19.0/bin/node}
override=${OPS_SYSTEMD_OVERRIDE:-/etc/systemd/system/yanqing-api.service.d/90-release.conf}
[[ "$base" = /* && "$override" = /* && "$node" = /* ]]
mkdir -p "$base/ops/receipts"
exec 9>"$base/ops/operation.lock"
flock -n 9 || { echo 'Another release/backup is running'; exit 1; }
mode=${1:?Usage: release.sh prepare archive sha256 commit | activate commit | rollback commit}
commit=${4:-${2:-}}
[[ "$commit" =~ ^[a-f0-9]{40}$ ]]
candidate="$base/releases/api-${commit:0:12}"
receipt="$base/ops/receipts/$commit"
current(){ systemctl show yanqing-api -p WorkingDirectory --value; }
check_candidate(){
  "$node" --env-file="$base/.env.api" "$candidate/apps/api/scripts/ops/check-release.mjs" "$@"
}
wait_ready(){
  local deadline=$((SECONDS + 45))
  for i in {1..30}; do
    if check_candidate >"$receipt/ready.log" 2>&1; then return 0; fi
    (( SECONDS < deadline )) || return 1
    sleep 1
  done
  return 1
}
restore_previous(){
  sudo install -m 644 "$receipt/90-release.conf" "$override" || return 1
  sudo systemctl daemon-reload || return 1
  sudo systemctl restart yanqing-api || return 1
  test "$(current)" = "$(cat "$receipt/previous-release")" || return 1
  # Older releases do not expose readiness/revision. Audit the unchanged database
  # separately and check the restored process. Never rewind business data.
  check_candidate --database-only || return 1
  for i in {1..30}; do
    if curl -fsS --max-time 3 http://127.0.0.1:33200/api/v1/health >/dev/null; then
      systemctl is-active --quiet yanqing-api || return 1
      date -u +%FT%TZ > "$receipt/rolled-back-at" || return 1
      echo 'ROLLBACK_OK: previous application restored; database untouched'
      return 0
    fi
    sleep 1
  done
  return 1
}
case "$mode" in
prepare)
  archive=${2:?}; digest=${3:?}
  [[ "$archive" = /* && "$digest" =~ ^[a-f0-9]{64}$ ]]
  test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$digest"
  test ! -e "$candidate"; test ! -e "$receipt"
  previous=$(current)
  [[ "$previous" == "$base/releases/api-"* ]]
  systemctl is-active --quiet yanqing-api
  mkdir -p "$candidate" "$receipt"
  tar -xzf "$archive" --no-same-owner -C "$candidate"
  (cd "$candidate" && sha256sum -c FILES.sha256 > "$receipt/files-verified.log")
  test "$("$node" -p "JSON.parse(require('fs').readFileSync(process.argv[1])).commit" "$candidate/RELEASE.json")" = "$commit"
  cp -a "$previous/node_modules" "$candidate/node_modules"
  cp -a "$previous/apps/api/node_modules" "$candidate/apps/api/node_modules"
  printf '%s\n' "$previous" > "$receipt/previous-release"
  cp "$override" "$receipt/90-release.conf"
  sha256sum "$base/.env.api" "$base/.env.boss" > "$receipt/environment.sha256"
  OPS_PREVIOUS_RELEASE="$previous" check_candidate --database-only > "$receipt/preflight.log"
  OPS_BACKUP_ROOT="$base/backups/verified" "$node" --env-file="$base/.env.api" "$candidate/apps/api/scripts/ops/backup.mjs" --rehearse | tee "$receipt/backup.log"
  cp "$base/backups/verified/latest-verified.json" "$receipt/backup.json"
  touch "$receipt/rehearsed"
  echo "PREPARED commit=$commit receipt=$receipt"
  ;;
activate)
  test -f "$receipt/rehearsed"
  test ! -f "$receipt/activated-at"
  test "$(current)" = "$(cat "$receipt/previous-release")"
  cmp "$override" "$receipt/90-release.conf"
  sha256sum -c "$receipt/environment.sha256"
  # Bind activation to the successful, still-present backup and exact candidate.
  "$node" - "$receipt/backup.json" "$commit" <<'NODE'
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const receipt=JSON.parse(fs.readFileSync(process.argv[2]));
assert.equal(receipt.commit,process.argv[3]);assert(receipt.restored&&receipt.rehearsal);
const age=Date.now()-Date.parse(receipt.completedAt);assert(age>=0&&age<24*60*60*1000);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(receipt.directory+'/database.dump')).digest('hex'),receipt.dumpSha256);
NODE
  (cd "$candidate" && sha256sum -c FILES.sha256 > "$receipt/files-activation.log")
  check_candidate --database-only
  sed -E '/^WorkingDirectory=/d; /^Environment=RELEASE_COMMIT=/d' "$receipt/90-release.conf" > "$receipt/candidate.conf"
  printf 'WorkingDirectory=%s\nEnvironment=RELEASE_COMMIT=%s\n' "$candidate" "$commit" >> "$receipt/candidate.conf"
  rollback_on_error(){
    local status=${1:-$?}
    trap - ERR INT TERM
    set +e
    echo 'ACTIVATION_FAILED: restoring previous application'
    (set -e; restore_previous) || echo 'ROLLBACK_FAILED: operator must inspect yanqing-api immediately' >&2
    exit "$status"
  }
  trap rollback_on_error ERR
  trap 'rollback_on_error 130' INT
  trap 'rollback_on_error 143' TERM
  sudo install -m 644 "$receipt/candidate.conf" "$override"
  sudo systemctl daemon-reload
  sudo systemctl restart yanqing-api
  wait_ready
  OPS_API_BASE=https://api.yutechhn.cn/api/v1 check_candidate | tee "$receipt/public-check.log"
  test "$(current)" = "$candidate"
  systemctl is-active --quiet yanqing-api
  sha256sum -c "$receipt/environment.sha256"
  date -u +%FT%TZ > "$receipt/activated-at"
  trap - ERR INT TERM
  echo "ACTIVATED commit=$commit"
  ;;
rollback)
  test -f "$receipt/activated-at"
  test "$(current)" = "$candidate"
  cmp "$override" "$receipt/candidate.conf"
  restore_previous
  ;;
*) echo 'Unknown release action'; exit 1 ;;
esac
