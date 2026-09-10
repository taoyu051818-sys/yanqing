import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
export const readManifest = () =>
  JSON.parse(
    readFileSync(
      join(process.env.OPS_ACTIVE_RELEASE || root, 'RELEASE.json'),
      'utf8',
    ),
  );

// The API may reuse its installed dependencies when unrelated workspace importers
// change. All package resolutions and the API/shared importer blocks must match.
export function apiDependencyFingerprint(lock) {
  assert(lock.startsWith('lockfileVersion:'), 'Unsupported lockfile');
  const importersStart = lock.indexOf('\nimporters:\n');
  const packagesStart = lock.indexOf('\npackages:\n');
  assert(
    importersStart > 0 && packagesStart > importersStart,
    'Unsupported lockfile layout',
  );
  const importers = lock.slice(importersStart, packagesStart);
  const blocks = ['apps/api', 'packages/shared'].map((name) => {
    const match = importers.match(
      new RegExp(`\n  ${name.replace('/', '\\/')}:\n[\\s\\S]*?(?=\n  \\S|$)`),
    );
    assert(match, `Missing importer ${name}`);
    return match[0].trimEnd();
  });
  return sha256(
    [lock.slice(0, importersStart), ...blocks, lock.slice(packagesStart)].join(
      '\n',
    ),
  );
}

export function localDatabase() {
  let url;
  try { url = new URL(process.env.DATABASE_URL); }
  catch { throw new Error('Invalid database configuration'); }
  assert(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost'].includes(url.hostname),
    'Expected local PostgreSQL',
  );
  const database = decodeURIComponent(url.pathname.slice(1));
  assert(/^[a-zA-Z0-9_]+$/.test(database), 'Invalid database name');
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: '5',
  };
  return { url, env, database };
}

export function command(bin, args, env = process.env, timeout = 180000) {
  const result = spawnSync(bin, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Provider stderr may contain credentials or customer data. Keep it out of
  // terminal/CI logs; failed commands must still stop the release.
  if (result.error || result.status !== 0)
    throw new Error(`${bin} failed (exit ${result.status ?? 'unavailable'})`);
  return result.stdout;
}

export async function auditMigrations(
  connectionString,
  manifest = readManifest(),
) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    const active = rows.filter((row) => row.rolled_back_at === null);
    assert(
      active.every((row) => row.finished_at !== null),
      'Unfinished migration',
    );
    assert.equal(
      active.length,
      Object.keys(manifest.migrations).length,
      'Migration count mismatch',
    );
    for (const row of active)
      assert.equal(
        row.checksum,
        manifest.migrations[row.migration_name],
        'Migration checksum mismatch',
      );
    await client.query('COMMIT');
    return active.length;
  } finally {
    await client.end();
  }
}

export async function checkReadiness(base, revision) {
  assert(/^[a-f0-9]{40}$/.test(revision), 'Expected full Git revision');
  const url = new URL(base);
  assert(
    !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(url.hostname))),
    'Expected HTTPS or loopback API',
  );
  const response = await fetch(base.replace(/\/$/, '') + '/health/ready', {
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  assert.equal(response.status, 200, 'API not ready');
  const payload = await response.json();
  assert.equal(payload.code, 0);
  assert.equal(payload.data?.service, 'yanqing-api');
  assert.equal(
    payload.data?.revision,
    revision,
    'Wrong release is serving traffic',
  );
  assert.equal(payload.data?.checks?.database, 'ok', 'Database not ready');
  return payload.data;
}
