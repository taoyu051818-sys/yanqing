import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  auditMigrations,
  command,
  localDatabase,
  readManifest,
  sha256,
} from './common.mjs';

// Source is read only. Restoring/dropping is restricted to a name generated here.
process.umask(0o077);
const parent = process.env.OPS_BACKUP_ROOT;
assert(
  parent && isAbsolute(parent),
  'OPS_BACKUP_ROOT must be an absolute backup directory',
);
const id =
  new Date().toISOString().replace(/[-:.]/g, '') +
  '-' +
  randomBytes(4).toString('hex');
const directory = join(parent, id);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const { url, env, database } = localDatabase();
const isolated =
  'yanqing_restore_ops_' + randomBytes(8).toString('hex') + '_test';
assert.notEqual(database, isolated);
let created = false;
let phase = 'migration-audit';
try {
  const manifest = readManifest();
  await auditMigrations(url.href, manifest);
  const dump = join(directory, 'database.dump');
  phase = 'database-dump';
  command(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', '--file', dump],
    env,
  );
  chmodSync(dump, 0o600);
  const digest = sha256(readFileSync(dump));
  writeFileSync(
    join(directory, 'database.sha256'),
    digest + '  database.dump\n',
  );
  phase = 'create-isolated-database';
  command(
    'sudo',
    ['-n', '-u', 'postgres', 'createdb', '--owner', env.PGUSER, isolated],
    env,
  );
  created = true;
  phase = 'restore-isolated-database';
  command(
    'pg_restore',
    ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', isolated, dump],
    { ...env, PGDATABASE: isolated },
  );
  const restored = new URL(url);
  restored.pathname = '/' + isolated;
  phase = 'restored-migration-audit';
  const migrations = await auditMigrations(restored.href, manifest);
  if (process.argv.includes('--rehearse')) {
    phase = 'compiled-application-rehearsal';
    process.stdout.write(
      command(
        process.execPath,
        ['apps/api/scripts/ops/rehearse.mjs'],
        {
          ...process.env,
          RELEASE_TEST_DATABASE: isolated,
          RELEASE_BACKUP: directory,
          RELEASE_COMMIT: manifest.commit,
        },
        180000,
      ),
    );
  }
  phase = 'remove-isolated-database';
  command('sudo', ['-n', '-u', 'postgres', 'dropdb', '--force', isolated], env);
  created = false;
  phase = 'write-verification-receipt';
  const receipt = {
    status: 'verified',
    directory,
    commit: manifest.commit,
    database,
    dumpSha256: digest,
    migrations,
    restored: true,
    rehearsal: process.argv.includes('--rehearse'),
    completedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(directory, 'verified.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  // Failed backups never overwrite the last successful evidence.
  const latest = join(parent, '.latest-' + id + '.json');
  writeFileSync(latest, JSON.stringify(receipt, null, 2) + '\n');
  renameSync(latest, join(parent, 'latest-verified.json'));
  console.log(JSON.stringify(receipt));
} catch {
  console.error(
    `BACKUP_FAILED phase=${phase}: previous verified backup remains available.`,
  );
  process.exitCode = 1;
} finally {
  if (created)
    command(
      'sudo',
      ['-n', '-u', 'postgres', 'dropdb', '--force', isolated],
      env,
    );
}
