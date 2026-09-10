import {
  mkdirSync,
  readFileSync,
  renameSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { checkReadiness, readManifest } from './common.mjs';

process.umask(0o077);
const base = '/home/ubuntu/yanqing-domain';
const reasons = [];
try {
  const { commit } = readManifest();
  await checkReadiness('http://127.0.0.1:33200/api/v1', commit);
  await checkReadiness('https://api.yutechhn.cn/api/v1', commit);
} catch {
  reasons.push('api_or_database_or_public_https_unavailable');
}
try {
  const backup = JSON.parse(
    readFileSync(base + '/backups/verified/latest-verified.json', 'utf8'),
  );
  const age = Date.now() - Date.parse(backup.completedAt);
  if (
    !backup.restored ||
    backup.status !== 'verified' ||
    !Number.isFinite(age) ||
    age < -300000 ||
    age > 32 * 3600000 ||
    statSync(backup.directory + '/database.dump').size === 0
  ) {
    reasons.push('verified_backup_missing_or_older_than_32h');
  }
} catch {
  reasons.push('verified_backup_missing_or_older_than_32h');
}
try {
  const disk = statfsSync(base);
  if (disk.bavail * disk.bsize < 1024 ** 3 || disk.bavail / disk.blocks < 0.1)
    reasons.push('disk_space_below_1GiB_or_10_percent');
} catch {
  reasons.push('disk_check_failed');
}
const result = {
  status: reasons.length ? 'attention' : 'ok',
  reasons,
  checkedAt: new Date().toISOString(),
};
const file = base + '/ops/health.json';
mkdirSync(base + '/ops', { recursive: true, mode: 0o700 });
let previous;
try {
  previous = JSON.parse(readFileSync(file, 'utf8'));
} catch {}
writeFileSync(file + '.tmp', JSON.stringify(result, null, 2) + '\n');
renameSync(file + '.tmp', file);
if (
  previous?.status !== result.status ||
  JSON.stringify(previous?.reasons) !== JSON.stringify(reasons)
) {
  console.log(
    JSON.stringify({
      event: reasons.length ? 'ops_attention' : 'ops_recovered',
      ...result,
    }),
  );
}
process.exitCode = reasons.length ? 1 : 0;
