// Write tests run ONLY against an explicitly named disposable database copy.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connection = new URL(process.env.DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
assert(/^yanqing_release_smoke_[a-z0-9_]+$/.test(process.env.RELEASE_TEST_DATABASE || ''), 'Explicit disposable DB required');
connection.pathname = '/' + process.env.RELEASE_TEST_DATABASE;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.href }) });
const base = 'http://127.0.0.1:33202/api/v1';
const secret = randomUUID() + randomUUID();
const env = { ...process.env, DATABASE_URL: connection.href, NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', HOST: '127.0.0.1', PORT: '33202', JWT_SECRET: secret };
for (const key of Object.keys(env)) if (key.startsWith('WECHAT_')) delete env[key];
const checks = [];
const check = name => { checks.push(name); console.log('PASS ' + name); };
const token = id => {
  const body = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
};
let server;
try {
  const users = [];
  for (const role of ['MEMBER', 'MEMBER', 'FRONT_DESK']) users.push(await prisma.user.create({ data: {
    displayName: '隔离发布验收' + users.length, primaryRole: role, roles: { create: { role } },
    memberProfile: { create: { tags: [] } },
    accounts: { create: [{ type: 'CASH_PRINCIPAL', balance: 10000, frozenBalance: 9500 }, { type: 'GIFT_BALANCE', balance: 20000 }] },
  } }));
  const [member, outsider, staff] = users;
  const makeOrder = (businessType, extra = {}) => prisma.order.create({ data: {
    orderNo: 'REL-' + randomUUID(), memberId: member.id, businessType, subjectAccount: 'VENUE', sourceChannel: 'MINIAPP',
    title: '隔离发布验收', listAmountCents: 1000, payableCents: 1000, parameterSnapshot: {}, ...extra,
  } });
  const goods = await makeOrder('GOODS');
  const recharge = await makeOrder('RECHARGE');
  const membership = await makeOrder('MEMBERSHIP');
  const expired = await makeOrder('RECHARGE', { createdAt: new Date(Date.now() - 16 * 60000) });
  const court = await prisma.court.findFirstOrThrow({ where: { enabled: true } });
  const venue = await makeOrder('VENUE', { bookings: { create: {
    courtId: court.id, memberId: member.id, startsAt: new Date('2091-01-01T08:00:00Z'), endsAt: new Date('2091-01-01T09:00:00Z'), holdExpiresAt: new Date(Date.now() + 600000),
  } } });
  const product = await prisma.trainingProduct.findFirstOrThrow();
  const training = await makeOrder('TRAINING', { trainingEnrollment: { create: {
    enrollmentNo: 'REL-' + randomUUID(), contractNo: 'REL-' + randomUUID(), productId: product.id,
    buyerId: member.id, totalSessions: 10, totalAmountCents: 1000, prepaidBalanceCents: 0,
    seatReservedUntil: new Date(Date.now() + 600000), startsAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
  } } });
  const merchant = await prisma.merchant.findFirstOrThrow();
  const template = await prisma.couponTemplate.create({ data: {
    code: 'REL-' + randomUUID(), merchantId: merchant.id, name: '隔离商户券', activityName: '发布检查',
    benefitDescription: '仅限商户', issueLimit: 2, validFrom: new Date(Date.now() - 60000), validTo: new Date(Date.now() + 86400000),
  } });
  assert.equal(template.allowVenueBooking, false);
  const coupon = await prisma.couponCode.create({ data: { templateId: template.id, code: 'REL-' + randomUUID(), status: 'CLAIMED', holderId: member.id, expiresAt: template.validTo } });
  const oldCouponOrder = await makeOrder('VENUE', { parameterSnapshot: { couponId: coupon.id } });
  const beforeAssets = JSON.stringify(await prisma.account.findMany({ where: { userId: member.id }, orderBy: { id: 'asc' } }));
  server = spawn(process.execPath, ['dist/main.js'], { cwd: new URL('../', import.meta.url), env, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Isolated API failed to start');
    try { ready = (await fetch(base + '/health')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'Isolated health');
  async function request(actor, method, path, data, expected) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: 'Bearer ' + token(actor.id) } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const body = await response.json();
    assert.equal(response.status, expected, method + ' ' + path + ': ' + JSON.stringify(body.message));
    return body.data;
  }
  await request(null, 'POST', '/auth/dev-login', { role: 'ADMIN' }, 401);
  check('production blocks development login');
  await request(member, 'GET', '/members/leads/owners', null, 403);
  const owners = await request(staff, 'GET', '/members/leads/owners', null, 200);
  assert(owners.items.length > 0);
  assert.deepEqual(Object.keys(owners.items[0]).sort(), ['displayName', 'id', 'roles']);
  check('staff selection endpoint enforces roles and minimal projection');
  const options = await request(member, 'GET', '/orders/' + membership.id + '/payment-options', null, 200);
  assert.equal(options.options.find(item => item.channel === 'CASH_PRINCIPAL').availableBalance, 500);
  assert.equal(options.options.find(item => item.channel === 'CASH_PRINCIPAL').enabled, false);
  assert.equal(options.options.find(item => item.channel === 'GIFT_BALANCE').enabled, true);
  check('server quote excludes frozen balance');
  await request(outsider, 'GET', '/orders/' + membership.id + '/payment-options', null, 404);
  await request(outsider, 'POST', '/orders/' + membership.id + '/cancel', { idempotencyKey: 'release-outside-cancel' }, 403);
  check('cross-member quote and cancellation are refused');
  const rechargeQuote = await request(member, 'GET', '/orders/' + recharge.id + '/payment-options', null, 200);
  assert.deepEqual(rechargeQuote.options.filter(item => item.enabled).map(item => item.channel), ['WECHAT']);
  check('recharge never consumes existing balance');
  for (const order of [goods, recharge, membership, training, venue]) {
    const command = { idempotencyKey: 'release-cancel-' + order.id, reason: '隔离发布验收取消' };
    const result = await request(member, 'POST', '/orders/' + order.id + '/cancel', command, 201);
    assert.equal(result.status, 'CANCELLED');
    await request(member, 'POST', '/orders/' + order.id + '/cancel', command, 201);
  }
  assert.equal((await prisma.trainingEnrollment.findUniqueOrThrow({ where: { orderId: training.id } })).status, 'CANCELLED');
  assert.equal((await prisma.courtBooking.findUniqueOrThrow({ where: { orderId: venue.id } })).status, 'CANCELLED');
  assert.equal(beforeAssets, JSON.stringify(await prisma.account.findMany({ where: { userId: member.id }, orderBy: { id: 'asc' } })));
  check('five unpaid purchase types cancel idempotently, release resources, and do not move money');
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: expired.id } })).status, 'CANCELLED');
  assert(await prisma.auditLog.count({ where: { objectId: expired.id, action: 'RECHARGE_ORDER_AUTO_CANCELLED' } }));
  check('startup expiry closes stale recharge and writes system audit');
  const coupons = await request(member, 'GET', '/alliance/coupons/me', null, 200);
  assert.equal(coupons.find(item => item.id === coupon.id).bookingUsage.eligible, false);
  await request(member, 'GET', '/orders/' + oldCouponOrder.id + '/payment-options', null, 409);
  await request(member, 'POST', '/orders/' + oldCouponOrder.id + '/pay', { channel: 'GIFT_BALANCE', idempotencyKey: 'release-invalid-coupon-pay' }, 409);
  check('merchant-only coupons are blocked in wallet, old order preflight and actual payment');
  const payOrder = await makeOrder('GOODS');
  await request(member, 'POST', '/orders/' + payOrder.id + '/pay', { channel: 'GIFT_BALANCE', expectedDebitAmount: 999, idempotencyKey: 'release-changed-quote' }, 409);
  assert.equal(await prisma.payment.count({ where: { orderId: payOrder.id } }), 0);
  check('quote mismatch rolls back payment creation');
  console.log(JSON.stringify({ status: 'PASS', count: checks.length, checks }));
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await prisma.$disconnect();
}
