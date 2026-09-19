import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  cpSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const url = process.env.HISTORY_MIGRATION_TEST_URL;
// Needs a disposable pre-migration database. This suite deliberately exercises
// the exact migration SQL against legacy rows, not a TypeScript reimplementation.
describe.skipIf(!url)('availability history legacy migration', () => {
  let client: pg.Client;
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test'))
      throw new Error('Local disposable database only');
    client = new pg.Client({ connectionString: url });
    await client.connect();
    if (
      !(await client.query(`SELECT to_regclass('public."Court"') AS table`))
        .rows[0].table
    ) {
      const root = new URL('../prisma/migrations/', import.meta.url);
      const temporary = mkdtempSync(join(tmpdir(), 'yanqing-history-'));
      try {
        const migrations = join(temporary, 'migrations');
        for (const name of readdirSync(root).filter(
          (name) =>
            name === 'migration_lock.toml' ||
            (/^\d+_/.test(name) &&
              name < '20260919010000_availability_history'),
        )) {
          cpSync(new URL(name, root), join(migrations, name), {
            recursive: true,
          });
        }
        const config = join(temporary, 'prisma.config.mjs');
        writeFileSync(
          config,
          `export default ${JSON.stringify({ schema: fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), migrations: { path: migrations }, datasource: { url } })}`,
        );
        const result = spawnSync(
          'pnpm',
          ['exec', 'prisma', 'migrate', 'deploy', '--config', config],
          {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            encoding: 'utf8',
          },
        );
        if (result.status !== 0)
          throw new Error('Legacy schema setup failed: ' + result.stderr);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
    if (
      (
        await client.query(
          `SELECT to_regclass('public."CourtAvailability"') AS table`,
        )
      ).rows[0].table
    )
      throw new Error('Use a fresh pre-migration fixture database');
    await client.query(
      `INSERT INTO "Court"(id,code,name,zone,enabled,"sortOrder","createdAt","updatedAt","deletedAt") VALUES ('migration-court','MIGRATION','迁移场地','EAST',false,1,'2026-01-01','2026-09-18','2026-09-18')`,
    );
    await client.query(`INSERT INTO "AuditLog"(id,action,"objectType","objectId","oldValue","newValue","createdAt") VALUES
      ('migration-disable','COURT_UPDATED','Court','migration-court','{"enabled":true}','{"enabled":false,"updatedAt":"2026-09-16T00:00:00.000Z"}','2026-09-16'),
      ('migration-enable','COURT_UPDATED','Court','migration-court','{"enabled":false}','{"enabled":true,"updatedAt":"2026-09-17T00:00:00.000Z"}','2026-09-17'),
      ('migration-delete','COURT_DELETED','Court','migration-court','{"enabled":true}','{"enabled":false,"deletedAt":"2026-09-18T00:00:00.000Z"}','2026-09-18'),
      ('migration-malformed','COURT_UPDATED','Court','migration-court','{"enabled":"oops"}','{}','2026-09-19')`);
    // Clear only this disposable database's parameter history, isolating the
    // known legacy venue-hours timeline from cloned test fixtures.
    await client.query(
      `DELETE FROM "SystemParameter" WHERE key='venue.public-settings'`,
    );
    await client.query(
      `DELETE FROM "AuditLog" WHERE action='VENUE_SETTINGS_UPDATED'`,
    );
    await client.query(
      `INSERT INTO "TimeSlot"(id,code,label,"startMinutes","endMinutes",period,enabled,"sortOrder","createdAt","updatedAt") VALUES ('migration-slot','MIG_H08','08–09',480,540,'EARLY',false,1,'2026-01-01','2026-09-17')`,
    );
    await client.query(
      `INSERT INTO "SystemParameter"(id,key,value,type,description,"effectiveFrom") VALUES ('migration-config','venue.public-settings','{"opensAtHour":9,"closesAtHour":22}','JSON','测试','2026-09-17')`,
    );
    await client.query(
      `INSERT INTO "AuditLog"(id,action,"objectType","oldValue","newValue","createdAt") VALUES ('migration-hours','VENUE_SETTINGS_UPDATED','SystemParameter','{"opensAtHour":8,"closesAtHour":22}','{"opensAtHour":9,"closesAtHour":22}','2026-09-17')`,
    );
    await client.query(
      readFileSync(
        new URL(
          '../prisma/migrations/20260919010000_availability_history/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  });
  afterAll(async () => {
    await client?.end();
  });
  it('imports court disable, recovery and deletion exactly once with contiguous intervals', async () => {
    const rows = (
      await client.query(
        `SELECT enabled,"validFrom"::text AS "validFrom","validTo"::text AS "validTo" FROM "CourtAvailability" WHERE "courtId"='migration-court' ORDER BY "validFrom"`,
      )
    ).rows;
    expect(rows.map((r) => r.enabled)).toEqual([true, false, true, false]);
    for (let i = 0; i < rows.length - 1; i++)
      expect(rows[i].validTo).toEqual(rows[i + 1].validFrom);
    expect(rows.at(-1).validTo).toBeNull();
  });
  it('imports the pre-change hours instead of projecting current disabled state into the past', async () => {
    const rows = (
      await client.query(
        `SELECT enabled,"validFrom"::text AS "validFrom","validTo"::text AS "validTo" FROM "TimeSlotAvailability" WHERE "timeSlotId"='migration-slot' ORDER BY "validFrom"`,
      )
    ).rows;
    expect(rows.map((r) => r.enabled)).toEqual([true, false]);
    expect(rows[0].validTo).toEqual('2026-09-17 00:00:00');
  });
  it('records subsequent SQL writes atomically and keeps business history after audit deletion', async () => {
    await client.query('BEGIN');
    await client.query(
      `UPDATE "TimeSlot" SET enabled=true WHERE id='migration-slot'`,
    );
    expect(
      (
        await client.query(
          `SELECT enabled FROM "TimeSlotAvailability" WHERE "timeSlotId"='migration-slot' AND "validTo" IS NULL`,
        )
      ).rows[0].enabled,
    ).toBe(true);
    await client.query('ROLLBACK');
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM "TimeSlotAvailability" WHERE "timeSlotId"='migration-slot'`,
        )
      ).rows[0].n,
    ).toBe(2);
    await client.query(
      `DELETE FROM "AuditLog" WHERE "objectId"='migration-court'`,
    );
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM "CourtAvailability" WHERE "courtId"='migration-court'`,
        )
      ).rows[0].n,
    ).toBe(4);
  });
});
