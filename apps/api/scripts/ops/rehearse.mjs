import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { PrismaClient } from '../../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { command, root, checkReadiness } from './common.mjs';
process.chdir(root);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert(
  /^yanqing_restore_ops_[a-f0-9]{16}_test$/.test(
    process.env.RELEASE_TEST_DATABASE || '',
  ),
);
assert.notEqual(url.pathname.slice(1), process.env.RELEASE_TEST_DATABASE);
url.pathname = '/' + process.env.RELEASE_TEST_DATABASE;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
const secret = randomUUID() + randomUUID();
const env = {
  ...process.env,
  DATABASE_URL: url.href,
  NODE_ENV: 'test',
  DEV_LOGIN_ENABLED: 'false',
  PAYMENT_PROVIDER: 'mock',
  HOST: '127.0.0.1',
  PORT: '33209',
  JWT_SECRET: secret,
  BOSS_MONITOR_ENABLED: 'false',
  BOSS_LLM_API_KEY: '',
  UPLOAD_DIR: process.env.RELEASE_BACKUP + '/smoke-uploads',
};
for (const k of Object.keys(env)) if (k.startsWith('WECHAT_')) delete env[k];
const base = 'http://127.0.0.1:33209/api/v1';
const key = () => 'deploy-' + randomUUID();
const token = (id) => {
  const s =
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    ) +
    '.' +
    Buffer.from(
      JSON.stringify({
        sub: id,
        loginMethod: 'wechat',
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString('base64url');
  return s + '.' + createHmac('sha256', secret).update(s).digest('base64url');
};
let server;
const log = createWriteStream(process.env.RELEASE_BACKUP + '/smoke-api.log', {
  mode: 0o600,
});
const passed = [];
const check = (s) => {
  passed.push(s);
  console.log('PASS ' + s);
};
async function request(id, method, path, body, status = 200) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(id ? { Authorization: 'Bearer ' + token(id) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  assert.equal(
    r.status,
    status,
    method + ' ' + path + ': ' + String(data.message),
  );
  return data.data;
}
try {
  const member = await db.user.create({
    data: {
      displayName: '隔离发布验收会员',
      primaryRole: 'MEMBER',
      accounts: { create: { type: 'CASH_PRINCIPAL', balance: 10000 } },
    },
  });
  const finance = await db.user.create({
    data: { displayName: '隔离发布验收财务', primaryRole: 'FINANCE' },
  });
  const outsider = await db.user.create({
    data: { displayName: '隔离验收外部会员', primaryRole: 'MEMBER' },
  });
  const court = await db.court.create({
    data: { code: key(), name: '隔离验收场地', zone: 'EAST', sortOrder: 999 },
  });
  const make = () =>
    db.order.create({
      data: {
        orderNo: key(),
        memberId: member.id,
        businessType: 'VENUE',
        subjectAccount: 'VENUE',
        sourceChannel: 'MINI_PROGRAM',
        title: '隔离发布订场',
        listAmountCents: 1000,
        payableCents: 1000,
        parameterSnapshot: {},
        bookings: {
          create: {
            courtId: court.id,
            memberId: member.id,
            startsAt: new Date('2091-01-01T08:00:00Z'),
            endsAt: new Date('2091-01-01T09:00:00Z'),
            holdExpiresAt: new Date(Date.now() + 600000),
          },
        },
      },
    });
  const order = await make();
  const probe = await import('node:net');
  const port = probe.createServer();
  await new Promise((res, rej) => {
    port.once('error', rej);
    port.listen(33209, '127.0.0.1', res);
  });
  await new Promise((res) => port.close(res));
  server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  let ready = false;
  for (let i = 0; i < 45; i++) {
    if (server.exitCode !== null) throw new Error('Isolated API exited');
    try {
      await checkReadiness(base, process.env.RELEASE_COMMIT);
      ready = true;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(ready);
  check('compiled API starts against restored database');
  await request(null, 'POST', '/auth/dev-login', { role: 'ADMIN' }, 401);
  await request(null, 'GET', '/orders', null, 401);
  check('development login and anonymous orders are blocked');
  await request(outsider.id, 'GET', '/orders/' + order.id, null, 404);
  check('another member cannot read this order');
  const payment = { channel: 'CASH_PRINCIPAL', idempotencyKey: key() };
  await request(
    member.id,
    'POST',
    '/orders/' + order.id + '/pay',
    payment,
    201,
  );
  await request(
    member.id,
    'POST',
    '/orders/' + order.id + '/pay',
    payment,
    201,
  );
  assert.equal(
    (
      await db.account.findUniqueOrThrow({
        where: { userId_type: { userId: member.id, type: 'CASH_PRINCIPAL' } },
      })
    ).balance,
    9000,
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    'PAID',
  );
  assert.equal(
    (await db.courtBooking.findUniqueOrThrow({ where: { orderId: order.id } }))
      .status,
    'CONFIRMED',
  );
  check('balance payment confirms booking and exact replay debits once');
  await request(member.id, 'GET', '/orders/' + order.id);
  await request(finance.id, 'GET', '/orders/admin/all');
  check('member and management order queries are available');
  const rf = await request(
    member.id,
    'POST',
    '/orders/' + order.id + '/refunds',
    { amountCents: 1000, reason: '隔离发布验收退款', idempotencyKey: key() },
    201,
  );
  await request(
    finance.id,
    'POST',
    '/orders/refunds/' + rf.id + '/approve',
    { reason: '隔离验收通过' },
    201,
  );
  await request(
    finance.id,
    'POST',
    '/orders/refunds/' + rf.id + '/approve',
    { reason: '隔离验收通过' },
    201,
  );
  assert.equal(
    (
      await db.account.findUniqueOrThrow({
        where: { userId_type: { userId: member.id, type: 'CASH_PRINCIPAL' } },
      })
    ).balance,
    10000,
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    'REFUNDED',
  );
  assert.equal(
    (await db.courtBooking.findUniqueOrThrow({ where: { orderId: order.id } }))
      .status,
    'CANCELLED',
  );
  check('refund restores balance once and releases its booking');
  const pending = await make();
  await request(
    member.id,
    'POST',
    '/orders/' + pending.id + '/cancel',
    { reason: '隔离验收取消', idempotencyKey: key() },
    201,
  );
  assert.equal(
    (
      await db.courtBooking.findUniqueOrThrow({
        where: { orderId: pending.id },
      })
    ).status,
    'CANCELLED',
  );
  check('unpaid cancellation releases its held booking');
  await request(
    member.id,
    'POST',
    '/orders/' + pending.id + '/pay',
    { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
    409,
  );
  check('cancelled order cannot be paid again');
  await db.$disconnect();
  const database = process.env.RELEASE_TEST_DATABASE;
  const sql = (s) =>
    command('sudo', [
      '-n',
      '-u',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      'postgres',
      '-c',
      s,
    ]);
  try {
    sql('ALTER DATABASE "' + database + '" WITH ALLOW_CONNECTIONS false');
    sql(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='" +
        database +
        "'",
    );
    await request(null, 'GET', '/health/ready', null, 503);
    await request(null, 'GET', '/health');
    check('database outage returns 503 while process liveness remains 200');
  } finally {
    sql('ALTER DATABASE "' + database + '" WITH ALLOW_CONNECTIONS true');
  }
  let recovered = false;
  for (let i = 0; i < 10; i++) {
    try {
      await checkReadiness(base, process.env.RELEASE_COMMIT);
      recovered = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert(recovered);
  check('readiness recovers after isolated database connectivity returns');
  console.log(JSON.stringify({ passed: passed.length, isolated: true }));
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  log.end();
  await db.$disconnect();
}
