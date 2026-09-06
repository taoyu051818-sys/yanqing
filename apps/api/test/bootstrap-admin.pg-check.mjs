import assert from 'node:assert/strict'
import pg from 'pg'
import { bootstrapAdmin } from '../scripts/bootstrap-admin.mjs'

// Run only against a freshly migrated disposable database named auth_check.
const client = new pg.Client({ connectionString: process.env.AUTH_CHECK_DATABASE_URL })
await client.connect()
const checks = []
const options = { phone: '13900001600', expectedUserId: 'bootstrap-test-target', apply: true, operator: 'isolated test', reason: 'transaction regression' }
const reset = async () => {
  await client.query('DELETE FROM "AuditLog" WHERE "objectId" LIKE \'bootstrap-test-%\'')
  await client.query('DELETE FROM "User" WHERE id LIKE \'bootstrap-test-%\'')
  await client.query(`INSERT INTO "User" (id, phone, "openId", "displayName", "primaryRole", "updatedAt")
    VALUES ('bootstrap-test-target', '13900001600', 'bootstrap-test-wechat', '测试管理员', 'MEMBER', now())`)
  await client.query(`INSERT INTO "UserRole" (id, "userId", role) VALUES ('bootstrap-test-coach', 'bootstrap-test-target', 'COACH')`)
}
try {
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'auth_check')
  await reset()
  const preview = await bootstrapAdmin(client, { phone: options.phone })
  assert.equal(preview.changed, false)
  assert.equal(preview.phone, '139****1600')
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "AuditLog" WHERE "objectId" = $1', [options.expectedUserId])).rows[0].n, 0)
  checks.push('default preview does not change roles or audit')

  assert.equal((await bootstrapAdmin(client, { userId: options.expectedUserId })).userId, options.expectedUserId)
  await assert.rejects(() => bootstrapAdmin(client, { phone: options.phone, userId: options.expectedUserId }), /exactly one/)
  checks.push('exact user ID supports WeChat accounts without a phone and rejects ambiguous selectors')

  await assert.rejects(() => bootstrapAdmin(client, { ...options, expectedUserId: 'wrong-id' }), /reviewed user ID/)
  await assert.rejects(() => bootstrapAdmin(client, { ...options, operator: '' }), /operator/)
  checks.push('exact identity and operator required')

  for (const change of ['"openId" = NULL', 'status = \'DISABLED\'', '"deletedAt" = now()']) {
    await reset()
    await client.query(`UPDATE "User" SET ${change} WHERE id = $1`, [options.expectedUserId])
    await assert.rejects(() => bootstrapAdmin(client, options), /active, non-deleted WeChat-bound/)
  }
  checks.push('unbound, disabled and deleted accounts rejected')

  await reset()
  const result = await bootstrapAdmin(client, { ...options, phone: undefined, userId: options.expectedUserId })
  assert.equal(result.changed, true)
  const roles = (await client.query('SELECT role FROM "UserRole" WHERE "userId" = $1 ORDER BY role::text', [options.expectedUserId])).rows.map(r => r.role)
  assert.deepEqual(roles, ['COACH', 'MEMBER', 'SUPER_ADMIN'])
  const audit = (await client.query('SELECT * FROM "AuditLog" WHERE id = $1', [result.auditId])).rows[0]
  assert.equal(audit.actorId, null)
  assert.equal(audit.action, 'BOOTSTRAP_SUPER_ADMIN')
  assert.equal(audit.oldValue.primaryRole, 'MEMBER')
  assert.equal(audit.newValue.primaryRole, 'SUPER_ADMIN')
  checks.push('grant preserves primary and secondary roles and records operator audit')

  assert.equal((await bootstrapAdmin(client, options)).changed, false)
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "AuditLog" WHERE "objectId" = $1', [options.expectedUserId])).rows[0].n, 1)
  checks.push('repeated grant is idempotent')

  await client.query(`INSERT INTO "User" (id, phone, "openId", "displayName", "updatedAt")
    VALUES ('bootstrap-test-second', '13900002600', 'bootstrap-test-second-wechat', '第二账号', now())`)
  await assert.rejects(() => bootstrapAdmin(client, { ...options, phone: '13900002600', expectedUserId: 'bootstrap-test-second' }), /already exists/)
  checks.push('cannot bootstrap a second real super administrator')

  await reset()
  await client.query(`CREATE FUNCTION bootstrap_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated audit failure'; END $$`)
  await client.query(`CREATE TRIGGER bootstrap_test_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION bootstrap_test_fail_audit()`)
  try {
    await assert.rejects(() => bootstrapAdmin(client, options), /isolated audit failure/)
    assert.equal((await client.query('SELECT "primaryRole" FROM "User" WHERE id = $1', [options.expectedUserId])).rows[0].primaryRole, 'MEMBER')
    assert.deepEqual((await client.query('SELECT role FROM "UserRole" WHERE "userId" = $1', [options.expectedUserId])).rows.map(r => r.role), ['COACH'])
  } finally {
    await client.query('DROP TRIGGER bootstrap_test_fail_audit ON "AuditLog"')
    await client.query('DROP FUNCTION bootstrap_test_fail_audit()')
  }
  checks.push('audit failure rolls back both role grant and primary role update')
  await reset()
  await client.query('DELETE FROM "User" WHERE id LIKE \'bootstrap-test-%\'')
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2))
} finally {
  await client.end()
}
