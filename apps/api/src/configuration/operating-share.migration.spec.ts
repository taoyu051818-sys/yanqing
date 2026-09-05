import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260902190000_operating_share_parameter/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('operating share parameter migration', () => {
  it('seeds 15 percent and enforces integer basis-point bounds at the database boundary', () => {
    expect(migration).toContain('finance.operating_share_rate_bps');
    expect(migration).toContain("'1500'::jsonb");
    expect(migration).toContain('BETWEEN 0 AND 10000');
    expect(migration).toContain('trunc');
  });
});
