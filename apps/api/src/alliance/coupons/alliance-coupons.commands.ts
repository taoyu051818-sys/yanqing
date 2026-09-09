import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import QRCode from 'qrcode';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  CouponStatus,
  Prisma,
  UserStatus,
} from '../../generated/prisma/client.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from '../../operations/frontdesk-shift-gate.js';
import type {
  GenerateCouponCodesDto,
  RedeemCouponDto,
} from '../alliance.dto.js';
import {
  isPrismaErrorCode,
  lifecycleCommandHash,
  couponBatchCode,
  NEWCOMER_COUPON_PREFIX,
  NEWCOMER_VALIDITY_PARAMETER,
  DEFAULT_NEWCOMER_VALIDITY_DAYS,
  couponRedemptionResponse,
} from '../shared/alliance-support.js';
import {
  assertMerchantAccess,
  allianceRequestId,
  assertAllianceCommandReplay,
} from '../shared/alliance-policy.js';

export async function listMyCoupons(prisma: PrismaService, actor: AuthUser) {
  const coupons = await prisma.couponCode.findMany({
    where: { holderId: actor.sub },
    // A member only needs the benefit and public partner identity.  Never
    // serialize the merchant contact or settlement rule through the nested
    // template relation: that would bypass the redaction in listMerchants.
    select: {
      id: true,
      templateId: true,
      code: true,
      status: true,
      holderId: true,
      attributionOrderId: true,
      claimedAt: true,
      redeemedAt: true,
      expiresAt: true,
      attributedAmountCents: true,
      createdAt: true,
      updatedAt: true,
      template: {
        select: {
          id: true,
          code: true,
          name: true,
          activityName: true,
          benefitDescription: true,
          faceValueCents: true,
          allowVenueBooking: true,
          validFrom: true,
          validTo: true,
          enabled: true,
          merchant: {
            select: {
              id: true,
              code: true,
              name: true,
              category: true,
              level: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
  });
  const now = new Date();
  return coupons.map((coupon) => {
    const template = coupon.template;
    const newcomer = template.code.startsWith('NEWCOMER');
    const reason =
      coupon.status !== 'CLAIMED'
        ? '此券不在可使用状态'
        : coupon.attributionOrderId
          ? '此券已用于待支付订场，请在订单页完成付款或取消订单'
          : coupon.expiresAt <= now || template.validTo <= now
            ? '此券已过期'
            : !template.enabled || template.merchant.status !== 'ACTIVE'
              ? '券活动或商户已暂停'
              : template.validFrom > now
                ? '尚未到使用时间'
                : !newcomer && !template.allowVenueBooking
                  ? '仅限所属商户消费，不可抵扣订场'
                  : '';
    const { attributionOrderId: _reservation, ...view } = coupon;
    return {
      ...view,
      bookingUsage: {
        eligible: !reason,
        reason,
        label: newcomer
          ? '新客体验订场（限适用时段）'
          : template.allowVenueBooking
            ? '商户消费 / 订场抵扣'
            : '仅限所属商户消费',
      },
    };
  });
}

export async function generateCodes(
  prisma: PrismaService,
  templateId: string,
  dto: GenerateCouponCodesDto,
  actor: AuthUser,
) {
  const requestId = allianceRequestId(dto.idempotencyKey);
  const action = 'COUPON_CODES_GENERATED';
  const commandHash = lifecycleCommandHash({
    kind: action,
    templateId,
    count: dto.count,
  });
  const ownedTemplate = await prisma.couponTemplate.findUnique({
    where: { id: templateId },
    select: {
      merchantId: true,
      enabled: true,
      validTo: true,
      merchant: { select: { status: true } },
    },
  });
  if (!ownedTemplate) throw new NotFoundException('券模板不存在');
  await assertMerchantAccess(
    prisma,
    ownedTemplate.merchantId,
    actor,
    '只能操作本商户的券码',
  );
  const replay = await prisma.auditLog.findFirst({
    where: { requestId },
    select: {
      actorId: true,
      action: true,
      objectType: true,
      objectId: true,
      newValue: true,
    },
  });
  if (replay) {
    return couponBatchReplay(replay, {
      actor,
      action,
      objectType: 'CouponTemplate',
      objectId: templateId,
      commandHash,
      count: dto.count,
    });
  }
  if (!ownedTemplate.enabled) throw new ConflictException('券模板已下线');
  if (ownedTemplate.merchant.status !== UserStatus.ACTIVE)
    throw new ConflictException('商户已停用');
  if (ownedTemplate.validTo <= new Date())
    throw new ConflictException('券模板已过期');

  try {
    return await prisma.$transaction(
      async (tx) => {
        const committed = await tx.auditLog.findFirst({
          where: { requestId },
          select: {
            actorId: true,
            action: true,
            objectType: true,
            objectId: true,
            newValue: true,
          },
        });
        if (committed) {
          return couponBatchReplay(committed, {
            actor,
            action,
            objectType: 'CouponTemplate',
            objectId: templateId,
            commandHash,
            count: dto.count,
          });
        }
        const template = await tx.couponTemplate.findUnique({
          where: { id: templateId },
          include: { merchant: { select: { status: true } } },
        });
        if (!template?.enabled)
          throw new NotFoundException('券模板不存在或已下线');
        if (template.merchant.status !== UserStatus.ACTIVE)
          throw new ConflictException('商户已停用');
        if (template.validTo <= new Date())
          throw new ConflictException('券模板已过期');
        if (template.issuedCount + dto.count > template.issueLimit) {
          throw new BadRequestException('生成数量超过模板发行上限');
        }
        const codes = Array.from({ length: dto.count }, (_, index) => ({
          templateId,
          code: couponBatchCode(requestId, index),
          expiresAt: template.validTo,
        }));
        await tx.couponCode.createMany({ data: codes });
        const changed = await tx.couponTemplate.updateMany({
          where: {
            id: templateId,
            enabled: true,
            issuedCount: template.issuedCount,
            updatedAt: template.updatedAt,
          },
          data: { issuedCount: { increment: dto.count } },
        });
        if (changed.count !== 1)
          throw new ConflictException('券模板发行额度已由其他操作更新');
        const generatedCodes = codes.map((item) => item.code);
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action,
            objectType: 'CouponTemplate',
            objectId: templateId,
            newValue: {
              commandHash,
              count: dto.count,
              codes: generatedCodes,
            } as never,
            requestId,
          },
        });
        return { count: dto.count, codes: generatedCodes };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      !isPrismaErrorCode(error, 'P2002') &&
      !isPrismaErrorCode(error, 'P2034')
    )
      throw error;
    const committed = await prisma.auditLog.findFirst({
      where: { requestId },
      select: {
        actorId: true,
        action: true,
        objectType: true,
        objectId: true,
        newValue: true,
      },
    });
    if (committed) {
      return couponBatchReplay(committed, {
        actor,
        action,
        objectType: 'CouponTemplate',
        objectId: templateId,
        commandHash,
        count: dto.count,
      });
    }
    throw new ConflictException('发行命令与已有券码冲突，请刷新后重试');
  }
}

export async function claim(
  prisma: PrismaService,
  code: string,
  actor: AuthUser,
) {
  return prisma.$transaction(
    async (tx) => {
      const coupon = await tx.couponCode.findUnique({
        where: { code },
        include: {
          template: { include: { merchant: { select: { status: true } } } },
        },
      });
      if (!coupon) {
        throw new ConflictException('券码不存在或已被领取');
      }
      // A repeated claim from the same member is a safe retry.  Do not
      // increment the template counter again; a different member still
      // receives the normal conflict response below.
      if (coupon.status !== CouponStatus.ISSUED) {
        if (
          coupon.status === CouponStatus.CLAIMED &&
          coupon.holderId === actor.sub
        )
          return coupon;
        throw new ConflictException('券码不存在或已被领取');
      }
      const now = new Date();
      if (
        !coupon.template.enabled ||
        coupon.template.merchant.status !== UserStatus.ACTIVE ||
        coupon.template.validFrom > now ||
        coupon.template.validTo <= now
      ) {
        throw new ConflictException('券活动未开始或已结束');
      }
      const newcomer = coupon.template.code.startsWith(NEWCOMER_COUPON_PREFIX);
      if (newcomer) {
        const profile = await tx.memberProfile.findUnique({
          where: { userId: actor.sub },
          select: { isNewCustomer: true },
        });
        if (!profile?.isNewCustomer)
          throw new ConflictException('新客体验权益仅限新客领取');
        const priorNewcomerCoupon = await tx.couponCode.findFirst({
          where: {
            holderId: actor.sub,
            id: { not: coupon.id },
            status: { in: [CouponStatus.CLAIMED, CouponStatus.REDEEMED] },
            template: { code: { startsWith: NEWCOMER_COUPON_PREFIX } },
          },
          select: { id: true },
        });
        if (priorNewcomerCoupon)
          throw new ConflictException('新客体验权益每人仅限一次');
      }
      const claimed = await tx.couponCode.count({
        where: {
          templateId: coupon.templateId,
          holderId: actor.sub,
          status: { in: [CouponStatus.CLAIMED, CouponStatus.REDEEMED] },
        },
      });
      if (claimed >= coupon.template.claimLimitPerUser)
        throw new ConflictException('超过每人领取上限');
      // Claim is a one-time state transition.  Guard the write with the
      // observed ISSUED status so two members cannot both claim the same
      // code under a weaker transaction adapter.  Repeating the same claim
      // by the winning member is idempotent and does not increment counts.
      const newcomerValidity = newcomer
        ? await resolveNewcomerValidity(tx, now)
        : null;
      const claimExpiresAt = newcomerValidity
        ? new Date(
            Math.min(
              coupon.expiresAt.getTime(),
              coupon.template.validTo.getTime(),
              now.getTime() + newcomerValidity.days * 86_400_000,
            ),
          )
        : coupon.expiresAt;
      const changed = await tx.couponCode.updateMany({
        where: { id: coupon.id, status: CouponStatus.ISSUED },
        data: {
          status: CouponStatus.CLAIMED,
          holderId: actor.sub,
          claimedAt: now,
          expiresAt: claimExpiresAt,
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.couponCode.findUnique({
          where: { id: coupon.id },
        });
        if (
          latest?.status === CouponStatus.CLAIMED &&
          latest.holderId === actor.sub
        )
          return latest;
        throw new ConflictException('券码已被并发领取');
      }
      await tx.couponTemplate.update({
        where: { id: coupon.templateId },
        data: { claimedCount: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'ALLIANCE_COUPON_CLAIMED',
          objectType: 'CouponCode',
          objectId: coupon.id,
          newValue: {
            templateId: coupon.templateId,
            newcomer,
            claimedAt: now.toISOString(),
            expiresAt: claimExpiresAt.toISOString(),
            validityParameterId: newcomerValidity?.parameterId ?? null,
            validityDays: newcomerValidity?.days ?? null,
          } as never,
        },
      });
      return tx.couponCode.findUniqueOrThrow({ where: { id: coupon.id } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function redeem(
  prisma: PrismaService,
  dto: RedeemCouponDto,
  actor: AuthUser,
) {
  await assertRedemptionAccess(prisma, dto.merchantId, actor);
  const idempotent = await prisma.couponCode.findUnique({
    where: { idempotencyKey: dto.idempotencyKey },
  });
  if (idempotent) {
    // An idempotency key identifies one concrete redemption command, not a
    // reusable read token.  Reusing it with another code, merchant or
    // amount must be visible as a conflict instead of silently returning
    // the first result.
    if (idempotent.code !== dto.code) {
      throw new ConflictException('券核销幂等键已用于其他券码');
    }
    if (idempotent.redeemedMerchantId !== dto.merchantId) {
      throw new ForbiddenException('券核销幂等键已用于其他商户');
    }
    if (idempotent.attributedAmountCents !== dto.attributedAmountCents) {
      throw new ConflictException('券核销幂等键已用于不同成交金额');
    }
    return couponRedemptionResponse(idempotent);
  }

  const redeemMerchant = await prisma.merchant.findUnique({
    where: { id: dto.merchantId },
    select: { status: true },
  });
  if (!redeemMerchant) throw new NotFoundException('商户不存在');
  if (redeemMerchant.status !== UserStatus.ACTIVE)
    throw new ConflictException('商户已停用，不能核销券码');

  const preflight = await prisma.couponCode.findUnique({
    where: { code: dto.code },
    include: { template: true },
  });
  if (!preflight) throw new NotFoundException('券码不存在');
  if (preflight.status !== CouponStatus.CLAIMED) {
    await recordDuplicateRedemption(prisma, preflight);
    throw new ConflictException('券码未领取、已核销或已失效');
  }
  if (preflight.attributionOrderId)
    throw new ConflictException('券码已用于待支付订场，请先取消原订单');
  if (preflight.template.merchantId !== dto.merchantId)
    throw new ForbiddenException('券码不属于本商户');
  if (preflight.expiresAt <= new Date())
    throw new ConflictException('券码已过期');

  try {
    return await prisma.$transaction(
      async (tx) => {
        const coupon = await tx.couponCode.findUnique({
          where: { code: dto.code },
          include: { template: true },
        });
        // Hold a shared row lock until redemption commits. Status changes
        // acquire a conflicting update lock on this same merchant row.
        await tx.$queryRaw`SELECT "id" FROM "Merchant" WHERE "id" = ${dto.merchantId} FOR SHARE`;
        const currentMerchant = await tx.merchant.findUnique({
          where: { id: dto.merchantId },
          select: { status: true },
        });
        if (!currentMerchant) throw new NotFoundException('商户不存在');
        if (currentMerchant.status !== UserStatus.ACTIVE)
          throw new ConflictException('商户已停用，不能核销券码');
        if (!coupon) throw new NotFoundException('券码不存在');
        if (coupon.status !== CouponStatus.CLAIMED)
          throw new ConflictException('券码已被并发核销');
        if (coupon.attributionOrderId)
          throw new ConflictException('券码已用于待支付订场，请先取消原订单');
        if (coupon.template.merchantId !== dto.merchantId)
          throw new ForbiddenException('券码不属于本商户');
        if (coupon.expiresAt <= new Date())
          throw new ConflictException('券码已过期');
        // A venue front-desk redemption is a shift-bound cash-desk action.
        // Pure merchant operators redeem against their own independent till
        // and therefore do not participate in the venue shift lifecycle.
        const isVenueOperator = actor.roles.some((role) =>
          [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
            role as never,
          ),
        );
        const shiftAuthorization = isVenueOperator
          ? await requireOpenFrontDeskShift(tx, actor)
          : null;
        const changed = await tx.couponCode.updateMany({
          where: {
            id: coupon.id,
            status: CouponStatus.CLAIMED,
            attributionOrderId: null,
          },
          data: {
            status: CouponStatus.REDEEMED,
            redeemedById: actor.sub,
            redeemedMerchantId: dto.merchantId,
            redeemedAt: new Date(),
            attributedAmountCents: dto.attributedAmountCents,
            idempotencyKey: dto.idempotencyKey,
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('券码已被并发核销');
        await tx.couponTemplate.update({
          where: { id: coupon.templateId },
          data: { redeemedCount: { increment: 1 } },
        });
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
              frontDeskShiftId: shiftAuthorization?.shiftId ?? null,
              adminEmergencyBypass: shiftAuthorization?.mode === 'ADMIN_BYPASS',
            } as never,
          },
        });
        if (shiftAuthorization) {
          await auditAdminShiftBypass(
            tx,
            actor,
            shiftAuthorization,
            'ALLIANCE_COUPON_REDEEM',
            'CouponCode',
            coupon.id,
          );
        }
        return couponRedemptionResponse(
          await tx.couponCode.findUniqueOrThrow({ where: { id: coupon.id } }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof ConflictException &&
      error.message === '券码已被并发核销'
    ) {
      await recordDuplicateRedemption(prisma, preflight);
    }
    if (
      isPrismaErrorCode(error, 'P2002') ||
      isPrismaErrorCode(error, 'P2034')
    ) {
      const duplicate = await prisma.couponCode.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (duplicate) {
        if (duplicate.code !== dto.code)
          throw new ConflictException('券核销幂等键已用于其他券码');
        if (duplicate.redeemedMerchantId !== dto.merchantId)
          throw new ForbiddenException('券核销幂等键已用于其他商户');
        if (duplicate.attributedAmountCents !== dto.attributedAmountCents)
          throw new ConflictException('券核销幂等键已用于不同成交金额');
        return couponRedemptionResponse(duplicate);
      }
      throw new ConflictException(
        '商户或券码状态刚刚发生变化，请使用原幂等键重试',
      );
    }
    throw error;
  }
}

export async function qr(prisma: PrismaService, code: string, actor: AuthUser) {
  const coupon = await prisma.couponCode.findUnique({
    where: { code },
    include: { template: true },
  });
  if (!coupon) throw new NotFoundException('券码不存在');
  const staffRoles = new Set<AppRole>([
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ]);
  if (
    coupon.holderId !== actor.sub &&
    !actor.roles.some((role) => staffRoles.has(role))
  ) {
    await assertMerchantAccess(prisma, coupon.template.merchantId, actor);
  }
  const svg = await QRCode.toString(`yanqing://alliance/coupon/${code}`, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  return { code, svg };
}

export async function assertRedemptionAccess(
  prisma: PrismaService,
  merchantId: string,
  actor: AuthUser,
): Promise<void> {
  if (actor.roles.includes(AppRole.FRONT_DESK)) return;
  await assertMerchantAccess(prisma, merchantId, actor, '只能操作本商户的券码');
}

export function couponBatchReplay(
  replay: {
    actorId: string | null;
    action: string;
    objectType: string;
    objectId: string | null;
    newValue: Prisma.JsonValue;
  },
  expected: {
    actor: AuthUser;
    action: string;
    objectType: string;
    objectId: string;
    commandHash: string;
    count: number;
  },
) {
  assertAllianceCommandReplay(replay, expected);
  const newValue =
    replay.newValue &&
    typeof replay.newValue === 'object' &&
    !Array.isArray(replay.newValue)
      ? (replay.newValue as Record<string, unknown>)
      : {};
  const codes = Array.isArray(newValue.codes)
    ? newValue.codes.filter((code): code is string => typeof code === 'string')
    : [];
  if (newValue.count !== expected.count || codes.length !== expected.count) {
    throw new ConflictException('发行命令回放数据不完整，请联系管理员');
  }
  return { count: expected.count, codes };
}

export function recordDuplicateRedemption(
  prisma: PrismaService,
  coupon: {
    id: string;
    code: string;
    status: CouponStatus;
    holderId: string | null;
  },
) {
  return prisma.riskEvent.create({
    data: {
      ruleCode: 'COUPON_DUPLICATE_REDEEM',
      severity: 'HIGH',
      userId: coupon.holderId,
      objectType: 'CouponCode',
      objectId: coupon.id,
      summary: `券码 ${coupon.code} 在 ${coupon.status} 状态被再次核销`,
    },
  });
}

export async function resolveNewcomerValidity(
  tx: Prisma.TransactionClient,
  at: Date,
): Promise<{ parameterId: string | null; days: number }> {
  const parameter = await tx.systemParameter.findFirst({
    where: {
      key: NEWCOMER_VALIDITY_PARAMETER,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { id: true, value: true },
  });
  const configured =
    typeof parameter?.value === 'number'
      ? parameter.value
      : Number(parameter?.value);
  const days = Number.isFinite(configured)
    ? Math.min(30, Math.max(1, Math.round(configured)))
    : DEFAULT_NEWCOMER_VALIDITY_DAYS;
  return { parameterId: parameter?.id ?? null, days };
}
