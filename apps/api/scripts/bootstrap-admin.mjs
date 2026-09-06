import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import pg from 'pg'

export async function bootstrapAdmin(client, options) {
  const { phone, userId, expectedUserId, apply = false, operator, reason } = options
  if (Boolean(phone) === Boolean(userId)) throw new Error('Provide exactly one phone or user-id selector')
  if (phone && !/^1\d{10}$/.test(phone)) throw new Error('A complete 11-digit phone number is required')
  if (userId && !userId.trim()) throw new Error('A nonempty user-id is required')
  if (apply && (!expectedUserId?.trim() || !operator?.trim() || !reason?.trim())) {
    throw new Error('Apply requires expected-user-id, operator and reason from the reviewed plan')
  }
  await client.query('BEGIN')
  try {
    // Serialize role writes during this one-time initialization, including other
    // administrators. Table order matches application role changes (User first).
    if (apply) {
      await client.query('LOCK TABLE "User", "UserRole" IN SHARE ROW EXCLUSIVE MODE')
    } else {
      await client.query('SET TRANSACTION READ ONLY')
    }
    const result = await client.query(`
      SELECT id, "displayName", "primaryRole", status, "deletedAt",
             ("openId" IS NOT NULL AND length(trim("openId")) > 0) AS "wechatBound"
      FROM "User" WHERE ${phone ? 'phone' : 'id'} = $1`, [phone || userId])
    if (result.rows.length !== 1) throw new Error('Exactly one matching account is required; no changes made')
    const user = result.rows[0]
    if (!user.wechatBound || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new Error('Target must be an active, non-deleted WeChat-bound account')
    }
    if (expectedUserId && expectedUserId !== user.id) throw new Error('Account no longer matches the reviewed user ID')
    const other = await client.query(`
      SELECT u.id FROM "User" u
      WHERE u.id <> $1 AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
        AND u."openId" IS NOT NULL AND length(trim(u."openId")) > 0
        AND (u."primaryRole" = 'SUPER_ADMIN' OR EXISTS (
          SELECT 1 FROM "UserRole" r WHERE r."userId" = u.id AND r.role = 'SUPER_ADMIN'
        )) LIMIT 1`, [user.id])
    if (other.rows.length) throw new Error('A real super administrator already exists; use normal role management')
    const { rows: roles } = await client.query('SELECT role, "merchantId" FROM "UserRole" WHERE "userId" = $1 ORDER BY role', [user.id])
    const alreadyApplied = user.primaryRole === 'SUPER_ADMIN' && roles.some(r => r.role === 'SUPER_ADMIN' && r.merchantId === null)
    const plan = {
      userId: user.id, displayName: user.displayName,
      ...(phone ? { phone: `${phone.slice(0, 3)}****${phone.slice(-4)}` } : {}),
      wechatBound: true, previousPrimaryRole: user.primaryRole, targetPrimaryRole: 'SUPER_ADMIN',
      mode: apply ? 'apply' : 'plan', alreadyApplied,
    }
    if (!apply || alreadyApplied) {
      await client.query(apply ? 'COMMIT' : 'ROLLBACK')
      return { ...plan, changed: false }
    }
    // Preserve the former primary role and every existing role/scope.
    for (const role of new Set([user.primaryRole, 'SUPER_ADMIN'])) {
      await client.query(`INSERT INTO "UserRole" (id, "userId", role, "createdAt")
        SELECT $1, $2, $3::"AppRole", now()
        WHERE NOT EXISTS (SELECT 1 FROM "UserRole" WHERE "userId" = $2 AND role = $3::"AppRole" AND "merchantId" IS NULL)`,
      [randomUUID(), user.id, role])
    }
    await client.query('UPDATE "User" SET "primaryRole" = \'SUPER_ADMIN\', "updatedAt" = now() WHERE id = $1', [user.id])
    const auditId = randomUUID()
    await client.query(`INSERT INTO "AuditLog"
      (id, action, "objectType", "objectId", "oldValue", "newValue", reason, "deviceInfo", "createdAt")
      VALUES ($1, 'BOOTSTRAP_SUPER_ADMIN', 'User', $2, $3::jsonb, $4::jsonb, $5, $6, now())`, [
      auditId, user.id, JSON.stringify({ primaryRole: user.primaryRole, roles }),
      JSON.stringify({ primaryRole: 'SUPER_ADMIN', grantedRole: 'SUPER_ADMIN' }),
      reason, `bootstrap-admin CLI; operator=${operator}`,
    ])
    await client.query('COMMIT')
    return { ...plan, changed: true, auditId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client
  try {
    const { values } = parseArgs({ options: {
      phone: { type: 'string' }, 'user-id': { type: 'string' }, 'expected-user-id': { type: 'string' },
      operator: { type: 'string' }, reason: { type: 'string' }, apply: { type: 'boolean', default: false },
    } })
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000,
      statement_timeout: 15000, lock_timeout: 5000 })
    await client.connect()
    console.log(JSON.stringify(await bootstrapAdmin(client, {
      phone: values.phone, userId: values['user-id'], expectedUserId: values['expected-user-id'], apply: values.apply,
      operator: values.operator, reason: values.reason,
    }), null, 2))
  } catch (error) {
    // Do not echo connection configuration or PostgreSQL error details.
    console.error(`Admin initialization failed: ${error.code ? `database error ${error.code}` : error.message}`)
    process.exitCode = 1
  } finally {
    await client?.end()
  }
}
