// All fixtures and payment operations are confined to a disposable DB clone.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connection = new URL(process.env.DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
connection.pathname = '/yanqing_doubles_test_20260905';
const client = new pg.Client({ connectionString: connection.href });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.href }) });
const jwtSecret = 'isolated-doubles-signup-test-20260905';
const base = 'http://127.0.0.1:33201/api/v1';
const env = { ...process.env, DATABASE_URL: connection.href, NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', HOST: '127.0.0.1', PORT: '33201', JWT_SECRET: jwtSecret };
for (const key of Object.keys(env)) if (key.startsWith('WECHAT_')) delete env[key];
const checks = [];
const check = name => { checks.push(name); console.log('PASS ' + name); };
let server;
await client.connect();
try {
  const before = await client.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM "EventTeam" t`);
  const business = async () => {
    const values = {};
    for (const table of ['User', 'Order', 'Payment', 'Refund', 'Account', 'AccountTransaction']) values[table] = (await client.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM "${table}" t`)).rows[0].hash;
    return values;
  };
  const oldBusiness = await business();
  const migration = await readFile(new URL('../prisma/migrations/20260905160000_event_team_signup/migration.sql', import.meta.url), 'utf8');
  await client.query(migration);
  const after = await client.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) - 'playerAPhone' - 'playerBPhone' - 'captainPlays' - 'registrationMode' ORDER BY id)::text,'[]')) AS hash FROM "EventTeam" t`);
  assert.equal(after.rows[0].hash, before.rows[0].hash);
  assert.deepEqual(await business(), oldBusiness);
  check('additive migration preserves historical teams, users, orders and money');
  const users = [];
  for (let index = 0; index < 5; index++) users.push(await prisma.user.create({ data: {
    id: 'doubles-fixture-user-' + index, displayName: '隔离验收用户' + index, primaryRole: index === 4 ? 'ADMIN' : 'MEMBER',
    roles: { create: [{ role: 'MEMBER' }, ...(index === 4 ? [{ role: 'ADMIN' }] : [])] },
    memberProfile: { create: { tags: [] } }, accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
  } }));
  const makeEvent = suffix => prisma.event.create({ data: {
    id: 'doubles-fixture-' + suffix, code: 'DOUBLES-' + suffix, name: '隔离双打验收' + suffix,
    startsAt: new Date('2090-09-07T11:00:00Z'), registrationEndsAt: new Date('2090-09-07T09:00:00Z'), status: 'OPEN', capacityPeople: 24, minimumPeople: 24, totalRounds: 5, feeCents: 8800, rules: [],
  } });
  const event = await makeEvent('manual');
  const token = id => {
    const body = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    return body + '.' + createHmac('sha256', jwtSecret).update(body).digest('base64url');
  };
  server = spawn(process.execPath, ['dist/main.js'], { cwd: new URL('../', import.meta.url), env, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Isolated API failed to start');
    try { ready = (await fetch(base + '/health')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'Isolated API health');
  async function request(actor, method, path, data, expected) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: 'Bearer ' + token(actor.id) } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const body = await response.json();
    if (expected) assert.equal(response.status, expected, method + ' ' + path + ': ' + JSON.stringify(body.message));
    return { status: response.status, data: body.data, message: body.message };
  }
  const manual = { registrationMode: 'MANUAL', captainPlays: false, consent: true, name: '测试代填队', playerAName: '张甲', playerAPhone: '13810000001', playerBName: '李乙', playerBPhone: '13810000002', category: 'MIXED_DOUBLES' };
  const register = (actor, e, command, expected = 201) => request(actor, 'POST', '/events/' + e.id + '/register', command, expected);
  await register(users[0], event, { ...manual, playerBPhone: '' }, 400);
  const countUsers = await prisma.user.count();
  const superseded = (await request(users[0], 'POST', '/events/' + event.id + '/team-invites', { name: manual.name, playerAName: manual.playerAName, playerAPhone: manual.playerAPhone, category: manual.category, consent: true }, 201)).data;
  const first = (await register(users[0], event, { ...manual, creationIdempotencyKey: 'doubles-manual-first' })).data;
  let team = await prisma.eventTeam.findUniqueOrThrow({ where: { orderId: first.id } });
  assert.equal(team.playerAPhone, manual.playerAPhone);
  assert.equal(team.playerBPhone, manual.playerBPhone);
  assert.equal(team.playerAUserId, null); assert.equal(team.playerBUserId, null); assert.equal(team.captainPlays, false);
  assert.equal(await prisma.user.count(), countUsers);
  assert.equal(first.payableCents, 8800);
  assert.equal((await register(users[0], event, { ...manual, creationIdempotencyKey: 'doubles-manual-first' })).data.id, first.id);
  await register(users[0], event, { ...manual, playerBPhone: '13810000009', creationIdempotencyKey: 'doubles-manual-first' }, 409);
  check('manual signup requires two contacts, one order, no second user and safe replay');
  await request(null, 'POST', '/events/' + event.id + '/team-invites/preview', { partnerInviteCode: superseded.partnerInviteCode }, 404);
  check('manual submission revokes the captain’s superseded invitation card');
  await register(users[1], event, { ...manual, playerAPhone: '13810000003' }, 409);
  await request(users[0], 'GET', '/events/managed/' + event.id, null, 403);
  const managed = (await request(users[4], 'GET', '/events/managed/' + event.id, null, 200)).data;
  assert.equal(managed.teams.find(t => t.id === team.id).playerBPhone, manual.playerBPhone);
  for (const route of ['/events/' + event.id, '/events/' + event.id + '/registration/me', '/orders/' + first.id]) {
    const view = (await request(users[0], 'GET', route, null, 200)).data;
    assert(!/playerAPhone|playerBPhone|138100000/.test(JSON.stringify(view)), route + ' contact leak');
  }
  check('duplicate participant blocked, contacts only in authorized management view');
  await request(users[0], 'POST', '/events/' + event.id + '/registration/cancel', { reason: '隔离测试取消', idempotencyKey: 'doubles-cancel-first' }, 201);
  assert.equal((await prisma.eventTeam.findUniqueOrThrow({ where: { id: team.id } })).status, 'CANCELLED');
  const second = (await register(users[0], event, { ...manual, creationIdempotencyKey: 'doubles-manual-second' })).data;
  assert.notEqual(second.id, first.id);
  check('unpaid cancellation releases team contacts and seat for rebooking');
  await request(users[0], 'POST', '/orders/' + second.id + '/pay', { channel: 'CASH_PRINCIPAL', idempotencyKey: 'doubles-payment-test' }, 201);
  assert.equal((await prisma.eventTeam.findUniqueOrThrow({ where: { orderId: second.id } })).status, 'PAID');
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { userId_type: { userId: users[0].id, type: 'CASH_PRINCIPAL' } } })).balance, 91200);
  check('payment transitions registration to PAID and debits the payer exactly once');
  const inviteEvent = await makeEvent('invite');
  const inviteCommand = { name: '分享邀请队', playerAName: manual.playerAName, playerAPhone: manual.playerAPhone, category: manual.category, consent: true };
  const created = (await request(users[0], 'POST', '/events/' + inviteEvent.id + '/team-invites', inviteCommand, 201)).data;
  const code = created.partnerInviteCode;
  const invited = { name: inviteCommand.name, category: inviteCommand.category, registrationMode: 'INVITE', partnerInviteCode: code, creationIdempotencyKey: 'doubles-invited-submit' };
  await register(users[0], inviteEvent, invited, 409);
  const preview = (await request(null, 'POST', '/events/' + inviteEvent.id + '/team-invites/preview', { partnerInviteCode: code }, 201)).data;
  assert.equal(preview.status, 'PENDING'); assert.equal(preview.role, 'VISITOR');
  assert(!/playerAName|playerBName|Phone|captainId|partnerId|tokenHash|138100000/.test(JSON.stringify(preview)));
  check('anonymous card preview is safe and does not create a registration');
  const accept = (user, phone) => request(user, 'POST', '/events/' + inviteEvent.id + '/team-invites/accept', { partnerInviteCode: code, playerBName: '受邀球友', playerBPhone: phone, consent: true });
  const claims = await Promise.all([accept(users[1], '13810000011'), accept(users[2], '13810000012')]);
  assert.deepEqual(claims.map(item => item.status).sort(), [201, 409]);
  const winner = users[claims[0].status === 201 ? 1 : 2];
  const winnerPhone = claims[0].status === 201 ? '13810000011' : '13810000012';
  assert.equal((await accept(winner, winnerPhone)).status, 201);
  const safeAfter = (await request(null, 'POST', '/events/' + inviteEvent.id + '/team-invites/preview', { partnerInviteCode: code }, 201)).data;
  assert(!/受邀球友|Phone|138100|partnerId/.test(JSON.stringify(safeAfter)));
  await register(users[3], inviteEvent, invited, 403);
  await register(users[0], inviteEvent, { ...invited, name: '被篡改的队名' }, 409);
  const invitedOrder = (await register(users[0], inviteEvent, invited)).data;
  const stored = await prisma.eventTeam.findUniqueOrThrow({ where: { orderId: invitedOrder.id } });
  assert.equal(stored.playerBUserId, winner.id); assert.equal(stored.playerBPhone, winnerPhone);
  assert.equal((await register(users[0], inviteEvent, invited)).data.id, invitedOrder.id);
  check('concurrent invitation acceptance has one winner; only original captain can submit');
  const raceEvent = await makeEvent('duplicate-race');
  const race = await Promise.all([0, 1].map(index => register(users[index], raceEvent, { ...manual, playerAPhone: '1381000002' + index, playerBPhone: '13810000029', creationIdempotencyKey: 'doubles-race-' + index }, null)));
  assert.deepEqual(race.map(item => item.status).sort(), [201, 409]);
  assert.equal(await prisma.eventTeam.count({ where: { eventId: raceEvent.id } }), 1);
  check('concurrent guest contact collision creates exactly one team/order');
  const expiresEvent = await makeEvent('expiry');
  const expires = (await request(users[0], 'POST', '/events/' + expiresEvent.id + '/team-invites', inviteCommand, 201)).data;
  await prisma.eventPartnerInvite.updateMany({ where: { eventId: expiresEvent.id }, data: { expiresAt: new Date(0) } });
  await request(users[1], 'POST', '/events/' + expiresEvent.id + '/team-invites/accept', { partnerInviteCode: expires.partnerInviteCode, playerBName: '过期测试', playerBPhone: '13810000002', consent: true }, 409);
  check('expired invite is rejected by the server');
  const waitEvent = await makeEvent('waitlist');
  await prisma.eventTeam.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ eventId: waitEvent.id, captainId: users[4].id, name: '已付队' + i, playerAName: 'A' + i, playerBName: 'B' + i, seed: i + 1, category: 'MEN_DOUBLES', status: 'PAID', opponents: [] })) });
  const wait = (await register(users[0], waitEvent, manual)).data;
  assert.equal(wait.status, 'WAITLISTED');
  const waitTeam = await prisma.eventTeam.findFirstOrThrow({ where: { eventId: waitEvent.id, captainId: users[0].id } });
  assert.equal(waitTeam.orderId, null); assert.equal(waitTeam.playerBPhone, manual.playerBPhone);
  check('full event stores both contacts in waitlist with no order or charge');
  console.log(JSON.stringify({ status: 'PASS', count: checks.length, checks }));
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await prisma.$disconnect();
  await client.end();
}
