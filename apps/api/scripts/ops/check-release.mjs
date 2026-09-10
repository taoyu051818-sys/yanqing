import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  apiDependencyFingerprint,
  auditMigrations,
  checkReadiness,
  localDatabase,
  readManifest,
  root,
  sha256,
} from './common.mjs';

try {
  const meta = readManifest();
  assert(/^[a-f0-9]{40}$/.test(meta.commit), 'Invalid commit');
  assert.equal(
    sha256(readFileSync(root + 'apps/api/prisma/schema.prisma')),
    meta.schemaSha256,
  );
  assert.equal(sha256(readFileSync(root + 'pnpm-lock.yaml')), meta.lockSha256);
  const previous = process.env.OPS_PREVIOUS_RELEASE;
  if (previous) {
    assert(
      resolve(previous) !== resolve(root),
      'Candidate must be a separate release',
    );
    for (const file of [
      'apps/api/prisma/schema.prisma',
      'apps/api/package.json',
      'packages/shared/package.json',
    ]) {
      assert.equal(
        sha256(readFileSync(root + file)),
        sha256(readFileSync(previous + '/' + file)),
        `No-migration release requires unchanged ${file}`,
      );
    }
    assert.equal(
      apiDependencyFingerprint(readFileSync(root + 'pnpm-lock.yaml', 'utf8')),
      apiDependencyFingerprint(
        readFileSync(previous + '/pnpm-lock.yaml', 'utf8'),
      ),
      'API dependency installation must be updated separately',
    );
  }
  const { url } = localDatabase();
  const migrations = await auditMigrations(url.href, meta);
  if (!process.argv.includes('--database-only')) {
    await checkReadiness(
      process.env.OPS_API_BASE || 'http://127.0.0.1:33200/api/v1',
      meta.commit,
    );
  }
  console.log(
    JSON.stringify({ verified: true, commit: meta.commit, migrations }),
  );
} catch {
  console.error(
    'RELEASE_CHECK_FAILED: check manifest, schema/dependencies, migration checksums, readiness and serving revision.',
  );
  process.exitCode = 1;
}
