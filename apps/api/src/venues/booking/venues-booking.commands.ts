import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BookingStatus,
  BusinessType,
  CouponStatus,
  CourtClosureStatus,
  CourtUsage,
  AppRole,
  Prisma,
  SlotPeriod,
  SubjectAccount,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { CreateVenueBookingDto } from '../venues.dto.js';
import {
  executeOrderCreation,
  isOrderCreationKeyViolation,
  type OrderCreationFields,
} from '../../orders/order-creation-idempotency.js';
import { orderResponse } from '../../orders/order-response.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from '../../operations/frontdesk-shift-gate.js';
import { resolveOperatingShareSnapshot } from '../../common/finance/operating-share.js';
import {
  orderNo,
  atMinutes,
  assertVenueDate,
  ASSISTED_BOOKING_ROLES,
  NEWCOMER_COUPON_PREFIX,
  NEWCOMER_ALLOWED_PERIODS_PARAMETER,
  DEFAULT_NEWCOMER_ALLOWED_PERIODS,
} from '../shared/venues-support.js';
import { resolvePrice } from '../shared/venues-policy.js';

export async function createBooking(
  prisma: PrismaService,
  dto: CreateVenueBookingDto,
  actor: AuthUser,
) {
  assertVenueDate(dto.date);
  const target = bookingTarget(dto, actor);
  if (dto.overrideReason !== undefined) {
    if (typeof dto.overrideReason !== 'string')
      throw new BadRequestException('特殊代订原因须为2-300字');
    if (
      !target.assisted ||
      !actor.roles.some((role) => ASSISTED_BOOKING_ROLES.has(role))
    )
      throw new ForbiddenException('仅前台或管理员代会员订场可使用特殊代订');
    if (
      dto.overrideReason.trim().length < 2 ||
      dto.overrideReason.trim().length > 300
    )
      throw new BadRequestException('特殊代订原因须为2-300字');
  }
  const order = await executeOrderCreation(prisma, {
    memberId: target.memberId,
    creationIdempotencyKey: dto.creationIdempotencyKey,
    command: {
      kind: 'VENUE_BOOKING',
      memberId: target.memberId,
      date: dto.date,
      courtId: dto.courtId,
      slotId: dto.slotId,
      sourceChannel: dto.sourceChannel,
      couponCode: dto.couponCode?.trim() || null,
      ...(dto.overrideReason
        ? { overrideReason: dto.overrideReason.trim() }
        : {}),
    },
    loadExisting: (id) =>
      prisma.order.findUniqueOrThrow({
        where: { id },
        include: { bookings: true, items: true },
      }),
    create: (creation) =>
      createBookingOnce(prisma, dto, actor, target, creation),
  });
  return orderResponse(order);
}

