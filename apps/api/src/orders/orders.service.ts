import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
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
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
  RewardStatus,
} from '../generated/prisma/client.js';
import { applyInventoryDelta } from '../inventory/inventory-balance.js';
import type {
  OrderQueryDto,
  PayOrderDto,
  RequestRefundDto,
  ReviewRefundDto,
} from './orders.dto.js';
import { OrderFinalizerService } from '../payments/order-finalizer.service.js';
import { WechatPayService } from '../payments/wechat-pay.service.js';
import { promoteNextGameWaitlist } from '../games/games.service.js';
import {
  eventTeamCancellationRefundKey,
  promoteNextEventWaitlist,
} from '../events/events.service.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
  type FrontDeskShiftAuthorization,
} from '../operations/frontdesk-shift-gate.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

const ACCOUNT_CHANNELS: Partial<Record<PaymentChannel, AccountType>> = {
  [PaymentChannel.CASH_PRINCIPAL]: AccountType.CASH_PRINCIPAL,
  [PaymentChannel.GIFT_BALANCE]: AccountType.GIFT_BALANCE,
  [PaymentChannel.BADMINTON_COIN]: AccountType.BADMINTON_COIN,
};

// These refunds are created by terminal system decisions (a cancelled game,
// a cancelled event, or money received after an event seat expired).  They
// cannot be turned back into a deliverable order through the generic finance
// rejection route.  Member-initiated EVENT_TEAM_CANCEL refunds deliberately
// remain rejectable so a rejected self-withdrawal can restore the seat.
const NON_REJECTABLE_SYSTEM_REFUND_PREFIXES = [
  'GAME_CANCEL:',
  'EVENT_CANCEL:',
  'EVENT_LATE_PAYMENT:',
] as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly finalizer: OrderFinalizerService,
    private readonly wechatPay: WechatPayService,
  ) {}

  async list(actor: AuthUser, query: OrderQueryDto, all = false) {
    const where: Prisma.OrderWhereInput = {
      memberId: all ? undefined : actor.sub,
      businessType: query.businessType,
      status: query.status,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
          refunds: { orderBy: { requestedAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  detail(orderId: string, actor: AuthUser) {
    return this.prisma.order.findFirstOrThrow({
      where: this.canManageAll(actor)
        ? { id: orderId }
        : { id: orderId, memberId: actor.sub },
      include: {
        member: { select: { id: true, displayName: true, phone: true } },
        items: true,
        payments: true,
        refunds: true,
        bookings: { include: { court: true } },
        gameRegistration: { include: { game: true } },
        eventTeam: { include: { event: true } },
        trainingEnrollment: { include: { product: true, student: true } },
      },
    });
  }

  async pay(orderId: string, dto: PayOrderDto, actor: AuthUser) {
    // Coupons are discounts captured while the order is built. They are not
    // money and must never be accepted as a payment rail. Keep this check
    // before every read or write so even a legacy COUPON payment idempotency
    // replay cannot release a reservation or finalize an order for free.
    if (dto.channel === PaymentChannel.COUPON) {
      throw new BadRequestException('优惠券只能在建单时抵扣，不能作为支付渠道');
    }
    const eventReservation = this.prisma.eventTeam?.findUnique
      ? await this.prisma.eventTeam.findUnique({
          where: { orderId },
          select: {
            id: true,
            eventId: true,
            status: true,
            paymentDueAt: true,
          },
        })
      : null;
    if (
      eventReservation?.status === RegistrationStatus.REGISTERED &&
      (!eventReservation.paymentDueAt ||
        eventReservation.paymentDueAt <= new Date())
    ) {
      await this.prisma.$transaction(
        (tx) =>
          promoteNextEventWaitlist(
            tx,
            eventReservation.eventId,
            actor.sub,
            actor.roles[0],
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      throw new ConflictException('赛事报名支付保留期已过期，席位已释放');
    }
    if (eventReservation?.status === RegistrationStatus.CANCELLED) {
      throw new ConflictException('赛事报名订单已取消，不能支付');
    }
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (existing.orderId !== orderId || existing.channel !== dto.channel) {
        throw new ConflictException('支付幂等键已用于其他订单或支付渠道');
      }
      this.assertPaymentAuthorization(existing.userId, dto.channel, actor);
      if (existing.operatorId !== actor.sub)
        throw new ForbiddenException('支付请求只能由原操作人重试');
      return existing;
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: {
              items: true,
              membership: { include: { product: true } },
              member: { select: { openId: true } },
            },
          });
          if (!order) throw new NotFoundException('订单不存在');
          this.assertPaymentAuthorization(order.memberId, dto.channel, actor);
          if (order.status !== OrderStatus.PENDING)
            throw new ConflictException('订单当前状态不可支付');
          if (
            order.businessType === BusinessType.RECHARGE &&
            ACCOUNT_CHANNELS[dto.channel]
          ) {
            throw new BadRequestException(
              '充值订单只能使用微信支付或员工线下收款，不得用现有账户余额循环充值',
            );
          }

          let shiftAuthorization: FrontDeskShiftAuthorization | null = null;
          if (dto.channel === PaymentChannel.OFFLINE_CASH) {
            shiftAuthorization = await requireOpenFrontDeskShift(tx, actor);
          }

          const payment = await tx.payment.create({
            data: {
              paymentNo: serial('PAY'),
              orderId,
              userId: order.memberId,
              operatorId: actor.sub,
              channel: dto.channel,
              amountCents: order.payableCents,
              idempotencyKey: dto.idempotencyKey,
              status: PaymentStatus.CREATED,
            },
          });

          const accountType = ACCOUNT_CHANNELS[dto.channel];
          if (accountType) {
            const debitAmount = await this.accountDebitAmount(
              tx,
              dto.channel,
              order.payableCents,
            );
            const account = await tx.account.findUnique({
              where: {
                userId_type: { userId: order.memberId, type: accountType },
              },
            });
            if (!account || account.balance < debitAmount)
              throw new BadRequestException('账户余额不足');
            const updated = await tx.account.updateMany({
              where: { id: account.id, version: account.version },
              data: {
                balance: account.balance - debitAmount,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1)
              throw new ConflictException('账户余额已变化，请重新支付');
            await tx.accountTransaction.create({
              data: {
                accountId: account.id,
                kind: AccountTxnKind.DEBIT,
                amount: -debitAmount,
                balanceBefore: account.balance,
                balanceAfter: account.balance - debitAmount,
                reasonCode: 'ORDER_PAYMENT',
                reason: order.title,
                orderId,
                operatorId: actor.sub,
                idempotencyKey: `ACCOUNT:${dto.idempotencyKey}`,
                metadata: {
                  paymentChannel: dto.channel,
                  cashValueCents: order.payableCents,
                },
              },
            });
          } else if (
            dto.channel !== PaymentChannel.WECHAT &&
            dto.channel !== PaymentChannel.OFFLINE_CASH
          ) {
            throw new BadRequestException('暂不支持该支付渠道');
          }

          const mockWechat =
            dto.channel !== PaymentChannel.WECHAT ||
            this.config.get<string>('PAYMENT_PROVIDER', 'mock') === 'mock';
          if (!mockWechat) {
            if (!order.member.openId)
              throw new BadRequestException(
                '当前用户未绑定微信 OpenID，无法发起微信支付',
              );
            const wechatPay = await this.wechatPay.createJsapiPayment({
              orderNo: order.orderNo,
              description: order.title,
              amountCents: order.payableCents,
              openId: order.member.openId,
            });
            const processing = await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.PROCESSING,
                providerPayload: {
                  provider: 'wechat',
                  orderNo: order.orderNo,
                  wechatPay,
                },
              },
            });
            return { ...processing, wechatPay };
          }

          const now = new Date();
          const succeeded = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.SUCCEEDED,
              paidAt: now,
              providerTradeNo:
                dto.channel === PaymentChannel.WECHAT
                  ? serial('MOCKWX')
                  : undefined,
              providerPayload: {
                provider:
                  dto.channel === PaymentChannel.WECHAT
                    ? 'mock-wechat'
                    : 'internal',
                operatorId: actor.sub,
                frontDeskShiftId:
                  shiftAuthorization?.mode === 'OPEN_SHIFT'
                    ? shiftAuthorization.shiftId
                    : null,
                adminEmergencyBypass:
                  shiftAuthorization?.mode === 'ADMIN_BYPASS',
              },
            },
          });
          if (shiftAuthorization) {
            await auditAdminShiftBypass(
              tx,
              actor,
              shiftAuthorization,
              'OFFLINE_CASH_PAYMENT',
              'Payment',
              succeeded.id,
            );
          }
          await this.finalizer.finalize(
            tx,
            order,
            { ...succeeded, amountCents: succeeded.amountCents },
            actor.sub,
            actor.roles[0],
            now,
          );
          return succeeded;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // The unique idempotency key is also the concurrency boundary. If two
      // devices create the same payment simultaneously, resolve the losing
      // transaction to the committed payment instead of leaking P2002.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.prisma.payment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (concurrent) {
          if (
            concurrent.orderId !== orderId ||
            concurrent.channel !== dto.channel
          ) {
            throw new ConflictException('支付幂等键已用于其他订单或支付渠道');
          }
          this.assertPaymentAuthorization(
            concurrent.userId,
            dto.channel,
            actor,
          );
          if (concurrent.operatorId !== actor.sub)
            throw new ForbiddenException('支付请求只能由原操作人重试');
          return concurrent;
        }
      }
      throw error;
    }
  }

  async requestRefund(orderId: string, dto: RequestRefundDto, actor: AuthUser) {
    const normalizedReason = dto.reason.trim();
    // Older clients did not send a key.  Derive one from the immutable
    // request identity so a retry still resolves to the original row; clients
    // that need two distinct refunds for the same amount/reason can provide
    // explicit keys.
    const suppliedKey = dto.idempotencyKey?.trim();
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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { trainingEnrollment: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    this.assertRefundRequestAuthorization(order.memberId, actor);
    const existing = this.prisma.refund?.findUnique
      ? await this.prisma.refund.findUnique({ where: { idempotencyKey } })
      : null;
    if (existing) {
      if (
        existing.orderId !== orderId ||
        existing.requestedById !== actor.sub
      ) {
        throw new ConflictException('退款幂等键已被其他订单或账号使用');
      }
      if (
        existing.amountCents !== dto.amountCents ||
        existing.reason !== normalizedReason
      ) {
        throw new ConflictException('退款幂等键已用于不同的退款内容');
      }
      return existing;
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
    this.assertRefundOriginIsConsistent(
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
      return await this.prisma.$transaction(async (tx) => {
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
        this.assertRefundRequestAuthorization(current.memberId, actor);
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
        this.assertRefundOriginIsConsistent(
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
        const reserved = await tx.order.updateMany({
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
    } catch (error) {
      // If two requests race before either sees the unique key, resolve the
      // losing insert to the committed refund row rather than exposing a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        this.prisma.refund?.findUnique
      ) {
        const duplicate = await this.prisma.refund.findUnique({
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
          return duplicate;
        }
      }
      throw error;
    }
  }

  /** Reject a pending refund and return the order to its prior paid state. */
  async rejectRefund(refundId: string, dto: ReviewRefundDto, actor: AuthUser) {
    if (!this.isRefundApprover(actor))
      throw new ForbiddenException('仅财务或管理员可驳回退款');
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { order: { include: { eventTeam: true } } },
      });
      if (!refund) throw new NotFoundException('退款申请不存在');
      if (refund.status === RefundStatus.REJECTED) return refund;
      if (refund.status !== RefundStatus.REQUESTED)
        throw new ConflictException('退款申请已处理');
      if (
        NON_REJECTABLE_SYSTEM_REFUND_PREFIXES.some((prefix) =>
          refund.idempotencyKey?.startsWith(prefix),
        )
      ) {
        throw new ConflictException(
          '系统强制退款不可驳回，请完成审批并原路退回',
        );
      }
      if (refund.requestedById === actor.sub)
        throw new ForbiddenException('退款申请人与审批人不能是同一账号');

      const rejected = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.REJECTED,
          approvedById: actor.sub,
          approvedAt: new Date(),
        },
      });
      const otherPending = await tx.refund.aggregate({
        where: {
          orderId: refund.orderId,
          id: { not: refund.id },
          status: {
            in: [
              RefundStatus.REQUESTED,
              RefundStatus.APPROVED,
              RefundStatus.PROCESSING,
            ],
          },
        },
        _sum: { amountCents: true },
      });
      if (!otherPending._sum.amountCents) {
        const restoredStatus =
          refund.order.refundedCents > 0
            ? OrderStatus.PARTIALLY_REFUNDED
            : refund.originalOrderStatus;
        this.assertRefundOriginIsConsistent(
          restoredStatus,
          refund.order.completedAt,
          refund.order.refundedCents,
        );
        if (refund.order.status !== restoredStatus) {
          const restored = await tx.order.updateMany({
            where: { id: refund.orderId, status: refund.order.status },
            data: { status: restoredStatus },
          });
          if (restored.count !== 1)
            throw new ConflictException('订单状态已变化，请刷新后重试退款驳回');
        }
      }
      const eventTeam = refund.order.eventTeam;
      if (
        eventTeam?.cancellationPending &&
        eventTeam.cancelIdempotencyKey &&
        refund.idempotencyKey ===
          eventTeamCancellationRefundKey(
            eventTeam.id,
            eventTeam.cancelIdempotencyKey,
          )
      ) {
        await tx.eventTeam.updateMany({
          where: {
            id: eventTeam.id,
            status: RegistrationStatus.PAID,
            cancellationPending: true,
          },
          data: {
            cancellationPending: false,
            cancellationResolvedAt: new Date(),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'REFUND_REJECTED',
          objectType: 'Refund',
          objectId: refund.id,
          reason: dto.reason,
          oldValue: { status: RefundStatus.REQUESTED } as never,
          newValue: {
            status: RefundStatus.REJECTED,
            originalOrderStatus: refund.originalOrderStatus,
          } as never,
        },
      });
      return rejected;
    });
  }

  async approveRefund(refundId: string, dto: ReviewRefundDto, actor: AuthUser) {
    if (!this.isRefundApprover(actor))
      throw new ForbiddenException('仅财务或管理员可审批退款');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const refund = await tx.refund.findUnique({
              where: { id: refundId },
              include: {
                order: {
                  include: {
                    payments: { where: { status: PaymentStatus.SUCCEEDED } },
                    trainingEnrollment: true,
                    membership: { include: { product: true } },
                    items: true,
                    gameRegistration: true,
                    eventTeam: true,
                  },
                },
              },
            });
            if (!refund) throw new NotFoundException('退款申请不存在');
            if (refund.status !== RefundStatus.REQUESTED) {
              if (
                refund.approvedById === actor.sub &&
                (refund.status === RefundStatus.PROCESSING ||
                  refund.status === RefundStatus.SUCCEEDED)
              ) {
                return refund;
              }
              throw new ConflictException('退款申请已处理');
            }
            // Enforce maker/checker separation at the domain boundary.  A finance
            // or admin account may initiate a refund on behalf of a member, but it
            // must not approve its own request; otherwise a single compromised
            // account can both create and release a money movement.
            if (refund.requestedById === actor.sub) {
              throw new ForbiddenException('退款申请人与审批人不能是同一账号');
            }
            const payment = refund.order.payments[0];
            if (!payment) throw new ConflictException('未找到成功支付记录');
            if (refund.order.businessType === BusinessType.TRAINING) {
              const enrollment = refund.order.trainingEnrollment;
              if (!enrollment)
                throw new ConflictException('培训订单缺少报名与预收账本');
              if (refund.amountCents > enrollment.prepaidBalanceCents) {
                throw new ConflictException(
                  '当前未消课预收余额不足；请先驳回本申请或完成消课冲正后重提',
                );
              }
            }

            const accountType = ACCOUNT_CHANNELS[payment.channel];
            if (accountType) {
              const originalTxn = await tx.accountTransaction.findFirst({
                where: {
                  orderId: refund.orderId,
                  account: { type: accountType },
                },
                orderBy: { createdAt: 'asc' },
              });
              const restoreAmount = originalTxn
                ? Math.round(
                    (Math.abs(originalTxn.amount) * refund.amountCents) /
                      payment.amountCents,
                  )
                : refund.amountCents;
              const account = await tx.account.findUniqueOrThrow({
                where: {
                  userId_type: {
                    userId: refund.order.memberId,
                    type: accountType,
                  },
                },
              });
              await tx.account.update({
                where: { id: account.id },
                data: {
                  balance: { increment: restoreAmount },
                  version: { increment: 1 },
                },
              });
              await tx.accountTransaction.create({
                data: {
                  accountId: account.id,
                  kind: AccountTxnKind.REVERSAL,
                  amount: restoreAmount,
                  balanceBefore: account.balance,
                  balanceAfter: account.balance + restoreAmount,
                  reasonCode: 'ORDER_REFUND',
                  reason: dto.reason,
                  orderId: refund.orderId,
                  operatorId: actor.sub,
                  idempotencyKey: `REFUND:${refund.refundNo}`,
                },
              });
            }

            // A real WeChat refund is asynchronous.  Do not reverse a recharge
            // balance (or any other business side effect) until the signed
            // REFUND.SUCCESS notification arrives; otherwise a PROCESSING refund
            // would make the member's balance spendable before money is actually
            // returned by the provider.
            const isWechatProviderRefund =
              payment.channel === PaymentChannel.WECHAT &&
              this.config.get<string>('PAYMENT_PROVIDER', 'mock') === 'wechat';

            if (
              refund.order.businessType === BusinessType.RECHARGE &&
              !isWechatProviderRefund
            ) {
              const snapshot = refund.order.parameterSnapshot as {
                principalCents?: number;
                giftCents?: number;
              };
              const debits: Array<[AccountType, number]> = [
                [
                  AccountType.CASH_PRINCIPAL,
                  Math.round(
                    (Math.max(0, Number(snapshot.principalCents) || 0) *
                      refund.amountCents) /
                      payment.amountCents,
                  ),
                ],
                [
                  AccountType.GIFT_BALANCE,
                  Math.round(
                    (Math.max(0, Number(snapshot.giftCents) || 0) *
                      refund.amountCents) /
                      payment.amountCents,
                  ),
                ],
              ];
              for (const [type, amount] of debits) {
                if (!amount) continue;
                const account = await tx.account.findUniqueOrThrow({
                  where: {
                    userId_type: { userId: refund.order.memberId, type },
                  },
                });
                if (account.balance < amount)
                  throw new ConflictException(
                    `${type} 余额不足，充值款已消费，需人工审核处理`,
                  );
                await tx.account.update({
                  where: { id: account.id },
                  data: {
                    balance: { decrement: amount },
                    version: { increment: 1 },
                  },
                });
                await tx.accountTransaction.create({
                  data: {
                    accountId: account.id,
                    kind: AccountTxnKind.REVERSAL,
                    amount: -amount,
                    balanceBefore: account.balance,
                    balanceAfter: account.balance - amount,
                    reasonCode: 'RECHARGE_REFUND',
                    reason: dto.reason,
                    orderId: refund.order.id,
                    operatorId: actor.sub,
                    idempotencyKey: `RECHARGE-REFUND:${refund.id}:${type}`,
                  },
                });
              }
            }

            if (isWechatProviderRefund) {
              const provider = await this.wechatPay.createRefund({
                orderNo: refund.order.orderNo,
                refundNo: refund.refundNo,
                refundCents: refund.amountCents,
                totalCents: refund.order.paidCents,
                reason: dto.reason,
              });
              const processing = await tx.refund.update({
                where: { id: refund.id },
                data: {
                  status: RefundStatus.PROCESSING,
                  approvedById: actor.sub,
                  approvedAt: new Date(),
                  providerRefundNo: provider.refundId,
                },
              });
              await tx.auditLog.create({
                data: {
                  actorId: actor.sub,
                  actorRole: actor.roles[0],
                  action: 'WECHAT_REFUND_REQUESTED',
                  objectType: 'Refund',
                  objectId: refund.id,
                  reason: dto.reason,
                  newValue: {
                    amountCents: refund.amountCents,
                    providerRefundId: provider.refundId,
                    providerStatus: provider.status,
                  } as never,
                },
              });
              return processing;
            }

            const refundedCents =
              refund.order.refundedCents + refund.amountCents;
            const fullyRefunded = refundedCents >= refund.order.paidCents;
            const completedAt = new Date();
            await tx.refund.update({
              where: { id: refund.id },
              data: {
                status: RefundStatus.SUCCEEDED,
                approvedById: actor.sub,
                approvedAt: completedAt,
                completedAt,
              },
            });
            await tx.order.update({
              where: { id: refund.orderId },
              data: {
                refundedCents,
                status: fullyRefunded
                  ? OrderStatus.REFUNDED
                  : OrderStatus.PARTIALLY_REFUNDED,
              },
            });
            if (refund.order.trainingEnrollment) {
              const enrollment = refund.order.trainingEnrollment;
              const enrollmentRefunded = Math.min(
                enrollment.totalAmountCents,
                enrollment.refundedCents + refund.amountCents,
              );
              const remainingPrepaid = Math.max(
                0,
                enrollment.prepaidBalanceCents - refund.amountCents,
              );
              await tx.trainingEnrollment.update({
                where: { id: enrollment.id },
                data: {
                  refundedCents: enrollmentRefunded,
                  prepaidBalanceCents: remainingPrepaid,
                  status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
                },
              });
            }
            if (fullyRefunded) {
              await tx.courtBooking.updateMany({
                where: { orderId: refund.orderId },
                data: { status: BookingStatus.CANCELLED },
              });
              if (refund.order.membership) {
                await tx.memberSubscription.update({
                  where: { id: refund.order.membership.id },
                  data: { status: MembershipStatus.CANCELLED },
                });
                const latest = await tx.memberSubscription.findFirst({
                  where: {
                    memberId: refund.order.membership.memberId,
                    status: MembershipStatus.ACTIVE,
                    id: { not: refund.order.membership.id },
                  },
                  include: { product: true },
                  orderBy: { endsAt: 'desc' },
                });
                await tx.memberProfile.update({
                  where: { id: refund.order.membership.memberId },
                  data: {
                    level: latest?.product.level ?? 'EXPERIENCE',
                    membershipExpiresAt: latest?.endsAt,
                  },
                });
              }
              if (refund.order.businessType === BusinessType.GOODS) {
                for (const item of refund.order.items) {
                  if (!item.itemId) continue;
                  const inventory = await tx.inventoryItem.findUniqueOrThrow({
                    where: { id: item.itemId },
                  });
                  const { stockAfter } = await applyInventoryDelta(
                    tx,
                    inventory,
                    item.quantity,
                  );
                  await tx.inventoryTransaction.create({
                    data: {
                      itemId: inventory.id,
                      type: InventoryTxnType.ADJUSTMENT,
                      quantity: item.quantity,
                      stockBefore: inventory.stock,
                      stockAfter,
                      unitCostCents: inventory.purchasePriceCents,
                      orderItemId: item.id,
                      operatorId: actor.sub,
                      reason: `退款 ${refund.refundNo} 退货入库`,
                      idempotencyKey: `GOODS-REFUND:${refund.id}:${item.id}`,
                    },
                  });
                }
                await this.finalizer.recordSucceededGoodsRefund(
                  tx,
                  refund.id,
                  actor.sub,
                  actor.roles[0],
                );
              }
              if (
                refund.order.businessType === BusinessType.GAME &&
                refund.order.gameRegistration
              ) {
                await tx.gameRegistration.update({
                  where: { id: refund.order.gameRegistration.id },
                  data: { status: 'REFUNDED' },
                });
                await promoteNextGameWaitlist(
                  tx,
                  refund.order.gameRegistration.gameId,
                  actor.sub,
                  actor.roles[0],
                );
              }
              if (
                refund.order.businessType === BusinessType.EVENT &&
                refund.order.eventTeam
              ) {
                await tx.eventTeam.update({
                  where: { id: refund.order.eventTeam.id },
                  data: {
                    status: RegistrationStatus.REFUNDED,
                    paymentDueAt: null,
                    cancellationPending: false,
                    cancellationResolvedAt: refund.order.eventTeam
                      .cancelRequestedAt
                      ? (refund.order.eventTeam.cancellationResolvedAt ??
                        new Date())
                      : undefined,
                  },
                });
                await promoteNextEventWaitlist(
                  tx,
                  refund.order.eventTeam.eventId,
                  actor.sub,
                  actor.roles[0],
                );
              }
            }
            await tx.referralReward.updateMany({
              where: {
                triggerOrderId: refund.orderId,
                status: {
                  in: [
                    RewardStatus.PENDING_OBSERVATION,
                    RewardStatus.AVAILABLE,
                  ],
                },
              },
              data: { status: RewardStatus.REVERSED, reversedAt: new Date() },
            });
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'REFUND_APPROVED',
                objectType: 'Refund',
                objectId: refund.id,
                reason: dto.reason,
                oldValue: { orderStatus: refund.order.status } as never,
                newValue: {
                  amountCents: refund.amountCents,
                  fullyRefunded,
                } as never,
              },
            });
            return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          isPrismaErrorCode(error, 'P2002') ||
          isPrismaErrorCode(error, 'P2034')
        ) {
          const completed = await this.prisma.refund.findUnique({
            where: { id: refundId },
          });
          if (
            completed?.approvedById === actor.sub &&
            (completed.status === RefundStatus.PROCESSING ||
              completed.status === RefundStatus.SUCCEEDED)
          ) {
            return completed;
          }
          if (attempt < 3) continue;
          throw new ConflictException('退款审批发生并发冲突，请刷新后重试');
        }
        throw error;
      }
    }
    throw new ConflictException('退款审批发生并发冲突，请刷新后重试');
  }

  private canManageAll(actor: AuthUser): boolean {
    const elevated = new Set<AppRole>([
      AppRole.FRONT_DESK,
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    return actor.roles.some((role) => elevated.has(role));
  }

  private assertPaymentAuthorization(
    memberId: string,
    channel: PaymentChannel,
    actor: AuthUser,
  ): void {
    const selfPayment = memberId === actor.sub;
    if (selfPayment) {
      if (channel === PaymentChannel.OFFLINE_CASH) {
        throw new ForbiddenException('会员本人不能使用线下现金渠道');
      }
      return;
    }

    if (channel !== PaymentChannel.OFFLINE_CASH) {
      if (ACCOUNT_CHANNELS[channel]) {
        throw new ForbiddenException(
          '账户余额只能由会员本人支付，员工不得代扣',
        );
      }
      throw new ForbiddenException('员工代客收款仅支持线下现金渠道');
    }
    if (
      !actor.roles.some((role) =>
        [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
          role as never,
        ),
      )
    ) {
      throw new ForbiddenException('仅前台或管理员可代收线下现金');
    }
  }

  private assertRefundRequestAuthorization(
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

  private isRefundApprover(actor: AuthUser): boolean {
    return actor.roles.some((role) =>
      [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    );
  }

  private assertRefundOriginIsConsistent(
    status: OrderStatus,
    completedAt: Date | null,
    refundedCents: number,
  ): void {
    if (status === OrderStatus.COMPLETED && !completedAt) {
      throw new ConflictException('已完成订单缺少完成时间，需先修复履约证据');
    }
    if (status === OrderStatus.PARTIALLY_REFUNDED && refundedCents <= 0) {
      throw new ConflictException(
        '部分退款订单缺少已退款金额，需先修复财务证据',
      );
    }
    if (
      completedAt &&
      status !== OrderStatus.COMPLETED &&
      status !== OrderStatus.PARTIALLY_REFUNDED
    ) {
      throw new ConflictException('订单状态与完成时间不一致，需先修复履约证据');
    }
  }

  private async accountDebitAmount(
    tx: Prisma.TransactionClient,
    channel: PaymentChannel,
    payableCents: number,
  ): Promise<number> {
    if (channel !== PaymentChannel.BADMINTON_COIN) return payableCents;
    const parameter = await tx.systemParameter.findFirst({
      where: {
        key: 'badminton_coin.cent_value',
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const centValue =
      typeof parameter?.value === 'number' ? parameter.value : 1;
    if (!Number.isFinite(centValue) || centValue <= 0)
      throw new BadRequestException('羽球币兑换参数无效');
    return Math.ceil(payableCents / centValue);
  }
}
