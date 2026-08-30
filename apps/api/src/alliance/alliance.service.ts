import { randomBytes } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { calculateRoi } from '@yanqing/shared'
import QRCode from 'qrcode'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  AppRole,
  CouponStatus,
  Prisma,
  ReconciliationPeriodStatus,
  SettlementStatus,
  UserStatus,
} from '../generated/prisma/client.js'
import type {
  AllianceSettlementDto,
  CreateCouponTemplateDto,
  CreateMerchantDto,
  GenerateCouponCodesDto,
  RedeemCouponDto,
  SettlementActionDto,
} from './alliance.dto.js'

const couponCode = (prefix: string) =>
  `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code

@Injectable()
export class AllianceService {
  constructor(private readonly prisma: PrismaService) {}

  async listMerchants(actor: AuthUser) {
    const isPrivileged = actor.roles.some((role) =>
      [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
    const isMerchantOnly = actor.roles.includes(AppRole.MERCHANT) && !isPrivileged
    const merchantIds = isMerchantOnly
      ? (await this.prisma.userRole.findMany({
          where: { userId: actor.sub, role: AppRole.MERCHANT },
          select: { merchantId: true },
        })).map((role) => role.merchantId).filter(Boolean) as string[]
      : undefined

    const where = isMerchantOnly
      ? { id: { in: merchantIds || [] } }
      : isPrivileged
        ? undefined
        : { status: UserStatus.ACTIVE }

    // Contact details and settlement rules are operational secrets.  Finance
    // and administrators need the complete merchant record; members, front
    // desk staff and a merchant account itself receive only the catalogue
    // fields and aggregate counters needed by their workbench.
    if (isPrivileged) {
      return this.prisma.merchant.findMany({
        where,
        include: { _count: { select: { couponTemplates: true, couponRedemptions: true } } },
        orderBy: { createdAt: 'desc' },
      })
    }
    return this.prisma.merchant.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        level: true,
        status: true,
        cooperationStartsAt: true,
        cooperationEndsAt: true,
        _count: { select: { couponTemplates: true, couponRedemptions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  createMerchant(dto: CreateMerchantDto) {
    return this.prisma.merchant.create({
      data: { ...dto, settlementRule: dto.settlementRule as never },
    })
  }

  createTemplate(dto: CreateCouponTemplateDto) {
    if (new Date(dto.validTo) <= new Date(dto.validFrom)) {
      throw new BadRequestException('券有效期设置无效')
    }
    return this.prisma.couponTemplate.create({
      data: {
        ...dto,
        validFrom: new Date(dto.validFrom),
        validTo: new Date(dto.validTo),
      },
    })
  }

  listMyCoupons(actor: AuthUser) {
    return this.prisma.couponCode.findMany({
      where: { holderId: actor.sub },
      include: { template: { include: { merchant: true } } },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
    })
  }

  async generateCodes(templateId: string, dto: GenerateCouponCodesDto, actor: AuthUser) {
    const ownedTemplate = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: { merchantId: true },
    })
    if (!ownedTemplate) throw new NotFoundException('券模板不存在')
    await this.assertMerchantAccess(ownedTemplate.merchantId, actor)

    return this.prisma.$transaction(
      async (tx) => {
        const template = await tx.couponTemplate.findUnique({ where: { id: templateId } })
        if (!template?.enabled) throw new NotFoundException('券模板不存在或已下线')
        if (template.issuedCount + dto.count > template.issueLimit) {
          throw new BadRequestException('生成数量超过模板发行上限')
        }
        const codes = Array.from({ length: dto.count }, () => ({
          templateId,
          code: couponCode(template.code),
          expiresAt: template.validTo,
        }))
        await tx.couponCode.createMany({ data: codes })
        await tx.couponTemplate.update({
          where: { id: templateId },
          data: { issuedCount: { increment: dto.count } },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'COUPON_CODES_GENERATED',
            objectType: 'CouponTemplate',
            objectId: templateId,
            newValue: { count: dto.count } as never,
          },
        })
        return { count: dto.count, codes: codes.map((item) => item.code) }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async claim(code: string, actor: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const coupon = await tx.couponCode.findUnique({
          where: { code },
          include: { template: true },
        })
        if (!coupon) {
          throw new ConflictException('券码不存在或已被领取')
        }
        // A repeated claim from the same member is a safe retry.  Do not
        // increment the template counter again; a different member still
        // receives the normal conflict response below.
        if (coupon.status !== CouponStatus.ISSUED) {
          if (coupon.status === CouponStatus.CLAIMED && coupon.holderId === actor.sub) return coupon
          throw new ConflictException('券码不存在或已被领取')
        }
        const now = new Date()
        if (!coupon.template.enabled || coupon.template.validFrom > now || coupon.template.validTo <= now) {
          throw new ConflictException('券活动未开始或已结束')
        }
        const claimed = await tx.couponCode.count({
          where: {
            templateId: coupon.templateId,
            holderId: actor.sub,
            status: { in: [CouponStatus.CLAIMED, CouponStatus.REDEEMED] },
          },
        })
        if (claimed >= coupon.template.claimLimitPerUser) throw new ConflictException('超过每人领取上限')
        // Claim is a one-time state transition.  Guard the write with the
        // observed ISSUED status so two members cannot both claim the same
        // code under a weaker transaction adapter.  Repeating the same claim
        // by the winning member is idempotent and does not increment counts.
        const changed = await tx.couponCode.updateMany({
          where: { id: coupon.id, status: CouponStatus.ISSUED },
          data: { status: CouponStatus.CLAIMED, holderId: actor.sub, claimedAt: now },
        })
        if (changed.count !== 1) {
          const latest = await tx.couponCode.findUnique({ where: { id: coupon.id } })
          if (latest?.status === CouponStatus.CLAIMED && latest.holderId === actor.sub) return latest
          throw new ConflictException('券码已被并发领取')
        }
        await tx.couponTemplate.update({
          where: { id: coupon.templateId },
          data: { claimedCount: { increment: 1 } },
        })
        return tx.couponCode.findUniqueOrThrow({ where: { id: coupon.id } })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async redeem(dto: RedeemCouponDto, actor: AuthUser) {
    await this.assertMerchantAccess(dto.merchantId, actor)
    const idempotent = await this.prisma.couponCode.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    })
    if (idempotent) {
      // An idempotency key identifies one concrete redemption command, not a
      // reusable read token.  Reusing it with another code, merchant or
      // amount must be visible as a conflict instead of silently returning
      // the first result.
      if (idempotent.code !== dto.code) {
        throw new ConflictException('券核销幂等键已用于其他券码')
      }
      if (idempotent.redeemedMerchantId !== dto.merchantId) {
        throw new ForbiddenException('券核销幂等键已用于其他商户')
      }
      if (idempotent.attributedAmountCents !== dto.attributedAmountCents) {
        throw new ConflictException('券核销幂等键已用于不同成交金额')
      }
      return idempotent
    }

    const preflight = await this.prisma.couponCode.findUnique({
      where: { code: dto.code },
      include: { template: true },
    })
    if (!preflight) throw new NotFoundException('券码不存在')
    if (preflight.status !== CouponStatus.CLAIMED) {
      await this.recordDuplicateRedemption(preflight)
      throw new ConflictException('券码未领取、已核销或已失效')
    }
    if (preflight.template.merchantId !== dto.merchantId) throw new ForbiddenException('券码不属于本商户')
    if (preflight.expiresAt <= new Date()) throw new ConflictException('券码已过期')

    try {
      return await this.prisma.$transaction(
        async (tx) => {
        const coupon = await tx.couponCode.findUnique({
          where: { code: dto.code },
          include: { template: true },
        })
        if (!coupon) throw new NotFoundException('券码不存在')
        if (coupon.status !== CouponStatus.CLAIMED) throw new ConflictException('券码已被并发核销')
        if (coupon.template.merchantId !== dto.merchantId) throw new ForbiddenException('券码不属于本商户')
        if (coupon.expiresAt <= new Date()) throw new ConflictException('券码已过期')
        const changed = await tx.couponCode.updateMany({
          where: { id: coupon.id, status: CouponStatus.CLAIMED },
          data: {
            status: CouponStatus.REDEEMED,
            redeemedById: actor.sub,
            redeemedMerchantId: dto.merchantId,
            redeemedAt: new Date(),
            attributedAmountCents: dto.attributedAmountCents,
            idempotencyKey: dto.idempotencyKey,
          },
        })
        if (changed.count !== 1) throw new ConflictException('券码已被并发核销')
        await tx.couponTemplate.update({
          where: { id: coupon.templateId },
          data: { redeemedCount: { increment: 1 } },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ALLIANCE_COUPON_REDEEMED',
            objectType: 'CouponCode',
            objectId: coupon.id,
            newValue: {
              merchantId: dto.merchantId,
              attributedAmountCents: dto.attributedAmountCents,
            } as never,
          },
        })
        return tx.couponCode.findUniqueOrThrow({ where: { id: coupon.id } })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (error instanceof ConflictException && error.message === '券码已被并发核销') {
        await this.recordDuplicateRedemption(preflight)
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.couponCode.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        })
        if (duplicate) {
          if (duplicate.code !== dto.code) throw new ConflictException('券核销幂等键已用于其他券码')
          if (duplicate.redeemedMerchantId !== dto.merchantId) throw new ForbiddenException('券核销幂等键已用于其他商户')
          if (duplicate.attributedAmountCents !== dto.attributedAmountCents) throw new ConflictException('券核销幂等键已用于不同成交金额')
          return duplicate
        }
      }
      throw error
    }
  }

  async qr(code: string, actor: AuthUser) {
    const coupon = await this.prisma.couponCode.findUnique({ where: { code }, include: { template: true } })
    if (!coupon) throw new NotFoundException('券码不存在')
    const staffRoles = new Set<AppRole>([AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN])
    if (coupon.holderId !== actor.sub && !actor.roles.some((role) => staffRoles.has(role))) {
      await this.assertMerchantAccess(coupon.template.merchantId, actor)
    }
    const svg = await QRCode.toString(`yanqing://alliance/coupon/${code}`, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    })
    return { code, svg }
  }

  async createSettlement(dto: AllianceSettlementDto, actor: AuthUser) {
    const periodStart = new Date(dto.periodStart)
    const periodEnd = new Date(dto.periodEnd)
    if (periodEnd <= periodStart) throw new BadRequestException('结算周期无效')
    const merchant = await this.prisma.merchant.findUnique({ where: { id: dto.merchantId } })
    if (!merchant) throw new NotFoundException('商户不存在')
    const codes = await this.prisma.couponCode.findMany({
      where: {
        template: { merchantId: dto.merchantId },
        createdAt: { lt: periodEnd },
        OR: [
          { redeemedAt: { gte: periodStart, lt: periodEnd } },
          { claimedAt: { gte: periodStart, lt: periodEnd } },
          { createdAt: { gte: periodStart, lt: periodEnd } },
        ],
      },
      include: { holder: { include: { memberProfile: true } } },
    })
    const issuedCount = codes.filter((code) => code.createdAt >= periodStart).length
    const claimedCount = codes.filter(
      (code) => code.claimedAt && code.claimedAt >= periodStart && code.claimedAt < periodEnd,
    ).length
    const redeemed = codes.filter(
      (code) => code.redeemedAt && code.redeemedAt >= periodStart && code.redeemedAt < periodEnd,
    )
    const effectiveNewCustomers = new Set(
      redeemed.filter((code) => code.holder?.memberProfile?.isNewCustomer).map((code) => code.holderId),
    ).size
    const attributedGmvCents = redeemed.reduce(
      (sum, code) => sum + code.attributedAmountCents,
      0,
    )
    const cooperationFeeCents = this.computeCooperationFee(
      merchant.settlementRule,
      redeemed.length,
      effectiveNewCustomers,
    )
    const roi = calculateRoi(dto.attributedGrossProfitCents, cooperationFeeCents)

    const uniqueWhere = {
      merchantId_periodStart_periodEnd: {
        merchantId: dto.merchantId,
        periodStart,
        periodEnd,
      },
    }
    const existing = await this.prisma.allianceSettlement.findUnique({ where: uniqueWhere })
    if (existing) {
      if (existing.attributedGrossProfitCents !== dto.attributedGrossProfitCents) {
        throw new ConflictException('该商户结算周期已生成，利润口径不同，请先提出调整申请')
      }
      return existing
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertSettlementPeriodOpen(tx, periodStart, periodEnd)
        const settlement = await tx.allianceSettlement.create({
          data: {
            merchantId: dto.merchantId,
            periodStart,
            periodEnd,
            issuedCount,
            claimedCount,
            redeemedCount: redeemed.length,
            effectiveNewCustomers,
            attributedGmvCents,
            attributedGrossProfitCents: dto.attributedGrossProfitCents,
            cooperationFeeCents,
            roi,
            status: SettlementStatus.DRAFT,
            detail: { codeIds: redeemed.map((code) => code.id), settlementRule: merchant.settlementRule },
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ALLIANCE_SETTLEMENT_CREATED',
            objectType: 'AllianceSettlement',
            objectId: settlement.id,
            newValue: { redeemedCount: redeemed.length, cooperationFeeCents, roi } as never,
          },
        })
        return settlement
      })
    } catch (error) {
      // A second worker can pass the preflight before the first one commits.
      // Resolve the composite unique-key race outside the failed transaction;
      // never catch a constraint error inside the transaction itself.
      if (isPrismaErrorCode(error, 'P2002')) {
        const duplicate = await this.prisma.allianceSettlement.findUnique({ where: uniqueWhere })
        if (duplicate) {
          if (duplicate.attributedGrossProfitCents !== dto.attributedGrossProfitCents) {
            throw new ConflictException('该商户结算周期已生成，利润口径不同，请先提出调整申请')
          }
          return duplicate
        }
      }
      throw error
    }
  }

  /**
   * Returns statements in the smallest data scope that is useful to the
   * caller.  A merchant can only see statements for merchant roles assigned
   * to the current account; finance and administrators see the full ledger.
   */
  async listSettlements(actor: AuthUser) {
    const privilegedRoles = new Set<AppRole>([AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN])
    const isMerchantOnly = actor.roles.includes(AppRole.MERCHANT) &&
      !actor.roles.some((role) => privilegedRoles.has(role))
    const merchantIds = isMerchantOnly
      ? (await this.prisma.userRole.findMany({
          where: { userId: actor.sub, role: AppRole.MERCHANT },
          select: { merchantId: true },
        })).map((role) => role.merchantId).filter(Boolean) as string[]
      : undefined

    return this.prisma.allianceSettlement.findMany({
      where: merchantIds ? { merchantId: { in: merchantIds } } : undefined,
      include: { merchant: { select: { id: true, name: true, code: true } } },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    })
  }

  /** Finance submits a calculated draft to the merchant for acknowledgement. */
  submitSettlement(id: string, actor: AuthUser) {
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.PENDING_CONFIRMATION,
      action: 'ALLIANCE_SETTLEMENT_SUBMITTED',
    })
  }

  /** The merchant acknowledges the statement before finance can settle it. */
  confirmSettlement(id: string, actor: AuthUser) {
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.CONFIRMED,
      action: 'ALLIANCE_SETTLEMENT_CONFIRMED',
      requireMerchantScope: true,
      data: { confirmedAt: new Date() },
    })
  }

  /**
   * A dispute returns the statement to DRAFT while retaining the reason and
   * actor in the statement detail/audit trail.  Totals are never overwritten
   * by this action; finance must create a new calculated version if needed.
   */
  async disputeSettlement(id: string, dto: SettlementActionDto, actor: AuthUser) {
    const reason = dto.reason?.trim()
    if (!reason) throw new BadRequestException('提出争议必须填写原因')
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.DRAFT,
      action: 'ALLIANCE_SETTLEMENT_DISPUTED',
      requireMerchantScope: true,
      reason,
    })
  }

  /** Finance posts the payable after merchant acknowledgement. */
  settleSettlement(id: string, actor: AuthUser) {
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.CONFIRMED,
      to: SettlementStatus.SETTLED,
      action: 'ALLIANCE_SETTLEMENT_SETTLED',
      data: { settledAt: new Date() },
    })
  }

  private async transitionSettlement(input: {
    id: string
    actor: AuthUser
    from: SettlementStatus
    to: SettlementStatus
    action: string
    data?: Record<string, unknown>
    reason?: string
    requireMerchantScope?: boolean
  }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.allianceSettlement.findUnique({ where: { id: input.id } })
      if (!current) throw new NotFoundException('联盟结算单不存在')
      if (input.requireMerchantScope) {
        await this.assertMerchantAccess(current.merchantId, input.actor)
      }
      // A retried request is safe and returns the already-posted state.  This
      // is important for mobile clients that retry after a weak-network
      // timeout.
      if (current.status === input.to) return current
      await this.assertSettlementPeriodOpen(tx, current.periodStart, current.periodEnd)
      if (current.status !== input.from) {
        throw new ConflictException(
          `联盟结算单当前状态为 ${current.status}，不能执行${input.action}`,
        )
      }

      const detail = this.withWorkflowDetail(current.detail, {
        state: input.to,
        action: input.action,
        reason: input.reason,
        actorId: input.actor.sub,
        at: new Date().toISOString(),
      })
      const changed = await tx.allianceSettlement.updateMany({
        where: { id: input.id, status: input.from },
        data: {
          status: input.to,
          detail: detail as never,
          ...input.data,
        },
      })
      if (changed.count !== 1) {
        const latest = await tx.allianceSettlement.findUnique({ where: { id: input.id } })
        if (latest?.status === input.to) return latest
        throw new ConflictException('联盟结算单已被其他操作更新，请刷新后重试')
      }
      const updated = await tx.allianceSettlement.findUniqueOrThrow({ where: { id: input.id } })
      await tx.auditLog.create({
        data: {
          actorId: input.actor.sub,
          actorRole: input.actor.roles[0],
          action: input.action,
          objectType: 'AllianceSettlement',
          objectId: input.id,
          oldValue: { status: input.from } as never,
          newValue: { status: input.to, reason: input.reason } as never,
          reason: input.reason,
        },
      })
      return updated
    })
  }

  private withWorkflowDetail(
    value: Prisma.JsonValue,
    workflow: Record<string, unknown>,
  ): Record<string, unknown> {
    const base = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
    const history = Array.isArray(base.workflowHistory) ? base.workflowHistory : []
    return {
      ...base,
      workflowState: workflow.state,
      workflowHistory: [...history, workflow],
    }
  }

  private async assertSettlementPeriodOpen(
    client: Pick<Prisma.TransactionClient, 'reconciliationPeriod'>,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const locked = await client.reconciliationPeriod.findFirst({
      where: {
        status: ReconciliationPeriodStatus.LOCKED,
        businessDate: {
          gte: this.shanghaiDayStart(periodStart),
          lt: periodEnd,
        },
      },
      select: { businessDate: true },
    })
    if (locked) {
      throw new ConflictException(
        `结算周期覆盖已锁账营业日 ${locked.businessDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}，请在当前开放账期提交调整单`,
      )
    }
  }

  private shanghaiDayStart(value: Date): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value)
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return new Date(`${fields.year}-${fields.month}-${fields.day}T00:00:00+08:00`)
  }

  private async assertMerchantAccess(merchantId: string, actor: AuthUser): Promise<void> {
    if (actor.roles.some((role) => [AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.FRONT_DESK].includes(role as never))) return
    const role = await this.prisma.userRole.findFirst({
      where: { userId: actor.sub, role: AppRole.MERCHANT, merchantId },
    })
    if (!role) throw new ForbiddenException('只能操作本商户的券码')
  }

  private recordDuplicateRedemption(coupon: { id: string; code: string; status: CouponStatus; holderId: string | null }) {
    return this.prisma.riskEvent.create({
      data: {
        ruleCode: 'COUPON_DUPLICATE_REDEEM',
        severity: 'HIGH',
        userId: coupon.holderId,
        objectType: 'CouponCode',
        objectId: coupon.id,
        summary: `券码 ${coupon.code} 在 ${coupon.status} 状态被再次核销`,
      },
    })
  }

  private computeCooperationFee(
    rule: Prisma.JsonValue,
    redeemedCount: number,
    effectiveNewCustomers: number,
  ): number {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return 0
    const mode = typeof rule.mode === 'string' ? rule.mode : 'NONE'
    const configuredAmount = typeof rule.amountCents === 'number' ? rule.amountCents : rule.feeCents
    const amount = typeof configuredAmount === 'number' ? Math.max(0, Math.round(configuredAmount)) : 0
    if (mode === 'FIXED') return amount
    if (mode === 'PER_REDEMPTION') return amount * redeemedCount
    if (mode === 'PER_NEW_CUSTOMER') return amount * effectiveNewCustomers
    return 0
  }
}