export async function createBookingOnce(
  prisma: PrismaService,
  dto: CreateVenueBookingDto,
  actor: AuthUser,
  target: { memberId: string; assisted: boolean },
  creation: OrderCreationFields,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        if (target.assisted) {
          const activeMember = await tx.user.findFirst(
            activeMemberQuery(target.memberId),
          );
          if (!activeMember)
            throw new NotFoundException('所选会员不存在、未建档或已停用');
        }

        const [court, slot, profile] = await Promise.all([
          tx.court.findUnique({ where: { id: dto.courtId } }),
          tx.timeSlot.findUnique({ where: { id: dto.slotId } }),
          tx.memberProfile.findUnique({
            where: { userId: target.memberId },
          }),
        ]);
        const operatorOverride = Boolean(dto.overrideReason);
        if (!court || !slot) throw new NotFoundException('场地或时段不存在');
        if (!operatorOverride && (!court.enabled || !slot.enabled))
          throw new NotFoundException('场地或时段不存在');
        if (!operatorOverride && court.usage === CourtUsage.MAINTENANCE)
          throw new ConflictException('场地维护中');
        if (!operatorOverride && court.usage === CourtUsage.TRAINING)
          throw new ConflictException('该场地为培训专用场，不能零售预订');
        if (
          !operatorOverride &&
          court.usage === CourtUsage.MEMBER_BLOCK &&
          !profile?.level
        ) {
          throw new ConflictException('该场地为会员预留场，请先完成会员建档');
        }

        await tx.$queryRaw`SELECT "id" FROM "Court" WHERE "id" = ${court.id} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "TimeSlot" WHERE "id" = ${slot.id} FOR SHARE`;
        const startsAt = atMinutes(dto.date, slot.startMinutes);
        const endsAt = atMinutes(dto.date, slot.endMinutes);
        if (!operatorOverride && startsAt <= new Date())
          throw new BadRequestException('不能预订已开始的时段');
        const price = await resolvePrice(
          prisma,
          slot.id,
          dto.date,
          slot.startMinutes,
          tx,
        );
        if (!price) throw new NotFoundException('该时段尚未配置价格');

        let payableCents = price.priceCents;
        let discountCents = 0;
        let couponId: string | undefined;
        let newcomerPolicy: {
          parameterId: string | null;
          allowedPeriods: SlotPeriod[];
        } | null = null;
        if (dto.couponCode) {
          const coupon = await tx.couponCode.findUnique({
            where: { code: dto.couponCode },
            include: {
              template: {
                include: { merchant: { select: { status: true } } },
              },
            },
          });
          const now = new Date();
          if (
            !coupon ||
            coupon.holderId !== target.memberId ||
            coupon.status !== CouponStatus.CLAIMED ||
            coupon.expiresAt <= now ||
            !coupon.template.enabled ||
            coupon.template.merchant.status !== UserStatus.ACTIVE ||
            coupon.template.validFrom > now ||
            coupon.template.validTo <= now
          ) {
            throw new BadRequestException('优惠券无效、已过期或不属于当前会员');
          }
          if (coupon.attributionOrderId)
            throw new ConflictException(
              '优惠券已用于待支付订场，请先完成或取消原订单',
            );
          couponId = coupon.id;
          if (coupon.template.code.startsWith(NEWCOMER_COUPON_PREFIX)) {
            newcomerPolicy = await resolveNewcomerAllowedPeriods(prisma, now);
            if (!newcomerPolicy.allowedPeriods.includes(slot.period)) {
              throw new ConflictException('新客体验权益仅限非黄金时段使用');
            }
            if (price.newcomerPriceCents === null) {
              throw new ConflictException('该时段未配置新客体验价');
            }
            payableCents = price.newcomerPriceCents;
          } else {
            if (!coupon.template.allowVenueBooking)
              throw new BadRequestException(
                '此券仅限所属商户消费，不可抵扣订场',
              );
            payableCents = Math.max(
              0,
              price.priceCents - coupon.template.faceValueCents,
            );
          }
          discountCents = price.priceCents - payableCents;
        }

        const shiftAuthorization = target.assisted
          ? await requireOpenFrontDeskShift(tx, actor)
          : null;
        const closure = await tx.courtClosure.findFirst({
          where: {
            courtId: court.id,
            status: CourtClosureStatus.ACTIVE,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true, startsAt: true, endsAt: true, reason: true },
        });
        if (closure && !operatorOverride)
          throw new ConflictException(`该时段已封场：${closure.reason}`);
        const conflict = await tx.courtBooking.findFirst({
          where: {
            courtId: court.id,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            status: { not: BookingStatus.CANCELLED },
          },
        });
        if (conflict && !operatorOverride)
          throw new ConflictException('该场地时段刚刚被预订');
        const operatingShare = await resolveOperatingShareSnapshot(
          tx,
          BusinessType.VENUE,
        );

        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo(),
            memberId: target.memberId,
            createdById: actor.sub,
            businessType: BusinessType.VENUE,
            subjectAccount: SubjectAccount.VENUE,
            sourceChannel: dto.sourceChannel,
            title: `${court.name} ${slot.label} 场地预订`,
            listAmountCents: price.priceCents,
            discountCents,
            payableCents,
            consumedCouponCode: dto.couponCode,
            parameterSnapshot: {
              ...(operatorOverride
                ? {
                    assistedBookingOverride: {
                      reason: dto.overrideReason!.trim(),
                      actorId: actor.sub,
                      past: startsAt <= new Date(),
                      courtEnabled: court.enabled,
                      courtUsage: court.usage,
                      slotEnabled: slot.enabled,
                      conflictingBookingId: conflict?.id ?? null,
                      closureId: closure?.id ?? null,
                    },
                  }
                : {}),
              priceRuleId: price.id,
              priceRuleCode: price.code,
              priceRuleVersion: price.version,
              priceRuleName: price.name,
              priceRuleEffectiveFrom: price.effectiveFrom.toISOString(),
              priceRuleEffectiveTo: price.effectiveTo?.toISOString() ?? null,
              priceRuleTimeSlotId: price.timeSlotId,
              priceRuleWeekdayMask: price.weekdayMask,
              priceCents: price.priceCents,
              newcomerPriceCents: price.newcomerPriceCents,
              courtCode: court.code,
              slotCode: slot.code,
              memberLevel: profile?.level,
              couponId,
              newcomerPolicy: newcomerPolicy
                ? {
                    allowedPeriodsParameterId: newcomerPolicy.parameterId,
                    allowedPeriods: newcomerPolicy.allowedPeriods,
                    slotPeriod: slot.period,
                  }
                : null,
              targetMemberId: target.memberId,
              createdById: actor.sub,
              operatorAssisted: target.assisted,
              operatorOverride,
              conflictingBookingId: operatorOverride ? conflict?.id : undefined,
              closureId: operatorOverride ? closure?.id : undefined,
              operatingShare,
            },
            items: {
              create: {
                itemType: 'COURT_SLOT',
                itemId: court.id,
                name: `${court.name} ${slot.label}`,
                unitPriceCents: price.priceCents,
                amountCents: price.priceCents,
                metadata: {
                  date: dto.date,
                  slotId: slot.id,
                  priceRuleCode: price.code,
                  priceRuleVersion: price.version,
                },
              },
            },
            bookings: {
              create: {
                courtId: court.id,
                memberId: target.memberId,
                status: BookingStatus.HELD,
                startsAt,
                endsAt,
                holdExpiresAt: new Date(Date.now() + 10 * 60_000),
                usage: CourtUsage.RETAIL,
                operatorOverride,
                overrideReason: operatorOverride
                  ? dto.overrideReason!.trim()
                  : null,
              },
            },
          },
          include: { bookings: true, items: true },
        });
        if (shiftAuthorization) {
          await auditAdminShiftBypass(
            tx,
            actor,
            shiftAuthorization,
            'ASSISTED_VENUE_BOOKING',
            'Order',
            created.id,
          );
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'VENUE_ORDER_CREATED',
            reason: operatorOverride ? dto.overrideReason!.trim() : undefined,
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              courtId: court.id,
              slotId: slot.id,
              startsAt,
              payableCents,
              memberId: target.memberId,
              createdById: actor.sub,
              operatorAssisted: target.assisted,
              operatorOverride,
              conflictingBookingId: operatorOverride ? conflict?.id : undefined,
              closureId: operatorOverride ? closure?.id : undefined,
              frontDeskShiftId:
                shiftAuthorization?.mode === 'OPEN_SHIFT'
                  ? shiftAuthorization.shiftId
                  : null,
              adminEmergencyBypass: shiftAuthorization?.mode === 'ADMIN_BYPASS',
            } as never,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    const failure = error as {
      code?: string;
      meta?: {
        code?: string;
        driverAdapterError?: { cause?: { originalCode?: string } };
      };
    };
    const sqlState =
      failure?.meta?.code ??
      failure?.meta?.driverAdapterError?.cause?.originalCode;
    if (
      failure?.code === 'P2010' &&
      ['40001', '40P01'].includes(sqlState ?? '')
    )
      throw new ConflictException('场地或时段刚刚更新，请刷新后重试');
    if (isOrderCreationKeyViolation(error)) throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('该场地时段已被占用');
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    ) {
      throw new ConflictException('该场地时段刚刚被其他操作占用，请刷新后重试');
    }
    throw error;
  }
}

