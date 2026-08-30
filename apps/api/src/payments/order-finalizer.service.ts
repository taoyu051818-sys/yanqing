import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'

import {
  AccountTxnKind,
  AccountType,
  AppRole,
  BookingStatus,
  BusinessType,
  InventoryTxnType,
  MembershipStatus,
  OrderStatus,
  PaymentChannel,
  Prisma,
  RewardStatus,
  TrainingEnrollmentStatus,
} from '../generated/prisma/client.js'
import { applyInventoryDelta } from '../inventory/inventory-balance.js'

export type PayableOrder = Prisma.OrderGetPayload<{
  include: { items: true; membership: { include: { product: true } }; member: { select: { openId: true } } }
}>

@Injectable()
export class OrderFinalizerService {
  async finalize(
    tx: Prisma.TransactionClient,
    order: PayableOrder,
    payment: { id: string; paymentNo: string; channel: PaymentChannel; amountCents?: number },
    actorId: string,
    actorRole: AppRole,
    now = new Date(),
  ): Promise<void> {
    // Payment notifications and client retries can arrive more than once.  A
    // successful finalisation is the commit boundary for every downstream
    // side effect, so a retry must return without touching balances, stock,
    // coupons or rewards a second time.  The conditional update also closes
    // the race between two workers handling the same provider callback.
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true, paidCents: true, paymentChannel: true },
    })
    if (current && current.status !== OrderStatus.PENDING) return
    const changed = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.PENDING },
      data: {
        status: OrderStatus.PAID,
        paymentChannel: payment.channel,
        paidCents: order.payableCents,
        paidAt: now,
      },
    })
    if (changed.count !== 1) return

    if (payment.amountCents !== undefined && payment.amountCents !== order.payableCents) {
      throw new ConflictException('支付金额与订单应付金额不一致')
    }
    await tx.courtBooking.updateMany({
      where: { orderId: order.id, status: BookingStatus.HELD },
      data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null },
    })
    const enrollment = await tx.trainingEnrollment.findUnique({
      where: { orderId: order.id },
      include: { class: true },
    })
    if (enrollment?.status === TrainingEnrollmentStatus.PENDING_PAYMENT) {
      if (enrollment.classId) {
        if (!enrollment.class?.active) throw new ConflictException('培训班已停用，不能完成支付')
        if (!enrollment.seatReservedUntil || enrollment.seatReservedUntil <= now) {
          throw new ConflictException('培训班名额保留已过期，请重新报名')
        }
        const occupiedSeats = await tx.trainingEnrollment.count({
          where: {
            classId: enrollment.classId,
            id: { not: enrollment.id },
            status: {
              in: [
                TrainingEnrollmentStatus.ACTIVE,
                TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
              ],
            },
          },
        })
        if (occupiedSeats >= enrollment.class.capacity) {
          throw new ConflictException('培训班名额已满，支付未完成')
        }
      }
      await tx.trainingEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: TrainingEnrollmentStatus.ACTIVE,
          prepaidBalanceCents: enrollment.totalAmountCents,
          seatReservedUntil: null,
        },
      })
    }
    await tx.gameRegistration.updateMany({ where: { orderId: order.id, status: 'REGISTERED' }, data: { status: 'PAID' } })
    await tx.eventTeam.updateMany({ where: { orderId: order.id, status: 'REGISTERED' }, data: { status: 'PAID' } })

    if (order.membership) {
      await tx.memberSubscription.update({ where: { id: order.membership.id }, data: { status: MembershipStatus.ACTIVE } })
      await tx.memberProfile.update({
        where: { id: order.membership.memberId },
        data: { level: order.membership.product.level, membershipExpiresAt: order.membership.endsAt },
      })
    }

    if (order.businessType === BusinessType.RECHARGE) {
      const snapshot = order.parameterSnapshot as { principalCents?: number; giftCents?: number }
      const credits: Array<[AccountType, number]> = [
        [AccountType.CASH_PRINCIPAL, Math.max(0, Number(snapshot.principalCents) || 0)],
        [AccountType.GIFT_BALANCE, Math.max(0, Number(snapshot.giftCents) || 0)],
      ]
      for (const [type, amount] of credits) {
        if (!amount) continue
        const account = await tx.account.findUniqueOrThrow({ where: { userId_type: { userId: order.memberId, type } } })
        const idempotencyKey = `RECHARGE:${payment.id}:${type}`
        const existing = await tx.accountTransaction.findUnique({ where: { idempotencyKey } })
        if (existing) continue
        const changedAccount = await tx.account.updateMany({
          where: { id: account.id, version: account.version },
          data: { balance: { increment: amount }, version: { increment: 1 } },
        })
        if (changedAccount.count !== 1) throw new ConflictException('账户余额已变化，请重试支付回调')
        await tx.accountTransaction.create({ data: {
          accountId: account.id, kind: AccountTxnKind.CREDIT, amount,
          balanceBefore: account.balance, balanceAfter: account.balance + amount,
          reasonCode: 'MEMBER_RECHARGE', reason: order.title, orderId: order.id,
          operatorId: actorId, idempotencyKey,
        } })
      }
    }

    if (order.businessType === BusinessType.GOODS) {
      for (const item of order.items) {
        if (!item.itemId) continue
        const inventory = await tx.inventoryItem.findUnique({ where: { id: item.itemId } })
        if (!inventory) throw new NotFoundException(`商品 ${item.name} 不存在`)
        const idempotencyKey = `GOODS:${payment.id}:${item.id}`
        const existing = await tx.inventoryTransaction.findUnique({ where: { idempotencyKey } })
        if (existing) continue
        const { stockAfter } = await applyInventoryDelta(tx, inventory, -item.quantity)
        await tx.inventoryTransaction.create({ data: {
          itemId: inventory.id, type: InventoryTxnType.SALE_OUT, quantity: -item.quantity,
          stockBefore: inventory.stock, stockAfter,
          unitCostCents: inventory.purchasePriceCents, orderItemId: item.id, operatorId: actorId,
          reason: `订单 ${order.orderNo} 销售出库`, idempotencyKey,
        } })
      }
    }

    const member = await tx.user.findUnique({ where: { id: order.memberId }, select: { referrerId: true } })
    if (member?.referrerId) {
      const previousPaidOrders = await tx.order.count({
        where: {
          memberId: order.memberId,
          id: { not: order.id },
          status: { in: [OrderStatus.PAID, OrderStatus.CHECKED_IN, OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED] },
        },
      })
      if (previousPaidOrders === 0) {
        const [rewardParameter, observationParameter] = await Promise.all([
          tx.systemParameter.findFirst({
            where: { key: 'referral.first_payment.coin_reward', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
            orderBy: { effectiveFrom: 'desc' },
          }),
          tx.systemParameter.findFirst({
            where: { key: 'referral.refund_observation_days', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
            orderBy: { effectiveFrom: 'desc' },
          }),
        ])
        const rewardValue = typeof rewardParameter?.value === 'number' ? Math.max(0, Math.round(rewardParameter.value)) : 100
        const observationDays = typeof observationParameter?.value === 'number' ? Math.max(0, Math.round(observationParameter.value)) : 7
        // The reward is unique per new member and trigger type.  Use the
        // compound unique key as the database concurrency boundary instead of
        // a read-then-create sequence.  In particular, do not catch P2002
        // inside this transaction: PostgreSQL marks a transaction aborted after
        // a constraint error, so pretending the loser can continue would risk
        // committing the payment without its downstream side effects.  A
        // database upsert is atomic and leaves the already-created reward
        // untouched on a retry.
        await tx.referralReward.upsert({
          where: {
            newUserId_triggerType: {
              newUserId: order.memberId,
              triggerType: 'FIRST_PAYMENT',
            },
          },
          update: {},
          create: {
            referrerId: member.referrerId,
            newUserId: order.memberId,
            triggerOrderId: order.id,
            triggerType: 'FIRST_PAYMENT',
            rewardType: 'BADMINTON_COIN',
            rewardValue,
            status: RewardStatus.PENDING_OBSERVATION,
            observationEndsAt: new Date(now.getTime() + observationDays * 86_400_000),
          },
        })
      }
    }

    if (order.consumedCouponCode) {
      const coupon = await tx.couponCode.findUnique({ where: { code: order.consumedCouponCode }, include: { template: true } })
      if (!coupon) throw new ConflictException('订单优惠券不存在')
      if (coupon.status !== 'CLAIMED') {
        // The discount is part of the order snapshot, but the coupon itself
        // is a one-time resource.  Without this guard two orders created with
        // the same claimed code could both be paid and silently receive the
        // same benefit.  Failing the payment finalisation rolls the whole
        // transaction back, leaving the second order pending for a safe retry.
        throw new ConflictException('订单优惠券已被使用或已失效')
      }
      if (coupon.expiresAt <= now) throw new ConflictException('订单优惠券已过期')
      if (coupon.attributionOrderId && coupon.attributionOrderId !== order.id) {
        throw new ConflictException('订单优惠券已锁定到其他订单')
      }
      const redeemed = await tx.couponCode.updateMany({
        where: {
          id: coupon.id,
          status: 'CLAIMED',
          OR: [{ attributionOrderId: null }, { attributionOrderId: order.id }],
        },
        data: {
          status: 'REDEEMED',
          redeemedAt: now,
          redeemedById: actorId,
          redeemedMerchantId: coupon.template.merchantId,
          attributionOrderId: order.id,
          attributedAmountCents: order.payableCents,
        },
      })
      if (redeemed.count !== 1) throw new ConflictException('订单优惠券已被并发使用，请重新下单')
      await tx.couponTemplate.update({ where: { id: coupon.templateId }, data: { redeemedCount: { increment: 1 } } })
    }
    await tx.auditLog.create({ data: {
      actorId, actorRole, action: 'ORDER_PAID', objectType: 'Order', objectId: order.id,
      newValue: { paymentNo: payment.paymentNo, channel: payment.channel } as never,
    } })
  }
}
