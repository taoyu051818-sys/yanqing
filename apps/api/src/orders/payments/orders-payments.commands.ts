import {
  payableBookingCoupon,
  reserveBookingCoupon,
} from '../booking-coupon.js';
import {
  membershipPurchaseUnavailable,
  assertMembershipPurchaseCompatible,
} from '../../memberships/membership-entitlements.js';
import { gamePaymentUnavailable } from '../../games/game-registration-policy.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountTxnKind,
  AppRole,
  BookingStatus,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { assertGoodsStockAvailable } from '../../inventory/goods-stock.js';
import type { PayOrderDto } from '../orders.dto.js';
import { OrderFinalizerService } from '../../payments/order-finalizer.service.js';
import { WechatPayService } from '../../payments/wechat-pay.service.js';
import { promoteNextEventWaitlist } from '../../events/registration/event-waitlist.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
  type FrontDeskShiftAuthorization,
} from '../../operations/frontdesk-shift-gate.js';
import { pendingPaymentDeadline } from '../pending-order-policy.js';
import {
  serial,
  ACCOUNT_CHANNELS,
  paymentCommandResponse,
} from '../shared/orders-support.js';

export async function paymentOptions(
  prisma: PrismaService,
  config: ConfigService,
  orderId: string,
  actor: AuthUser,
) {
  return prisma.$transaction(
    async (tx) => {
      // A cashier is not entitled to inspect another member's payment balances.
      const order = await tx.order.findFirst({
        where: { id: orderId, memberId: actor.sub },
        include: {
          membership: { include: { product: true } },
          bookings: true,
          eventTeam: true,
          gameRegistration: { include: { game: true } },
          trainingEnrollment: true,
          items: true,
          payments: true,
          member: {
            select: {
              openId: true,
              accounts: {
                select: { type: true, balance: true, frozenBalance: true },
              },
            },
          },
        },
      });
      if (!order) throw new NotFoundException('订单不存在或不属于当前账号');
      const now = new Date();
      const deadline = pendingPaymentDeadline(order);
      let unavailable =
        order.status !== OrderStatus.PENDING
          ? '订单已不在待付款状态'
          : deadline && deadline <= now
            ? '支付保留期已过，请重新下单'
            : '';
      if (!unavailable && order.membership)
        unavailable =
          (await membershipPurchaseUnavailable(
            tx,
            order.membership.memberId,
            order.membership.product.level,
            order.membership.id,
            now,
          )) ?? '';
      if (!unavailable && order.businessType === BusinessType.GAME)
        unavailable = gamePaymentUnavailable(
          order.gameRegistration,
          order.createdAt,
          now,
        );
      if (!unavailable && order.businessType === BusinessType.GOODS) {
        try {
          await assertGoodsStockAvailable(tx, order.items, {
            orderId: order.id,
            reservePayments: true,
          });
        } catch (error) {
          unavailable = error instanceof Error ? error.message : '商品库存不足';
        }
      }
      if (!unavailable) {
        try {
          await payableBookingCoupon(tx, order);
        } catch (error) {
          unavailable =
            error instanceof Error ? error.message : '券适用范围已变化';
        }
      }
      // Keep the existing command channel for old clients; no provider or wallet
      // is involved in confirming a free order.
      if (order.payableCents === 0)
        return {
          orderId,
          payableCents: 0,
          paymentExpiresAt: deadline?.toISOString(),
          quotedAt: now.toISOString(),
          options: [
            {
              channel: PaymentChannel.WECHAT,
              enabled: !unavailable,
              reason: unavailable,
              debitAmount: 0,
              unit: 'CENT',
            },
          ],
        };
      const channels = [
        PaymentChannel.WECHAT,
        PaymentChannel.CASH_PRINCIPAL,
        PaymentChannel.GIFT_BALANCE,
        PaymentChannel.BADMINTON_COIN,
      ];
      const options = await Promise.all(
        channels.map(async (channel) => {
          let reason = unavailable;
          let debitAmount = order.payableCents;
          let availableBalance: number | undefined;
          if (
            channel !== PaymentChannel.WECHAT &&
            order.payments.some(
              (payment) =>
                payment.channel === PaymentChannel.WECHAT &&
                payment.status === PaymentStatus.PROCESSING,
            )
          )
            reason ||= '微信支付结果确认中，请先完成或取消原支付';
          if (ACCOUNT_CHANNELS[channel]) {
            try {
              debitAmount = await accountDebitAmount(
                tx,
                channel,
                order.payableCents,
              );
            } catch {
              reason ||= '抵扣规则暂不可用，请联系工作人员';
            }
            const account = order.member.accounts.find(
              (item) => item.type === ACCOUNT_CHANNELS[channel],
            );
            availableBalance = Math.max(
              0,
              (account?.balance || 0) -
                Math.max(0, account?.frozenBalance || 0),
            );
            if (order.businessType === BusinessType.RECHARGE)
              reason ||= '充值不能使用已有余额支付';
            if (availableBalance < debitAmount)
              reason ||= '可用余额不足（冻结余额不可使用）';
          } else if (
            config.get<string>('PAYMENT_PROVIDER', 'mock') === 'wechat' &&
            !order.member.openId
          ) {
            reason ||= '请先通过微信登录绑定账号';
          }
          return {
            channel,
            enabled: !reason,
            reason,
            debitAmount,
            availableBalance,
            unit: channel === PaymentChannel.BADMINTON_COIN ? 'COIN' : 'CENT',
          };
        }),
      );
      return {
        orderId,
        payableCents: order.payableCents,
        paymentExpiresAt: deadline?.toISOString(),
        quotedAt: now.toISOString(),
        options,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function pay(
  prisma: PrismaService,
  config: ConfigService,
  finalizer: OrderFinalizerService,
  wechatClient: WechatPayService,
  orderId: string,
  dto: PayOrderDto,
  actor: AuthUser,
) {
  // Coupons are discounts captured while the order is built. They are not
  // money and must never be accepted as a payment rail. Keep this check
  // before every read or write so even a legacy COUPON payment idempotency
  // replay cannot release a reservation or finalize an order for free.
  if (dto.channel === PaymentChannel.COUPON) {
    throw new BadRequestException('优惠券只能在建单时抵扣，不能作为支付渠道');
  }
  const eventReservation = prisma.eventTeam?.findUnique
    ? await prisma.eventTeam.findUnique({
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
    await prisma.$transaction(
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
  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: dto.idempotencyKey },
  });
  if (existing) {
    if (existing.orderId !== orderId || existing.channel !== dto.channel) {
      throw new ConflictException('支付幂等键已用于其他订单或支付渠道');
    }
    assertPaymentAuthorization(existing.userId, dto.channel, actor);
    if (existing.operatorId !== actor.sub)
      throw new ForbiddenException('支付请求只能由原操作人重试');
    if (
      existing.channel === PaymentChannel.WECHAT &&
      existing.status === PaymentStatus.PROCESSING
    ) {
      const pending = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          membership: { include: { product: true } },
          gameRegistration: { include: { game: true } },
        },
      });
      if (pending?.businessType === BusinessType.VENUE) {
        if (pending.status !== OrderStatus.PENDING)
          throw new ConflictException('订单当前状态不可支付');
        await prisma.$transaction(
          async (tx) => {
            const current = await tx.order.findUniqueOrThrow({
              where: { id: orderId },
            });
            if (current.status !== OrderStatus.PENDING)
              throw new ConflictException('订单当前状态不可支付');
            await reserveBookingCoupon(tx, current);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      }
      if (pending?.membership) {
        if (pending.status !== OrderStatus.PENDING)
          throw new ConflictException('订单当前状态不可支付');
        await assertMembershipPurchaseCompatible(
          prisma,
          pending.membership.memberId,
          pending.membership.product.level,
          pending.membership.id,
        );
      }
      if (pending?.businessType === BusinessType.GAME) {
        const unavailable =
          pending.status !== OrderStatus.PENDING
            ? '订单当前状态不可支付'
            : gamePaymentUnavailable(
                pending.gameRegistration,
                pending.createdAt,
              );
        if (unavailable) throw new ConflictException(unavailable);
      }
    }
    return paymentCommandResponse(existing);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: true,
            bookings: true,
            membership: { include: { product: true } },
            member: { select: { openId: true } },
            trainingEnrollment: true,
            eventTeam: true,
            gameRegistration: { include: { game: true } },
            payments: true,
          },
        });
        if (!order) throw new NotFoundException('订单不存在');
        assertPaymentAuthorization(order.memberId, dto.channel, actor);
        if (order.status !== OrderStatus.PENDING)
          throw new ConflictException('订单当前状态不可支付');
        if (
          dto.channel !== PaymentChannel.WECHAT &&
          order.payments?.some(
            (payment) =>
              payment.channel === PaymentChannel.WECHAT &&
              payment.status === PaymentStatus.PROCESSING,
          )
        )
          throw new ConflictException('微信支付结果确认中，暂不能改用其他渠道');
        if (order.membership)
          await assertMembershipPurchaseCompatible(
            tx,
            order.membership.memberId,
            order.membership.product.level,
            order.membership.id,
          );
        await reserveBookingCoupon(tx, order);
        const deadline = pendingPaymentDeadline(order);
        if (deadline && deadline <= new Date())
          throw new ConflictException('支付保留期已过，请刷新订单后重新下单');
        if (order.businessType === BusinessType.GAME) {
          const unavailable = gamePaymentUnavailable(
            order.gameRegistration,
            order.createdAt,
          );
          if (unavailable) throw new ConflictException(unavailable);
        }
        if (order.businessType === BusinessType.VENUE) {
          const booking = order.bookings[0];
          if (
            !booking ||
            booking.status !== BookingStatus.HELD ||
            !booking.holdExpiresAt ||
            booking.holdExpiresAt <= new Date()
          ) {
            throw new ConflictException('场地支付保留期已过期，请重新选择时段');
          }
        }
        if (order.businessType === BusinessType.GOODS) {
          await assertGoodsStockAvailable(tx, order.items, {
            orderId: order.id,
            reservePayments: true,
            lock: true,
          });
        }
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

        const zeroAmount = order.payableCents === 0;
        if (
          zeroAmount &&
          dto.expectedDebitAmount !== undefined &&
          dto.expectedDebitAmount !== 0
        ) {
          throw new ConflictException(
            '抵扣报价已变化，请重新选择支付方式并核对金额',
          );
        }
        const accountType = ACCOUNT_CHANNELS[dto.channel];
        if (accountType && !zeroAmount) {
          const debitAmount = await accountDebitAmount(
            tx,
            dto.channel,
            order.payableCents,
          );
          if (
            dto.expectedDebitAmount !== undefined &&
            dto.expectedDebitAmount !== debitAmount
          ) {
            throw new ConflictException(
              '抵扣报价已变化，请重新选择支付方式并核对金额',
            );
          }
          const account = await tx.account.findUnique({
            where: {
              userId_type: { userId: order.memberId, type: accountType },
            },
          });
          if (
            !account ||
            account.balance - Math.max(0, account.frozenBalance || 0) <
              debitAmount
          )
            throw new BadRequestException('账户余额不足');
          const updated = await tx.account.updateMany({
            where: {
              id: account.id,
              version: account.version,
              frozenBalance: { lte: account.balance - debitAmount },
            },
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
          !accountType &&
          dto.channel !== PaymentChannel.WECHAT &&
          dto.channel !== PaymentChannel.OFFLINE_CASH
        ) {
          throw new BadRequestException('暂不支持该支付渠道');
        }

        const mockWechat =
          dto.channel !== PaymentChannel.WECHAT ||
          config.get<string>('PAYMENT_PROVIDER', 'mock') === 'mock';
        if (!mockWechat && !zeroAmount) {
          if (!order.member.openId)
            throw new BadRequestException(
              '当前用户未绑定微信 OpenID，无法发起微信支付',
            );
          const wechatPay = await wechatClient.createJsapiPayment({
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
              !zeroAmount && dto.channel === PaymentChannel.WECHAT
                ? serial('MOCKWX')
                : undefined,
            providerPayload: {
              provider: zeroAmount
                ? 'zero-amount'
                : dto.channel === PaymentChannel.WECHAT
                  ? 'mock-wechat'
                  : 'internal',
              operatorId: actor.sub,
              frontDeskShiftId:
                shiftAuthorization?.mode === 'OPEN_SHIFT'
                  ? shiftAuthorization.shiftId
                  : null,
              adminEmergencyBypass: shiftAuthorization?.mode === 'ADMIN_BYPASS',
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
        await finalizer.finalize(
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
    return paymentCommandResponse(result);
  } catch (error) {
    // The unique idempotency key is also the concurrency boundary. If two
    // devices create the same payment simultaneously, resolve the losing
    // transaction to the committed payment instead of leaking P2002.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const concurrent = await prisma.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (concurrent) {
        if (
          concurrent.orderId !== orderId ||
          concurrent.channel !== dto.channel
        ) {
          throw new ConflictException('支付幂等键已用于其他订单或支付渠道');
        }
        assertPaymentAuthorization(concurrent.userId, dto.channel, actor);
        if (concurrent.operatorId !== actor.sub)
          throw new ForbiddenException('支付请求只能由原操作人重试');
        return paymentCommandResponse(concurrent);
      }
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    )
      throw new ConflictException('支付数据发生并发变更，请刷新后重试');
    throw error;
  }
}

export function assertPaymentAuthorization(
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
      throw new ForbiddenException('账户余额只能由会员本人支付，员工不得代扣');
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

export async function accountDebitAmount(
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
  const centValue = typeof parameter?.value === 'number' ? parameter.value : 1;
  if (!Number.isFinite(centValue) || centValue <= 0)
    throw new BadRequestException('羽球币兑换参数无效');
  return Math.ceil(payableCents / centValue);
}