export function bookingTarget(dto: CreateVenueBookingDto, actor: AuthUser) {
  const requestedMemberId = dto.memberId?.trim();
  const canAssist = actor.roles.some((role) =>
    ASSISTED_BOOKING_ROLES.has(role),
  );
  // A staff role grants the ability to assist; it does not change who owns
  // a personal mini-program booking. An explicit customer or store request
  // continues through the assisted-booking validation, shift and audit gates.
  const assisted =
    canAssist &&
    (Boolean(requestedMemberId) || dto.sourceChannel === 'STORE_VISIT');
  if (assisted) {
    if (!requestedMemberId)
      throw new BadRequestException('前台代客订场必须先选择会员');
    return { memberId: requestedMemberId, assisted: true };
  }
  if (!canAssist && !actor.roles.includes(AppRole.MEMBER)) {
    throw new ForbiddenException('仅会员本人或前台/管理员可创建场地订单');
  }
  if (requestedMemberId && requestedMemberId !== actor.sub) {
    throw new ForbiddenException('会员只能为本人预订场地');
  }
  return { memberId: actor.sub, assisted: false };
}

export function activeMemberQuery(memberId: string) {
  return {
    where: {
      id: memberId,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      memberProfile: { isNot: null },
    },
    select: { id: true },
  } as const;
}

export async function resolveNewcomerAllowedPeriods(
  prisma: PrismaService,
  at: Date,
): Promise<{ parameterId: string | null; allowedPeriods: SlotPeriod[] }> {
  const parameter = await prisma.systemParameter.findFirst({
    where: {
      key: NEWCOMER_ALLOWED_PERIODS_PARAMETER,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { id: true, value: true },
  });
  const configured = Array.isArray(parameter?.value)
    ? parameter.value.filter(
        (value): value is SlotPeriod =>
          typeof value === 'string' &&
          Object.values(SlotPeriod).includes(value as SlotPeriod),
      )
    : [];
  return {
    parameterId: parameter?.id ?? null,
    allowedPeriods: configured.length
      ? [...new Set(configured)]
      : [...DEFAULT_NEWCOMER_ALLOWED_PERIODS],
  };
}
