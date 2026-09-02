import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { PrismaService } from '../database/prisma.service.js'
import { AccountType, AppRole, UserStatus } from '../generated/prisma/enums.js'
import type { DevLoginDto, WechatLoginDto } from './auth.dto.js'

interface WechatSessionResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async wechatLogin(dto: WechatLoginDto) {
    const appId = this.config.get<string>('WECHAT_APP_ID')
    const secret = this.config.get<string>('WECHAT_APP_SECRET')
    if (!appId || !secret) throw new BadGatewayException('微信登录参数尚未配置')

    const query = new URLSearchParams({
      appid: appId,
      secret,
      js_code: dto.code,
      grant_type: 'authorization_code',
    })
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`)
    const session = (await response.json()) as WechatSessionResponse
    if (!response.ok || !session.openid || session.errcode) {
      throw new UnauthorizedException(session.errmsg ?? '微信登录失败')
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.user.upsert({
        where: { openId: session.openid },
        update: {
          unionId: session.unionid,
          displayName: dto.displayName || undefined,
          avatarUrl: dto.avatarUrl,
        },
        create: {
          openId: session.openid,
          unionId: session.unionid,
          displayName: dto.displayName || '微信用户',
          avatarUrl: dto.avatarUrl,
          primaryRole: AppRole.MEMBER,
          roles: { create: { role: AppRole.MEMBER } },
          memberProfile: { create: { tags: [] } },
        },
        include: { roles: true },
      })
      await Promise.all(
        Object.values(AccountType).map((type) =>
          tx.account.upsert({
            where: { userId_type: { userId: saved.id, type } },
            update: {},
            create: { userId: saved.id, type },
          }),
        ),
      )
      return saved
    })
    this.assertLoginAllowed(user)
    return this.issueToken(user)
  }

  async devLogin(dto: DevLoginDto) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException('生产环境禁用开发登录')
    }
    let user = dto.userId
      ? await this.prisma.user.findUnique({ where: { id: dto.userId }, include: { roles: true } })
      : await this.prisma.user.findFirst({
          where: { primaryRole: dto.role || AppRole.MEMBER },
          include: { roles: true },
          orderBy: { createdAt: 'asc' },
        })
    if (!user && dto.role) {
      user = await this.prisma.user.findFirst({
        where: { roles: { some: { role: dto.role } } },
        include: { roles: true },
        orderBy: { createdAt: 'asc' },
      })
    }
    if (!user) throw new UnauthorizedException('测试用户不存在或已停用')
    this.assertLoginAllowed(user)
    return this.issueToken(user)
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        primaryRole: true,
        referrerId: true,
        roles: {
          select: {
            role: true,
            merchant: { select: { id: true, name: true } },
          },
          orderBy: { role: 'asc' },
        },
        memberProfile: {
          select: {
            level: true,
            tags: true,
            membershipExpiresAt: true,
            isNewCustomer: true,
            firstVisitAt: true,
            lastVisitAt: true,
            visitCount: true,
          },
        },
        accounts: {
          select: {
            id: true,
            type: true,
            balance: true,
            frozenBalance: true,
          },
          orderBy: { type: 'asc' },
        },
      },
    })
    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      primaryRole: user.primaryRole,
      roles: user.roles,
      memberProfile: user.memberProfile,
      accounts: user.accounts,
      hasReferrer: Boolean(user.referrerId),
    }
  }

  private async issueToken(user: {
    id: string
    displayName: string
    primaryRole: AppRole
    roles: { role: AppRole }[]
  }) {
    const roles = [...new Set([user.primaryRole, ...user.roles.map((item) => item.role)])]
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      roles,
      displayName: user.displayName,
    })
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '7d'),
      user: { id: user.id, displayName: user.displayName, roles },
    }
  }

  private assertLoginAllowed(user: { status: UserStatus; deletedAt: Date | null }) {
    if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new UnauthorizedException('用户不存在、已停用或已删除')
    }
  }
}
