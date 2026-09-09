import { Inject } from '@nestjs/common';
import { releasePendingOrderResources } from '../pending-order-resources.js';
import { transitionOrder } from '../order-transition.js';
import { cancelZeroAmountVenueOrder } from '../zero-amount-venue-order.js';
import { gamePaymentUnavailable } from '../../games/game-registration-policy.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BookingStatus,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
  TrainingEnrollmentStatus,
} from '../../generated/prisma/client.js';
import type { CancelPendingOrderDto } from '../orders.dto.js';
import { WechatPayService } from '../../payments/wechat-pay.service.js';
import { orderResponse } from '../order-response.js';
import {
  DIRECT_CANCEL_TYPES,
  PURCHASE_HOLD_MS,
  PURCHASE_TIMEOUT_TYPES,
  pendingPaymentDeadline,
} from '../pending-order-policy.js';

@Injectable()
export class PendingOrdersService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PendingOrdersService.name);
  private expiryTimer?: ReturnType<typeof setInterval>;
  private expirySweep?: Promise<number>;
  private purchaseSweep?: Promise<number>;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(WechatPayService) private readonly wechatPay: WechatPayService,
  ) {}
  async cancelPending(
    orderId: string,
    dto: CancelPendingOrderDto,
    actor: AuthUser,
  ) {
    return this.cancelUnpaidOrder(
      orderId,
      dto.reason?.trim() || '用户取消待支付订单',
      dto.idempotencyKey,
      actor,
    );
  }
  async expirePendingOrders(now = new Date()): Promise<number> {
    if (this.purchaseSweep) return this.purchaseSweep;
    const sweep = this.expirePendingPurchasesOnce(now).finally(() => {
      if (this.purchaseSweep === sweep) this.purchaseSweep = undefined;
    });
    this.purchaseSweep = sweep;
    return sweep;
  }
  async expirePendingVenueOrders(now = new Date()): Promise<number> {
    if (this.expirySweep) return this.expirySweep;
    const sweep = this.expirePendingVenueOrdersOnce(now).finally(() => {
      if (this.expirySweep === sweep) this.expirySweep = undefined;
    });
    this.expirySweep = sweep;
    return sweep;
  }
  onApplicationBootstrap() {
    const sweep = () =>
      void this.expirePendingOrders().catch((error) =>
        this.logger.error(String(error)),
      );
    sweep();
    this.expiryTimer = setInterval(sweep, 30_000);
    this.expiryTimer.unref();
  }
  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }
  private async expirePendingPurchasesOnce(now: Date): Promise<number> {
    const venueCount = await this.expirePendingVenueOrders(now);
    const candidates = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        OR: [
          {
            businessType: { in: PURCHASE_TIMEOUT_TYPES as BusinessType[] },
            createdAt: { lte: new Date(now.getTime() - PURCHASE_HOLD_MS) },
          },
          {
            businessType: BusinessType.GAME,
            gameRegistration: {
              is: {
                game: {
                  OR: [
                    { startsAt: { lte: now } },
                    { status: { notIn: ['OPEN', 'FULL'] } },
                  ],
                },
              },
            },
          },
          {
            businessType: BusinessType.TRAINING,
            trainingEnrollment: {
              is: {
                status: TrainingEnrollmentStatus.PENDING_PAYMENT,
                seatReservedUntil: { lte: now },
              },
            },
          },
          {
            businessType: BusinessType.EVENT,
            eventTeam: {
              is: {
                status: RegistrationStatus.REGISTERED,
                paymentDueAt: { lte: now },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        businessType: true,
        createdAt: true,
        gameRegistration: { include: { game: true } },
        trainingEnrollment: { select: { seatReservedUntil: true } },
        eventTeam: { select: { paymentDueAt: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let count = venueCount;
    for (const item of candidates) {
      const deadline = pendingPaymentDeadline(item);
      if (
        deadline &&
        deadline > now &&
        !(
          item.businessType === BusinessType.GAME &&
          gamePaymentUnavailable(item.gameRegistration, item.createdAt, now)
        )
      )
        continue;
      try {
        await this.cancelUnpaidOrder(
          item.id,
          '订单支付保留期届满',
          `AUTO:PURCHASE_ORDER:${item.id}`,
        );
        count++;
      } catch (error) {
        this.logger.warn(
          `待付款订单 ${item.id} 自动关闭未完成：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }
    return count;
  }
  private async expirePendingVenueOrdersOnce(now: Date): Promise<number> {
    const candidates = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        businessType: BusinessType.VENUE,
        bookings: {
          some: {
            // Older releases freed the court without closing its pending
            // order. A retained, expired deadline identifies those legacy
            // holds; they must still pass the normal payment/close checks.
            status: { in: [BookingStatus.HELD, BookingStatus.CANCELLED] },
            holdExpiresAt: { lte: now },
          },
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let expired = 0;
    for (const candidate of candidates) {
      try {
        await this.cancelUnpaidOrder(
          candidate.id,
          '场地订单支付保留期届满',
          `AUTO:VENUE_ORDER:${candidate.id}`,
        );
        expired += 1;
      } catch (error) {
        this.logger.warn(
          `场地待支付订单 ${candidate.id} 自动取消暂未完成：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }
    return expired;
  }
  private async cancelUnpaidOrder(
    orderId: string,
    reason: string,
    idempotencyKey: string,
    actor?: AuthUser,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        refunds: { orderBy: { requestedAt: 'desc' } },
        bookings: { include: { court: true } },
        gameRegistration: { include: { game: true } },
        eventTeam: true,
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      actor &&
      order.memberId !== actor.sub &&
      !actor.roles.some((role) =>
        [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
          role as never,
        ),
      )
    ) {
      throw new ForbiddenException('仅会员本人、前台或管理员可取消待支付订单');
    }
    if (
      !DIRECT_CANCEL_TYPES.includes(order.businessType) &&
      !(order.businessType === BusinessType.EVENT && !actor)
    ) {
      throw new BadRequestException(
        '请从赛事报名详情退出，系统会同步队伍和候补名额',
      );
    }
    if (order.status === OrderStatus.CANCELLED) return orderResponse(order);
    if (
      actor &&
      order.businessType === BusinessType.VENUE &&
      order.status === OrderStatus.PAID &&
      order.payableCents === 0 &&
      order.paidCents === 0 &&
      order.refundedCents === 0
    ) {
      return cancelZeroAmountVenueOrder(
        this.prisma,
        orderId,
        actor,
        reason,
        idempotencyKey,
      );
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException('订单已进入支付或履约流程，不能直接取消');
    }
    if (
      order.payments.some(
        (payment) => payment.status === PaymentStatus.SUCCEEDED,
      )
    ) {
      throw new ConflictException('订单已经支付，请刷新后按退款流程处理');
    }
    const processingWechat = order.payments.filter(
      (payment) =>
        [PaymentStatus.CREATED, PaymentStatus.PROCESSING].includes(
          payment.status as never,
        ) && payment.channel === PaymentChannel.WECHAT,
    );
    const realWechat =
      this.config.get<string>('PAYMENT_PROVIDER', 'mock') === 'wechat';
    if (processingWechat.length && realWechat) {
      await this.wechatPay.closeOrder(order.orderNo);
    }

    const cancelled = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: true,
            payments: { orderBy: { createdAt: 'desc' } },
            refunds: { orderBy: { requestedAt: 'desc' } },
            bookings: { include: { court: true } },
            gameRegistration: { include: { game: true } },
            eventTeam: true,
          },
        });
        if (!current) throw new NotFoundException('订单不存在');
        if (current.status === OrderStatus.CANCELLED) return current;
        if (current.status !== OrderStatus.PENDING) {
          throw new ConflictException('订单状态已经变化，请刷新后重试');
        }
        if (
          current.payments.some(
            (payment) => payment.status === PaymentStatus.SUCCEEDED,
          )
        ) {
          throw new ConflictException('订单已经支付，请刷新后按退款流程处理');
        }
        // The provider close only covers attempts observed before this transaction.
        // A newer prepay must pass through closeOrder on a fresh cancellation try.
        if (
          realWechat &&
          current.payments.some(
            (payment) =>
              payment.channel === PaymentChannel.WECHAT &&
              [PaymentStatus.CREATED, PaymentStatus.PROCESSING].includes(
                payment.status as never,
              ) &&
              !processingWechat.some((observed) => observed.id === payment.id),
          )
        )
          throw new ConflictException('微信支付请求已变化，请刷新后重试取消');
        const cancelledAt = new Date();
        const changed = await transitionOrder(tx, 'CANCEL_UNPAID', {
          where: { id: orderId, status: OrderStatus.PENDING },
          data: { status: OrderStatus.CANCELLED, cancelledAt },
        });
        if (changed.count !== 1) {
          throw new ConflictException('订单状态已经变化，请刷新后重试');
        }
        await tx.payment.updateMany({
          where: {
            orderId,
            status: { in: [PaymentStatus.CREATED, PaymentStatus.PROCESSING] },
          },
          data: { status: PaymentStatus.CLOSED },
        });
        await releasePendingOrderResources(tx, current, {
          cause: 'CANCELLATION',
          actor,
          now: cancelledAt,
        });
        await tx.auditLog.create({
          data: {
            actorId: actor?.sub,
            actorRole: actor?.roles[0],
            action: `${current.businessType}_ORDER_${actor ? 'CANCELLED_BY_USER' : 'AUTO_CANCELLED'}`,
            objectType: 'Order',
            objectId: orderId,
            requestId: idempotencyKey,
            oldValue: { status: OrderStatus.PENDING } as never,
            newValue: {
              status: OrderStatus.CANCELLED,
              ...(current.businessType === BusinessType.GAME
                ? {
                    gameId: current.gameRegistration!.gameId,
                    registrationStatus: RegistrationStatus.CANCELLED,
                  }
                : current.businessType === BusinessType.VENUE
                  ? { bookingStatus: BookingStatus.CANCELLED }
                  : {}),
              cancelledAt: cancelledAt.toISOString(),
            } as never,
            reason,
          },
        });
        return tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: {
            items: true,
            payments: { orderBy: { createdAt: 'desc' } },
            refunds: { orderBy: { requestedAt: 'desc' } },
            bookings: { include: { court: true } },
            gameRegistration: { include: { game: true } },
            eventTeam: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return orderResponse(cancelled);
  }
}
