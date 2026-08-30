import { ConflictException, NotFoundException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  OrderStatus,
  type Prisma,
} from '../generated/prisma/client.js'

const FULFILLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
]

export interface CompleteOrderFulfillmentInput {
  orderId: string
  actor: AuthUser
  objectType: string
  objectId: string
  outcome: 'COMPLETED' | 'NO_SHOW' | 'ACTIVATED' | 'FULFILLED'
  completedAt?: Date
  reason?: string
  metadata?: Record<string, unknown>
}

/**
 * Records the one-way business fulfilment boundary for an order.
 *
 * PARTIALLY_REFUNDED is preserved because a partially returned service can
 * still be delivered. REFUND_PENDING is intentionally excluded: finance must
 * approve or reject the active refund before any new fulfilment evidence is
 * recorded. PAID/CHECKED_IN orders become COMPLETED.
 *
 * `completedAt IS NULL` plus the exact prior status is the compare-and-set
 * boundary.  Only the winning transaction writes ORDER_COMPLETED, so retries
 * and concurrent operators do not fabricate multiple completion events.
 */
export async function completeOrderFulfillment(
  tx: Prisma.TransactionClient,
  input: CompleteOrderFulfillmentInput,
) {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      businessType: true,
      status: true,
      completedAt: true,
      paidCents: true,
      refundedCents: true,
    },
  })
  if (!order) throw new NotFoundException('履约订单不存在')
  if (order.completedAt) return { order, changed: false }
  if (!FULFILLABLE_ORDER_STATUSES.includes(order.status)) {
    throw new ConflictException(`订单状态 ${order.status} 不可确认履约`)
  }

  const completedAt = input.completedAt ?? new Date()
  const finalStatus = (
    order.status === OrderStatus.PAID ||
    order.status === OrderStatus.CHECKED_IN
  )
    ? OrderStatus.COMPLETED
    : order.status
  const changed = await tx.order.updateMany({
    where: {
      id: order.id,
      status: order.status,
      completedAt: null,
    },
    data: {
      status: finalStatus,
      completedAt,
    },
  })
  if (changed.count !== 1) {
    const latest = await tx.order.findUnique({
      where: { id: order.id },
      select: {
        id: true,
        businessType: true,
        status: true,
        completedAt: true,
        paidCents: true,
        refundedCents: true,
      },
    })
    if (latest?.completedAt) return { order: latest, changed: false }
    throw new ConflictException('订单状态已被其他操作更新，请刷新后重试')
  }

  await tx.auditLog.create({
    data: {
      actorId: input.actor.sub,
      actorRole: input.actor.roles[0],
      action: 'ORDER_COMPLETED',
      objectType: 'Order',
      objectId: order.id,
      reason: input.reason,
      oldValue: {
        status: order.status,
        completedAt: null,
      } as never,
      newValue: {
        status: finalStatus,
        completedAt: completedAt.toISOString(),
        businessType: order.businessType,
        outcome: input.outcome,
        fulfillmentObjectType: input.objectType,
        fulfillmentObjectId: input.objectId,
        paidCents: order.paidCents,
        refundedCents: order.refundedCents,
        ...input.metadata,
      } as never,
    },
  })
  const completed = {
    ...order,
    status: finalStatus,
    completedAt,
  }
  return { order: completed, changed: true }
}
