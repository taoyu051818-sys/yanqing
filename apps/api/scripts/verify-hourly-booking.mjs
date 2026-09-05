// Destructive fixtures are restricted to a restored, disposable database.
// Never run this against the operating database or the real payment provider.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';

const connection = new URL(process.env.DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
connection.pathname = '/yanqing_hourly_test_20260905';
const client = new pg.Client({ connectionString: connection.href });
const checks = [];
let server;
const check = name => { checks.push(name); console.log('PASS ' + name); };
const migration = await readFile(new URL('../prisma/migrations/20260905150000_hourly_venue_slots/migration.sql', import.meta.url), 'utf8');
const base = 'http://127.0.0.1:33201/api/v1';
const jwtSecret = 'isolated-hourly-booking-test-20260905';
const env = { ...process.env, DATABASE_URL: connection.href, NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', HOST: '127.0.0.1', PORT: '33201', JWT_SECRET: jwtSecret };
for (const key of Object.keys(env)) if (key.startsWith('WECHAT_')) delete env[key];

await client.connect();
try {
  const business = async () => {
    const snapshot = {};
    for (const table of ['Order', 'OrderItem', 'Payment', 'Refund', 'CourtBooking', 'Account', 'AccountTransaction']) {
      const result = await client.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]')) AS hash FROM "${table}" t`);
      snapshot[table] = result.rows[0].hash;
    }
    return snapshot;
  };
  const before = await business();
  // A global tariff has ambiguous legacy units: conversion must fail atomically.
  await client.query(`INSERT INTO "PriceRule" (id,code,version,name,"priceCents","effectiveFrom",enabled,"creationIdempotencyKey","creationCommandHash","createdById","updatedAt") SELECT 'hourly-guard-fixture','HOURLY_GUARD',1,'guard',1,"effectiveFrom",true,'hourly-guard-fixture',repeat('a',64),"createdById",now() FROM "PriceRule" LIMIT 1`);
  await assert.rejects(client.query(migration), /global tariffs/);
  await client.query('ROLLBACK');
  assert.equal(Number((await client.query(`SELECT count(*) FROM "TimeSlot" WHERE enabled`)).rows[0].count), 8);
  await client.query(`DELETE FROM "PriceRule" WHERE id = 'hourly-guard-fixture'`);
  check('ambiguous global tariff aborts without partial migration');
  await client.query(migration);
  assert.deepEqual(await business(), before);
  check('migration preserves every historical order, payment, refund, booking and account row');
  const slots = (await client.query(`SELECT * FROM "TimeSlot" WHERE enabled ORDER BY "startMinutes"`)).rows;
  assert.equal(slots.length, 17);
  slots.forEach((slot, index) => { assert.equal(slot.startMinutes, (7 + index) * 60); assert.equal(slot.endMinutes - slot.startMinutes, 60); });
  check('17 continuous one-hour slots, 07:00 through 24:00');
  const mismatches = await client.query(`SELECT old.id FROM "PriceRule" old JOIN "TimeSlot" s ON s.id = old."timeSlotId" WHERE s.code LIKE 'S0_' AND (SELECT sum(child."priceCents") FROM "PriceRule" child WHERE child."creationIdempotencyKey" LIKE 'HOURLY_V1:' || old.id || ':%') IS DISTINCT FROM old."priceCents"`);
  assert.equal(mismatches.rowCount, 0);
  const newcomerMismatch = await client.query(`SELECT old.id FROM "PriceRule" old JOIN "TimeSlot" s ON s.id = old."timeSlotId" WHERE s.code LIKE 'S0_' AND (SELECT sum(child."newcomerPriceCents") FROM "PriceRule" child WHERE child."creationIdempotencyKey" LIKE 'HOURLY_V1:' || old.id || ':%') IS DISTINCT FROM old."newcomerPriceCents"`);
  assert.equal(newcomerMismatch.rowCount, 0);
  check('all tariff and newcomer totals preserved across hourly splits');
  const member = (await client.query(`SELECT id,"openId","primaryRole" FROM "User" WHERE phone = '13800000005'`)).rows[0];
  assert(member && !member.openId && member.primaryRole === 'MEMBER');
  const court = (await client.query(`SELECT id FROM "Court" WHERE code = 'C01' AND enabled`)).rows[0];
  const payload = Buffer.from(JSON.stringify({ sub: member.id, exp: Math.floor(Date.now()/1000) + 300 })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + payload;
  const token = body + '.' + createHmac('sha256', jwtSecret).update(body).digest('base64url');
  server = spawn(process.execPath, ['dist/main.js'], { cwd: new URL('../', import.meta.url), env, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Isolated API failed to start');
    try { ready = (await fetch(base + '/health')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'Isolated API health');
  async function request(method, route, data, expected = 200) {
    const response = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result.message)}`);
    return result.data;
  }
  const date = '2090-09-07';
  const calendar = await request('GET', '/venues/availability?date=' + date);
  assert.equal(calendar.slots.length, 17);
  const book = (hour, key, expected = 201) => request('POST', '/venues/bookings', { date, courtId: court.id, slotId: 'hourly-slot-H' + String(hour).padStart(2, '0'), sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: key }, expected);
  const first = await book(7, 'hourly-api-first');
  assert.equal(first.payableCents, 3000);
  assert.equal(new Date(first.bookings[0].endsAt) - new Date(first.bookings[0].startsAt), 3_600_000);
  const replay = await book(7, 'hourly-api-first');
  assert.equal(replay.id, first.id);
  await book(7, 'hourly-api-duplicate', 409);
  const adjacent = await book(8, 'hourly-api-adjacent');
  assert.notEqual(adjacent.id, first.id);
  check('hourly amount, duration, idempotency, duplicate rejection and adjacent booking');
  await request('POST', '/orders/' + first.id + '/cancel', { reason: '隔离小时验收取消', idempotencyKey: 'hourly-api-cancel' }, 201);
  assert.notEqual((await book(7, 'hourly-api-rebook')).id, first.id);
  assert.equal((await client.query('SELECT status FROM "Order" WHERE id=$1', [adjacent.id])).rows[0].status, 'PENDING');
  check('cancellation frees only the cancelled hour');
  // Prisma DateTime columns store UTC in timestamp-without-time-zone columns.
  await client.query(`INSERT INTO "CourtBooking" (id,"courtId",status,"startsAt","endsAt","updatedAt") VALUES ('hourly-legacy-fixture',$1,'CONFIRMED','2090-09-07 01:00:00','2090-09-07 03:00:00',now())`, [court.id]);
  await book(9, 'hourly-legacy-first', 409);
  await book(10, 'hourly-legacy-second', 409);
  await book(11, 'hourly-legacy-next');
  check('historical two-hour booking blocks both hours but not its neighbour');
  const midnight = await book(23, 'hourly-api-midnight');
  assert.equal(midnight.bookings[0].endsAt, '2090-09-07T16:00:00.000Z');
  check('23:00–24:00 booking ends at the next Beijing calendar day');
  console.log(JSON.stringify({ status: 'PASS', count: checks.length, checks }));
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await client.end();
}
