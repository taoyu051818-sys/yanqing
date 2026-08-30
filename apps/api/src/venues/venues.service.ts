import { randomBytes } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  BookingStatus,
  BusinessType,
  CouponStatus,
  CourtClosureStatus,
  CourtUsage,
  AppRole,
  OrderStatus,
  Prisma,
  SubjectAccount,
  UserStatus,
} from '../generated/prisma/client.js'
import type {
  CancelCourtClosureDto,
  CreateCourtClosureDto,
  CreatePriceRuleDto,
  CreateVenueBookingDto,
  ListCourtClosuresQueryDto,
  UpdateCourtDto,
} from './venues.dto.js'
import {
  executeOrderCreation,
  isOrderCreationKeyViolation,
  type OrderCreationFields,
} from '../orders/order-creation-idempotency.js'
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from '../operations/frontdesk-shift-gate.js'

const orderNo = () =>
  `VN${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`

const atMinutes = (date: string, minutes: number): Date => {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mins = String(minutes % 60).padStart(2, '0')
  return new Date(`${date}T${hours}:${mins}:00+08:00`)
}

const ASSISTED_BOOKING_ROLES = new Set<AppRole>([
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
])

const CLOSURE_READ_ROLES: AppRole[] = [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]
const CLOSURE_WRITE_ROLES: AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN]

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async availability(date: string) {
    await this.releaseExpiredHolds()
    const dayStart = atMinutes(date, 0)
    const dayEnd = atMinutes(date, 24 * 60)
    const [courts, slots, bookings, closures] = await Promise.all([
      this.prisma.court.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.timeSlot.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.courtBooking.findMany({
        where: {
          startsAt: { gte: dayStart, lt: dayEnd },
          status: { not: BookingStatus.CANCELLED },
        },
        select: { courtId: true, startsAt: true, endsAt: true, status: true, usage: true },
      }),
      this.prisma.courtClosure.findMany({
        where: {
          status: CourtClosureStatus.ACTIVE,
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: {
          id: true,
          courtId: true,
          startsAt: true,
          endsAt: true,
          reason: true,
          status: true,
        },
        orderBy: [{ startsAt: 'asc' }, { courtId: 'asc' }],
      }),
    ])
    const prices = await Promise.all(slots.map((slot) => this.resolvePrice(slot.id, date)))
    return {
      date,
      courts,
      slots: slots.map((slot, index) => ({ ...slot, price: prices[index] })),
      bookings,
      closures,
    }
  }

  async listClosures(query: ListCourtClosuresQueryDto, actor: AuthUser) {
    this.assertClosureRole(actor, CLOSURE_READ_ROLES, '仅前台或管理员可查看封场日历')
    const from = query.from ? new Date(query.from) : undefined
    const to = query.to ? new Date(query.to) : undefined
    if (from && to && from >= to) throw new BadRequestException('查询结束时间必须晚于开始时间')
    return this.prisma.courtClosure.findMany({
      where: {
        ...(query.courtId ? { courtId: query.courtId.trim() } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(to ? { startsAt: { lt: to } } : {}),
        ...(from ? { endsAt: { gt: from } } : {}),
      },
      include: {
        court: { select: { id: true, code: true, name: true, enabled: true } },
        createdBy: { select: { id: true, displayName: true } },
        cancelledBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async createClosure(dto: CreateCourtClosureDto, actor: AuthUser) {
    this.assertClosureRole(actor, CLOSURE_WRITE_ROLES, '仅管理员可创建封场计划')
    const command = this.closureCommand(dto)
    const replay = await this.prisma.courtClosure.findUnique({
      where: { creationIdempotencyKey: command.creationIdempotencyKey },
      include: { court: true, createdBy: true, cancelledBy: true },
    })
    if (replay) return this.assertClosureReplay(replay, command, actor)

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const court = await tx.court.findUnique({
            where: { id: command.courtId },
            select: { id: true, code: true, name: true },
          })
          if (!court) throw new NotFoundException('场地不存在')

          const overlappingClosure = await tx.courtClosure.findFirst({
            where: {
              courtId: command.courtId,
              status: CourtClosureStatus.ACTIVE,
              startsAt: { lt: command.endsAt },
              endsAt: { gt: command.startsAt },
            },
            select: { id: true, startsAt: true, endsAt: true, reason: true },
            orderBy: { startsAt: 'asc' },
          })
          if (overlappingClosure) {
            throw new ConflictException(
              `该场地已有重叠封场：${overlappingClosure.startsAt.toISOString()} 至 ${overlappingClosure.endsAt.toISOString()}（${overlappingClosure.reason}）`,
            )
          }

          const bookingCutoff = command.startsAt > new Date() ? command.startsAt : new Date()
          const blockingBookingWhere: Prisma.CourtBookingWhereInput = {
            courtId: command.courtId,
            status: { not: BookingStatus.CANCELLED },
            startsAt: { lt: command.endsAt },
            endsAt: { gt: bookingCutoff },
          }
          const blockingBookingCount = await tx.courtBooking.count({ where: blockingBookingWhere })
          if (blockingBookingCount) {
            const blockingBookings = await tx.courtBooking.findMany({
              where: blockingBookingWhere,
              select: { id: true, orderId: true, status: true, startsAt: true, endsAt: true },
              orderBy: { startsAt: 'asc' },
              take: 20,
            })
            const details = blockingBookings
              .map((booking) => `${booking.startsAt.toISOString()}~${booking.endsAt.toISOString()}[${booking.orderId ?? booking.id}]`)
              .join('；')
            const remainder = blockingBookingCount > blockingBookings.length
              ? `；另有 ${blockingBookingCount - blockingBookings.length} 笔未展开`
              : ''
            throw new ConflictException(
              `封场范围内已有 ${blockingBookingCount} 笔未取消预约，需先逐笔处理，系统不会自动取消或退款：${details}${remainder}`,
            )
          }

          const created = await tx.courtClosure.create({
            data: {
              courtId: command.courtId,
              startsAt: command.startsAt,
              endsAt: command.endsAt,
              reason: command.reason,
              creationIdempotencyKey: command.creationIdempotencyKey,
              createdById: actor.sub,
            },
            include: { court: true, createdBy: true, cancelledBy: true },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: this.closureAuditRole(actor),
              action: 'COURT_CLOSURE_CREATED',
              objectType: 'CourtClosure',
              objectId: created.id,
              newValue: {
                courtId: created.courtId,
                startsAt: created.startsAt,
                endsAt: created.endsAt,
                reason: created.reason,
                status: created.status,
              } as never,
            },
          })
          return created
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.prisma.courtClosure.findUnique({
          where: { creationIdempotencyKey: command.creationIdempotencyKey },
          include: { court: true, createdBy: true, cancelledBy: true },
        })
        if (concurrent) return this.assertClosureReplay(concurrent, command, actor)
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('封场范围刚刚发生预约或封场变更，请刷新日历后重试')
      }
      throw error
    }
  }

  async cancelClosure(id: string, dto: CancelCourtClosureDto, actor: AuthUser) {
    this.assertClosureRole(actor, CLOSURE_WRITE_ROLES, '仅管理员可取消封场计划')
    return this.prisma.$transaction(
      async (tx) => {
        const before = await tx.courtClosure.findUnique({
          where: { id },
          include: { court: true, createdBy: true, cancelledBy: true },
        })
        if (!before) throw new NotFoundException('封场记录不存在')
        if (before.status === CourtClosureStatus.CANCELLED) return before

        const cancelledAt = new Date()
        const changed = await tx.courtClosure.updateMany({
          where: { id, status: CourtClosureStatus.ACTIVE },
          data: {
            status: CourtClosureStatus.CANCELLED,
            cancelledById: actor.sub,
            cancelledAt,
            cancelReason: dto.reason.trim(),
          },
        })
        if (changed.count !== 1) {
          const latest = await tx.courtClosure.findUnique({
            where: { id },
            include: { court: true, createdBy: true, cancelledBy: true },
          })
          if (latest?.status === CourtClosureStatus.CANCELLED) return latest
          throw new ConflictException('封场状态已被其他操作更新，请刷新后重试')
        }
        const after = await tx.courtClosure.findUniqueOrThrow({
          where: { id },
          include: { court: true, createdBy: true, cancelledBy: true },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: this.closureAuditRole(actor),
            action: 'COURT_CLOSURE_CANCELLED',
            objectType: 'CourtClosure',
            objectId: id,
            oldValue: {
              status: before.status,
              courtId: before.courtId,
              startsAt: before.startsAt,
              endsAt: before.endsAt,
            } as never,
            newValue: {
              status: after.status,
              cancelledById: actor.sub,
              cancelledAt,
              cancelReason: after.cancelReason,
            } as never,
            reason: after.cancelReason,
          },
        })
        return after
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async createBooking(dto: CreateVenueBookingDto, actor: AuthUser) {
    const target = this.bookingTarget(dto.memberId, actor)
    return executeOrderCreation(this.prisma, {
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
      },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id }, include: { bookings: true, items: true } }),
      create: (creation) => this.createBookingOnce(dto, actor, target, creation),
    })
  }

  private async createBookingOnce(
    dto: CreateVenueBookingDto,
    actor: AuthUser,
    target: { memberId: string; assisted: boolean },
    creation: OrderCreationFields,
  ) {
    // Validate delegated targets only when creating a new order.  An exact
    // idempotent replay is allowed to return its original order even if the
    // customer was disabled after the first request committed.
    if (target.assisted) {
      const activeMember = await this.prisma.user.findFirst(this.activeMemberQuery(target.memberId))
      if (!activeMember) throw new NotFoundException('所选会员不存在、未建档或已停用')
    }

    const [court, slot, profile] = await Promise.all([
      this.prisma.court.findUnique({ where: { id: dto.courtId } }),
      this.prisma.timeSlot.findUnique({ where: { id: dto.slotId } }),
      this.prisma.memberProfile.findUnique({ where: { userId: target.memberId } }),
    ])
    if (!court?.enabled || !slot?.enabled) throw new NotFoundException('场地或时段不存在')
    if (court.usage === CourtUsage.MAINTENANCE) throw new ConflictException('场地维护中')
    if (court.usage === CourtUsage.TRAINING) throw new ConflictException('该场地为培训专用场，不能零售预订')
    if (court.usage === CourtUsage.MEMBER_BLOCK && !profile?.level) {
      throw new ConflictException('该场地为会员预留场，请先完成会员建档')
    }

    const startsAt = atMinutes(dto.date, slot.startMinutes)
    const endsAt = atMinutes(dto.date, slot.endMinutes)
    if (startsAt <= new Date()) throw new BadRequestException('不能预订已开始的时段')
    const price = await this.resolvePrice(slot.id, dto.date)
    if (!price) throw new NotFoundException('该时段尚未配置价格')

    let payableCents = price.priceCents
    let discountCents = 0
    let couponId: string | undefined
    if (dto.couponCode) {
      const coupon = await this.prisma.couponCode.findUnique({
        where: { code: dto.couponCode },
        include: { template: true },
      })
      if (
        !coupon ||
        coupon.holderId !== target.memberId ||
        coupon.status !== CouponStatus.CLAIMED ||
        coupon.expiresAt <= new Date()
      ) {
        throw new BadRequestException('优惠券无效、已过期或不属于当前会员')
      }
      couponId = coupon.id
      if (coupon.template.code.startsWith('NEWCOMER') && price.newcomerPriceCents !== null) {
        payableCents = price.newcomerPriceCents
      } else {
        payableCents = Math.max(0, price.priceCents - coupon.template.faceValueCents)
      }
      discountCents = price.priceCents - payableCents
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const shiftAuthorization = target.assisted
            ? await requireOpenFrontDeskShift(tx, actor)
            : null
          if (target.assisted) {
            const stillActive = await tx.user.findFirst(this.activeMemberQuery(target.memberId))
            if (!stillActive) throw new NotFoundException('所选会员不存在、未建档或已停用')
          }
          const closure = await tx.courtClosure.findFirst({
            where: {
              courtId: court.id,
              status: CourtClosureStatus.ACTIVE,
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt },
            },
            select: { id: true, startsAt: true, endsAt: true, reason: true },
          })
          if (closure) throw new ConflictException(`该时段已封场：${closure.reason}`)
          const conflict = await tx.courtBooking.findFirst({
            where: {
              courtId: court.id,
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt },
              status: { not: BookingStatus.CANCELLED },
            },
          })
          if (conflict) throw new ConflictException('该场地时段刚刚被预订')

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
                priceRuleId: price.id,
                priceCents: price.priceCents,
                newcomerPriceCents: price.newcomerPriceCents,
                courtCode: court.code,
                slotCode: slot.code,
                memberLevel: profile?.level,
                couponId,
                targetMemberId: target.memberId,
                createdById: actor.sub,
                operatorAssisted: target.assisted,
              },
              items: {
                create: {
                  itemType: 'COURT_SLOT',
                  itemId: court.id,
                  name: `${court.name} ${slot.label}`,
                  unitPriceCents: price.priceCents,
                  amountCents: price.priceCents,
                  metadata: { date: dto.date, slotId: slot.id },
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
                },
              },
            },
            include: { bookings: true, items: true },
          })
          if (shiftAuthorization) {
            await auditAdminShiftBypass(
              tx,
              actor,
              shiftAuthorization,
              'ASSISTED_VENUE_BOOKING',
              'Order',
              created.id,
            )
          }
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'VENUE_ORDER_CREATED',
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
                frontDeskShiftId:
                  shiftAuthorization?.mode === 'OPEN_SHIFT'
                    ? shiftAuthorization.shiftId
                    : null,
                adminEmergencyBypass:
                  shiftAuthorization?.mode === 'ADMIN_BYPASS',
              } as never,
            },
          })
          return created
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (error instanceof ConflictException) throw error
      if (isOrderCreationKeyViolation(error)) throw error
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该场地时段已被占用')
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('该场地时段刚刚被其他操作占用，请刷新后重试')
      }
      throw error
    }
  }

  private bookingTarget(memberId: string | undefined, actor: AuthUser) {
    const requestedMemberId = memberId?.trim()
    const assisted = actor.roles.some((role) => ASSISTED_BOOKING_ROLES.has(role))
    if (assisted) {
      if (!requestedMemberId) throw new BadRequestException('前台代客订场必须先选择会员')
      return { memberId: requestedMemberId, assisted: true }
    }
    if (!actor.roles.includes(AppRole.MEMBER)) {
      throw new ForbiddenException('仅会员本人或前台/管理员可创建场地订单')
    }
    if (requestedMemberId && requestedMemberId !== actor.sub) {
      throw new ForbiddenException('会员只能为本人预订场地')
    }
    return { memberId: actor.sub, assisted: false }
  }

  private activeMemberQuery(memberId: string) {
    return {
      where: {
        id: memberId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        memberProfile: { isNot: null },
      },
      select: { id: true },
    } as const
  }

  async checkIn(orderId: string, actor: AuthUser) {
    if (!actor.roles.some((role) => [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never))) {
      throw new ForbiddenException('仅前台或管理员可办理场地签到')
    }
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { bookings: true } })
      if (!order || order.businessType !== BusinessType.VENUE) throw new NotFoundException('订场订单不存在')
      // A scanner retry after a timeout is a safe no-op.  Returning the
      // already checked-in order avoids duplicate audit records and lets the
      // front desk continue the customer journey without a false 409.
      if (order.status === OrderStatus.CHECKED_IN) return order
      if (order.status !== OrderStatus.PAID) throw new ConflictException('订单未支付或状态不可签到')
      const activeBookings = order.bookings.filter((booking) => booking.status !== BookingStatus.CANCELLED)
      if (!activeBookings.length) {
        throw new ConflictException('订单没有可履约的场地占用记录')
      }
      const checkInStatuses: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN]
      if (activeBookings.some((booking) => !checkInStatuses.includes(booking.status))) {
        throw new ConflictException('场地占用记录状态不可签到')
      }
      const shiftAuthorization = await requireOpenFrontDeskShift(tx, actor)
      await tx.courtBooking.updateMany({
        where: { orderId, status: BookingStatus.CONFIRMED },
        data: { status: BookingStatus.CHECKED_IN },
      })
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PAID },
        data: { status: OrderStatus.CHECKED_IN },
      })
      if (changed.count !== 1) {
        const latest = await tx.order.findUnique({ where: { id: orderId } })
        if (latest?.status === OrderStatus.CHECKED_IN) return latest
        throw new ConflictException('订单状态已被其他操作更新，请刷新后重试')
      }
      await auditAdminShiftBypass(
        tx,
        actor,
        shiftAuthorization,
        'VENUE_CHECK_IN',
        'Order',
        orderId,
      )
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'VENUE_CHECK_IN',
          objectType: 'Order',
          objectId: orderId,
          newValue: {
            frontDeskShiftId:
              shiftAuthorization.mode === 'OPEN_SHIFT'
                ? shiftAuthorization.shiftId
                : null,
            adminEmergencyBypass:
              shiftAuthorization.mode === 'ADMIN_BYPASS',
          } as never,
        },
      })
      return tx.order.findUniqueOrThrow({ where: { id: orderId } })
    })
  }

  updateCourt(id: string, dto: UpdateCourtDto, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.court.findUniqueOrThrow({ where: { id } })
      const after = await tx.court.update({ where: { id }, data: dto })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'COURT_UPDATED',
          objectType: 'Court',
          objectId: id,
          oldValue: before as never,
          newValue: after as never,
        },
      })
      return after
    })
  }

  createPriceRule(dto: CreatePriceRuleDto, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.priceRule.create({
        data: {
          name: dto.name,
          timeSlotId: dto.timeSlotId,
          weekdayMask: dto.weekdayMask,
          priceCents: dto.priceCents,
          newcomerPriceCents: dto.newcomerPriceCents,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        },
      })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'PRICE_RULE_CREATED',
          objectType: 'PriceRule',
          objectId: created.id,
          newValue: created as never,
        },
      })
      return created
    })
  }

  private async resolvePrice(slotId: string, date: string) {
    const at = atMinutes(date, 0)
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay()
    const weekdayBit = 1 << dayOfWeek
    const rules = await this.prisma.priceRule.findMany({
      where: {
        enabled: true,
        OR: [{ timeSlotId: slotId }, { timeSlotId: null }],
        effectiveFrom: { lte: at },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }],
      },
      orderBy: [{ timeSlotId: 'desc' }, { effectiveFrom: 'desc' }],
    })
    return rules.find((rule) => (rule.weekdayMask & weekdayBit) !== 0) ?? null
  }

  private async releaseExpiredHolds(): Promise<void> {
    await this.prisma.courtBooking.updateMany({
      where: {
        status: BookingStatus.HELD,
        holdExpiresAt: { lt: new Date() },
      },
      data: { status: BookingStatus.CANCELLED },
    })
  }

  private assertClosureRole(actor: AuthUser, allowed: readonly AppRole[], message: string) {
    if (!actor.roles.some((role) => allowed.includes(role))) throw new ForbiddenException(message)
  }

  private closureAuditRole(actor: AuthUser) {
    return actor.roles.find((role) => CLOSURE_WRITE_ROLES.includes(role)) ?? actor.roles[0]
  }

  private closureCommand(dto: CreateCourtClosureDto) {
    const startsAt = new Date(dto.startsAt)
    const endsAt = new Date(dto.endsAt)
    if (endsAt <= startsAt) throw new BadRequestException('封场结束时间必须晚于开始时间')
    if (endsAt <= new Date()) throw new BadRequestException('不能创建已经结束的封场计划')
    return {
      courtId: dto.courtId.trim(),
      startsAt,
      endsAt,
      reason: dto.reason.trim(),
      creationIdempotencyKey: dto.creationIdempotencyKey.trim(),
    }
  }

  private assertClosureReplay(
    existing: {
      courtId: string
      startsAt: Date
      endsAt: Date
      reason: string
      creationIdempotencyKey: string
      createdById: string
    },
    command: ReturnType<VenuesService['closureCommand']>,
    actor: AuthUser,
  ) {
    if (
      existing.createdById !== actor.sub ||
      existing.courtId !== command.courtId ||
      existing.startsAt.getTime() !== command.startsAt.getTime() ||
      existing.endsAt.getTime() !== command.endsAt.getTime() ||
      existing.reason !== command.reason
    ) {
      throw new ConflictException('封场幂等键已用于不同命令')
    }
    return existing
  }
}
