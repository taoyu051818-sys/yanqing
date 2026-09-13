import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { RefundStatus } from '../generated/prisma/client.js';
import { WechatPayService } from './wechat-pay.service.js';
import { OrderFinalizerService } from './order-finalizer.service.js';
import { dispatchWechatRefund } from './wechat/refund-dispatch.js';

@Injectable()
export class RefundDispatchService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RefundDispatchService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;
  private afterId?: string;
  private readonly nextAttempt = new Map<string, number>();
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(WechatPayService) private readonly wechat: WechatPayService,
    @Inject(OrderFinalizerService)
    private readonly finalizer: OrderFinalizerService,
  ) {}
  onApplicationBootstrap() {
    if (this.config.get('PAYMENT_PROVIDER', 'mock') !== 'wechat') return;
    const run = () =>
      void this.sweep().catch(() =>
        this.logger.warn('退款同步批次暂未完成，稍后重试'),
      );
    run();
    this.timer = setInterval(run, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  sweep(now = new Date()): Promise<number> {
    if (this.running) return this.running;
    const work = this.sweepOnce(now).finally(() => {
      if (this.running === work) this.running = undefined;
    });
    this.running = work;
    return work;
  }
  private async sweepOnce(now: Date) {
    if (this.config.get('PAYMENT_PROVIDER', 'mock') !== 'wechat') return 0;
    for (const [id, due] of this.nextAttempt)
      if (due <= now.getTime()) this.nextAttempt.delete(id);
    const rows = await this.prisma.refund.findMany({
      where: {
        status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING] },
        approvedAt: { not: null },
        approvedById: { not: null },
        ...(this.afterId ? { id: { gt: this.afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 25,
      select: { id: true, status: true, approvedAt: true },
    });
    this.afterId = rows.length === 25 ? rows[rows.length - 1].id : undefined;
    let count = 0;
    for (const row of rows) {
      const ageMinutes = (now.getTime() - row.approvedAt!.getTime()) / 60_000;
      const interval =
        ageMinutes < 5 ? 1 : ageMinutes < 30 ? 5 : ageMinutes < 120 ? 10 : 30;
      if ((this.nextAttempt.get(row.id) ?? 0) > now.getTime()) continue;
      this.nextAttempt.set(row.id, now.getTime() + interval * 60_000);
      try {
        await dispatchWechatRefund(
          this.prisma,
          this.wechat,
          this.finalizer,
          row.id,
        );
        count++;
      } catch {
        this.logger.warn(`退款 ${row.id} 暂未完成同步`);
      }
    }
    return count;
  }
}
