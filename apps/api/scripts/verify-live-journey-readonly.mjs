// No business writes, payment calls, or development login. Only seeded test identities.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const base = 'https://api.yutechhn.cn/api/v1';
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
function token(id) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encoded({ alg: 'HS256', typ: 'JWT' }) + '.' + encoded({ sub: id, exp: Math.floor(Date.now() / 1000) + 180 });
  return body + '.' + createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url');
}
async function get(path, user, expected = 200) {
  const response = await fetch(base + path, { headers: { Origin: 'https://yutechhn.cn', ...(user ? { Authorization: 'Bearer ' + token(user.id) } : {}) } });
  assert.equal(response.status, expected, 'GET ' + path);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://yutechhn.cn');
  return (await response.json()).data;
}
try {
  await get('/health');
  pass('public HTTPS API health and H5 CORS');
  const migrations = await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(migrations[0].count, 33);
  assert.equal(await db.couponTemplate.count({ where: { allowVenueBooking: true } }), 0);
  pass('33 migrations applied and existing merchant templates default to no venue deduction');
  const member = await db.user.findUniqueOrThrow({ where: { phone: '13800000005' }, select: { id: true, openId: true, primaryRole: true, status: true } });
  const staff = await db.user.findUniqueOrThrow({ where: { phone: '13800000002' }, select: { id: true, openId: true, primaryRole: true, status: true } });
  for (const [user, role] of [[member, 'MEMBER'], [staff, 'FRONT_DESK']]) {
    assert.equal(user.openId, null); assert.equal(user.primaryRole, role); assert.equal(user.status, 'ACTIVE');
  }
  await get('/orders', null, 401);
  for (const status of ['', 'undefined', 'PENDING', 'PAID', 'REFUND_PENDING', 'BAD_FILTER']) {
    const query = new URLSearchParams({ page: '1', pageSize: '20' });
    if (status) query.set('status', status);
    const result = await get('/orders?' + query, member, status === 'BAD_FILTER' ? 400 : 200);
    if (status && !['undefined', 'BAD_FILTER'].includes(status)) assert(result.items.every(item => item.status === status));
  }
  pass('order list works across all, pending, paid, after-sales and invalid filters; anonymous refused');
  await get('/members/leads/owners', member, 403);
  const owners = await get('/members/leads/owners', staff);
  assert(owners.items.length > 0);
  for (const item of owners.items) assert.deepEqual(Object.keys(item).sort(), ['displayName', 'id', 'roles']);
  pass('live staff selector enforces permission and minimal public fields');
  const latest = await db.order.findFirst({ where: { memberId: member.id }, select: { id: true }, orderBy: { createdAt: 'desc' } });
  assert(latest, 'Seeded member requires an existing order');
  const quote = await get('/orders/' + latest.id + '/payment-options', member);
  assert.equal(quote.orderId, latest.id); assert.equal(quote.options.length, 4);
  const wallet = await get('/alliance/coupons/me', member);
  assert(Array.isArray(wallet)); assert(wallet.every(item => typeof item.bookingUsage?.eligible === 'boolean'));
  pass('live payment preflight and wallet expose the new contract');
  const h5 = await fetch('https://yutechhn.cn/badminton/'); assert(h5.ok);
  const html = await h5.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/badminton\/assets\/[^\"]+)"/g)].map(item => item[1]);
  assert(assets.length >= 2);
  for (const path of assets) {
    const response = await fetch('https://yutechhn.cn' + path); assert(response.ok, path);
    assert(!response.headers.get('content-type')?.includes('text/html'), 'Asset cannot be HTML fallback');
  }
  pass('public H5 index and versioned JS/CSS load under /badminton/');
  console.log(JSON.stringify({ status: 'PASS', count: checks.length, checks }));
} finally { await db.$disconnect(); }
