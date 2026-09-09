import { transitionOrder } from '../order-transition.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  OrderStatus,
  Prisma,
  RefundStatus,
} from '../../generated/prisma/client.js';
import type { RequestRefundDto } from '../orders.dto.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from '../../operations/frontdesk-shift-gate.js';
import { serial, refundCommandResponse } from '../shared/orders-support.js';
import { assertRefundOriginIsConsistent } from '../shared/orders-refund-policy.js';

export async function requestRefund(
  prisma: PrismaService,
  orderId: string,
  dto: RequestRefundDto,
  actor: AuthUser,
) {
  const normalizedReason = dto.reason.trim();
  // Older clients did not send a key.  Derive one from the immutable
  // request identity so a retry still resolves to the original row; clients
  // that need two distinct refunds for the same amount/reason can provide
  // explicit keys.
  const suppliedKey = dto.idempotencyKey?.trim();
  if (suppliedKey?.startsWith('SYSTEM:'))
    throw new BadRequestException('此幂等键前缀仅供系统使用');
  if (suppliedKey && (suppliedKey.length < 8 || suppliedKey.length > 100)) {
    throw new BadRequestException('退款幂等键长度必须为8-100个字符');
  }
  const idempotencyKey =
    suppliedKey ||
    `REFUND_REQUEST:${createHash('sha256')
      .update(
        `${orderId}\u0000${actor.sub}\u0000${dto.amountCents}\u0000${normalizedReason}`,
      )
      .digest('hex')}`;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { trainingEnrollment: true },
  });
  if (!order) throw new NotFoundException('订单不存在');
  assertRefundRequestAuthorization(order.memberId, actor);
  const existing = prisma.refund?.findUnique
    ? await prisma.refund.findUnique({ where: { idempotencyKey } })
    : null;
  if (existing) {
    if (existing.orderId !== orderId || existing.requestedById !== actor.sub) {
      throw new ConflictException('退款幂等键已被其他订单或账号使用');
    }
    if (
      existing.amountCents !== dto.amountCents ||
      existing.reason !== normalizedReason
    ) {
      throw new ConflictException('退款幂等键已用于不同的退款内容');
    }
    return refundCommandResponse(existing);
  }
  const refundableStatuses = new Set<OrderStatus>([
    OrderStatus.PAID,
    OrderStatus.CHECKED_IN,
    OrderStatus.COMPLETED,
    OrderStatus.PARTIALLY_REFUNDED,
  ]);
  if (!refundableStatuses.has(order.status)) {
    throw new ConflictException('订单当前状态不可退款');
  }
  assertRefundOriginIsConsistent(
    order.status,
    order.completedAt,
    order.refundedCents,
  );
  const refundable = order.paidCents - order.refundedCents;
  if (dto.amountCents > refundable)
    throw new BadRequestException('退款金额超过可退金额');
  if (
    order.businessType === BusinessType.GOODS &&
    dto.amountCents !== refundable
  ) {
    throw new BadRequestException('商品订单需整单退货，暂不支持部分退款');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read and reserve the remaining refundable amount inside the same
      // transaction.  Two phones may submit a refund at the same time; the
      // preflight read above is only a fast error path and must not be the
      // concurrency boundary.
      const current = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          refunds: {
            where: {
              status: {
                in: [
                  RefundStatus.REQUESTED,
                  RefundStatus.APPROVED,
                  RefundStatus.PROCESSING,
                ],
              },
            },
            select: { amountCents: true },
          },
          trainingEnrollment: true,
        },
      });
      if (!current) throw new NotFoundException('订单不存在');
      assertRefundRequestAuthorization(current.memberId, actor);
      const existingInTransaction = tx.refund.findUnique
        ? await tx.refund.findUnique({ where: { idempotencyKey } })
        : null;
      if (existingInTransaction) {
        if (
          existingInTransaction.orderId !== orderId ||
          existingInTransaction.requestedById !== actor.sub
        ) {
          throw new ConflictException('退款幂等键已被其他订单或账号使用');
        }
        if (
          existingInTransaction.amountCents !== dto.amountCents ||
          existingInTransaction.reason !== normalizedReason
        ) {
          throw new ConflictException('退款幂等键已用于不同的退款内容');
        }
        return existingInTransaction;
      }
      const currentRefundableStatuses = new Set<OrderStatus>([
        OrderStatus.PAID,
        OrderStatus.CHECKED_IN,
        OrderStatus.COMPLETED,
        OrderStatus.PARTIALLY_REFUNDED,
      ]);
      if (!currentRefundableStatuses.has(current.status)) {
        throw new ConflictException('订单当前状态不可退款');
      }
      assertRefundOriginIsConsistent(
        current.status,
        current.completedAt,
        current.refundedCents,
      );
      const pendingAmount = current.refunds.reduce(
        (sum, item) => sum + item.amountCents,
        0,
      );
      const remaining =
        current.paidCents - current.refundedCents - pendingAmount;
      if (dto.amountCents > remaining)
        throw new BadRequestException(
          '退款金额超过剩余可退金额（含待审批退款）',
        );
      if (current.businessType === BusinessType.TRAINING) {
        if (!current.trainingEnrollment)
          throw new ConflictException('培训订单缺少报名与预收账本');
        const unreservedPrepaid =
          current.trainingEnrollment.prepaidBalanceCents - pendingAmount;
        if (dto.amountCents > unreservedPrepaid) {
          throw new BadRequestException(
            '退款金额超过未消课预收余额；已消课收入须先走消课冲正流程',
          );
        }
      }
      const shiftAuthorization =
        current.memberId !== actor.sub
          ? await requireOpenFrontDeskShift(tx, actor)
          : null;
      const refund = await tx.refund.create({
        data: {
          refundNo: serial('RF'),
          orderId,
          requestedById: actor.sub,
          amountCents: dto.amountCents,
          reason: normalizedReason,
          idempotencyKey,
          originalOrderStatus: current.status,
        },
      });
      const reserved = await transitionOrder(tx, 'REQUEST_REFUND', {
        where: { id: orderId, status: current.status },
        data: { status: OrderStatus.REFUND_PENDING },
      });
      if (reserved.count !== 1)
        throw new ConflictException('订单状态已变化，请刷新后重新申请退款');
      if (shiftAuthorization) {
        await auditAdminShiftBypass(
          tx,
          actor,
          shiftAuthorization,
          'ASSISTED_REFUND_REQUEST',
          'Refund',
          refund.id,
        );
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'REFUND_REQUESTED',
          objectType: 'Refund',
          objectId: refund.id,
          reason: normalizedReason,
          newValue: {
            amountCents: dto.amountCents,
            memberId: current.memberId,
            operatorAssisted: current.memberId !== actor.sub,
            frontDeskShiftId:
              shiftAuthorization?.mode === 'OPEN_SHIFT'
                ? shiftAuthorization.shiftId
                : null,
            adminEmergencyBypass: shiftAuthorization?.mode === 'ADMIN_BYPASS',
          } as never,
        },
      });
      return refund;
    });
    return refundCommandResponse(result);
  } catch (error) {
    // If two requests race before either sees the unique key, resolve the
    // losing insert to the committed refund row rather than exposing a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      prisma.refund?.findUnique
    ) {
      const duplicate = await prisma.refund.findUnique({
        where: { idempotencyKey },
      });
      if (
        duplicate &&
        duplicate.orderId === orderId &&
        duplicate.requestedById === actor.sub
      ) {
        if (
          duplicate.amountCents !== dto.amountCents ||
          duplicate.reason !== normalizedReason
        ) {
          throw new ConflictException('退款幂等键已用于不同的退款内容');
        }
        return refundCommandResponse(duplicate);
      }
    }
    throw error;
  }
}

export function assertRefundRequestAuthorization(
  memberId: string,
  actor: AuthUser,
): void {
  if (memberId === actor.sub) return;
  if (
    !actor.roles.some((role) =>
      [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅会员本人、前台或管理员可申请退款');
  }
}
