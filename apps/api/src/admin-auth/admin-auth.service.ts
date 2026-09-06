import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import QRCode from 'qrcode'
import { PrismaService } from '../database/prisma.service.js'
import { AppRole, UserStatus } from '../generated/prisma/enums.js'
import type { AuthUser } from '../common/auth/auth-user.js'

export const ADMIN_ROLES: AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.FINANCE]
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
const LIFE = 120_000
const SESSION_LIFE = 8 * 60 * 60_000
const identitySelect = { id: true, displayName: true, status: true, deletedAt: true, primaryRole: true, roles: { select: { role: true } } } as const

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  get origin() {
    const value = this.config.get<string>('ADMIN_CONSOLE_ORIGIN', '')
    if (!value) throw new ServiceUnavailableException('电脑管理后台尚未启用')
    return value
  }
  get secure() { return new URL(this.origin).protocol === 'https:' }
  cookieName(kind: 'login' | 'session') { return `${this.secure ? '__Host-' : ''}yanqing-admin-${kind}` }
  cookieOptions(maxAge: number) { return { httpOnly: true, secure: this.secure, sameSite: 'strict' as const, path: '/', maxAge } }
  cookie(request: Pick<Request, 'headers'>, kind: 'login' | 'session') {
    const name = this.cookieName(kind)
    const values = (request.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='))
    if (values.length !== 1) return undefined
    const value = values[0].slice(name.length + 1)
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
  }
  assertOrigin(request: Pick<Request, 'headers'>) {
    if (request.headers.origin !== this.origin) throw new ForbiddenException('请从正式电脑后台发起操作')
  }
  private actor(user: { id: string; displayName: string; status: UserStatus; deletedAt: Date | null; primaryRole: AppRole; roles: { role: AppRole }[] } | null): AuthUser {
    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt) throw new UnauthorizedException('账号已停用，请重新登录')
    const roles = [...new Set([user.primaryRole, ...user.roles.map(item => item.role)])]
    if (!roles.some(role => ADMIN_ROLES.includes(role))) throw new ForbiddenException('当前账号没有电脑管理后台权限')
    return { sub: user.id, displayName: user.displayName, roles }
  }
  private requireWechat(actor: AuthUser) {
    if (actor.loginMethod !== 'wechat') throw new ForbiddenException('请使用小程序中的真实微信登录确认')
    if (!actor.roles.some(role => ADMIN_ROLES.includes(role))) throw new ForbiddenException('当前账号没有电脑管理后台权限')
  }
  private csrf(token: string) { return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update('admin-csrf:' + token).digest('hex') }

  async createChallenge(request: Request) {
    this.assertOrigin(request)
    const browserSecret = secret(), scanSecret = secret(), id = randomUUID()
    const expiresAt = new Date(Date.now() + LIFE)
    const old = this.cookie(request, 'login')
    const row = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(842601901)`
      if (await tx.adminLoginChallenge.count({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } } }) >= 120) {
        throw new HttpException('登录请求较多，请稍后再试', 429)
      }
      await tx.adminLoginChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400_000) } } })
      if (old) await tx.adminLoginChallenge.updateMany({ where: { browserHash: hashSecret(old), consumedAt: null }, data: { cancelledAt: new Date() } })
      return tx.adminLoginChallenge.create({ data: { id, browserHash: hashSecret(browserSecret), scanHash: hashSecret(scanSecret), expiresAt, browserLabel: (request.headers['user-agent'] || '电脑浏览器').slice(0, 200), confirmationCode: randomBytes(3).toString('hex').toUpperCase() } })
    })
    return { browserSecret, data: { id, expiresAt, confirmationCode: row.confirmationCode, qrPayload: `yanqing-admin:${id}:${scanSecret}`, qrImage: await QRCode.toDataURL(`yanqing-admin:${id}:${scanSecret}`, { width: 280, margin: 2, errorCorrectionLevel: 'M' }) } }
  }
  private async browserChallenge(id: string, token?: string) {
    if (!token) throw new UnauthorizedException('登录页面已失效，请刷新二维码')
    const row = await this.prisma.adminLoginChallenge.findUnique({ where: { id } })
    if (!row || !equal(row.browserHash, hashSecret(token))) throw new UnauthorizedException('登录页面已失效，请刷新二维码')
    return row
  }
  async challengeStatus(id: string, token?: string) {
    const row = await this.browserChallenge(id, token)
    const status = row.consumedAt ? 'USED' : row.cancelledAt ? 'CANCELLED' : row.expiresAt <= new Date() ? 'EXPIRED' : row.approvedById ? 'APPROVED' : 'WAITING'
    return { id: row.id, status, expiresAt: row.expiresAt }
  }
  async cancelChallenge(id: string, token?: string) {
    const row = await this.browserChallenge(id, token)
    await this.prisma.adminLoginChallenge.updateMany({ where: { id: row.id, consumedAt: null }, data: { cancelledAt: new Date() } })
    return { cancelled: true }
  }
  private async scanned(id: string, scanSecret: string) {
    const row = await this.prisma.adminLoginChallenge.findUnique({ where: { id } })
    if (!row || !equal(row.scanHash, hashSecret(scanSecret)) || row.expiresAt <= new Date() || row.consumedAt || row.cancelledAt) throw new BadRequestException('二维码已过期或失效，请在电脑上刷新')
    return row
  }
  async inspectChallenge(id: string, scanSecret: string, actor: AuthUser) {
    this.requireWechat(actor)
    const row = await this.scanned(id, scanSecret)
    return { id: row.id, confirmationCode: row.confirmationCode, origin: this.origin, browserLabel: row.browserLabel, expiresAt: row.expiresAt, roles: actor.roles.filter(role => ADMIN_ROLES.includes(role)), approved: Boolean(row.approvedById) }
  }
  async decide(id: string, scanSecret: string, actor: AuthUser, approve: boolean) {
    this.requireWechat(actor)
    await this.scanned(id, scanSecret)
    return this.prisma.$transaction(async tx => {
      this.actor(await tx.user.findUnique({ where: { id: actor.sub }, select: identitySelect }))
      const changed = await tx.adminLoginChallenge.updateMany({ where: { id, scanHash: hashSecret(scanSecret), approvedById: null, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: approve ? { approvedById: actor.sub, approvedAt: new Date() } : { cancelledAt: new Date() } })
      if (changed.count !== 1) throw new ConflictException('该登录请求已处理或过期')
      await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.roles[0], action: approve ? 'ADMIN_LOGIN_APPROVED' : 'ADMIN_LOGIN_REJECTED', objectType: 'AdminLogin', objectId: id, reason: '小程序用户确认电脑登录请求' } })
      return { approved: approve }
    })
  }
  async exchange(id: string, browserToken?: string) {
    const row = await this.browserChallenge(id, browserToken)
    const token = secret()
    const expiresAt = new Date(Date.now() + SESSION_LIFE)
    const result = await this.prisma.$transaction(async tx => {
      const changed = await tx.adminLoginChallenge.updateMany({ where: { id, browserHash: row.browserHash, approvedById: { not: null }, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } })
      if (changed.count !== 1) throw new ConflictException('尚未确认登录，或二维码已被使用')
      // Re-read after acquiring the row lock: approval may have committed after polling.
      const approved = await tx.adminLoginChallenge.findUniqueOrThrow({ where: { id } })
      const actor = this.actor(await tx.user.findUnique({ where: { id: approved.approvedById! }, select: identitySelect }))
      const session = await tx.adminBrowserSession.create({ data: { id: randomUUID(), userId: actor.sub, tokenHash: hashSecret(token), expiresAt, browserLabel: approved.browserLabel } })
      await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.roles[0], action: 'ADMIN_LOGIN_COMPLETED', objectType: 'AdminBrowserSession', objectId: session.id } })
      return { user: { id: actor.sub, displayName: actor.displayName, roles: actor.roles }, expiresAt, sessionId: session.id, csrfToken: this.csrf(token) }
    })
    return { token, data: result, maxAge: SESSION_LIFE }
  }
  private async session(token?: string) {
    if (!token) throw new UnauthorizedException('请先登录电脑管理后台')
    const row = await this.prisma.adminBrowserSession.findUnique({ where: { tokenHash: hashSecret(token) }, include: { user: { select: identitySelect } } })
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new UnauthorizedException('电脑登录已过期或撤销')
    return { row, actor: this.actor(row.user), csrfToken: this.csrf(token) }
  }
  async authenticate(request: Request): Promise<AuthUser> {
    if (request.headers.origin && request.headers.origin !== this.origin) throw new ForbiddenException('电脑会话仅可用于正式后台')
    const result = await this.session(this.cookie(request, 'session'))
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      this.assertOrigin(request)
      const csrf = request.headers['x-csrf-token']
      if (typeof csrf !== 'string' || !equal(csrf, result.csrfToken)) throw new ForbiddenException('页面校验已失效，请刷新后再试')
    }
    return { ...result.actor, loginMethod: 'admin', adminSessionId: result.row.id }
  }
  async sessionInfo(token?: string) {
    const { row, actor, csrfToken } = await this.session(token)
    return { user: { id: actor.sub, displayName: actor.displayName, roles: actor.roles }, expiresAt: row.expiresAt, sessionId: row.id, csrfToken }
  }
  async listSessions(actor: AuthUser) {
    return this.prisma.adminBrowserSession.findMany({ where: { userId: actor.sub, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, browserLabel: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' }, take: 50 })
  }
  async revoke(id: string, actor: AuthUser) {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.adminBrowserSession.updateMany({ where: { id, userId: actor.sub, revokedAt: null }, data: { revokedAt: new Date() } })
      if (changed.count) await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.roles[0], action: 'ADMIN_SESSION_REVOKED', objectType: 'AdminBrowserSession', objectId: id } })
      return { revoked: true }
    })
  }
}
