import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { canExecuteDirectly } from '../../common/auth/admin-execution.js';
import type { ActivityRefundJob } from '../../generated/prisma/client.js';
import { OrderRefundReviewService } from './orders-refund-review.service.js';

const LEASE_MS = 120_000;
const BATCH_SIZE = 8;
/** Consumes durable authorization written in the activity cancellation transaction. */
@Injectable()
export class ActivityRefundExecutionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ActivityRefundExecutionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;
  private stopped = false;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderRefundReviewService)
    private readonly refunds: OrderRefundReviewService,
  ) {}
  onApplicationBootstrap() {
    this.stopped = false;
    const run = () =>
      void this.sweep().catch(() =>
        this.logger.warn('活动退款任务暂未完成，稍后自动恢复'),
      );
    run();
    this.timer = setInterval(run, 5_000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => {});
  }
  sweep(now = new Date()): Promise<number> {
    if (this.running) return this.running;
    const work = this.sweepOnce(now).finally(() => {
      this.running = undefined;
    });
    this.running = work;
    return work;
  }
  private async sweepOnce(now: Date) {
    const eligible = {
      nextAttemptAt: { lte: now },
      OR: [
        { status: 'QUEUED' },
        { status: 'RUNNING', leaseExpiresAt: { lte: now } },
      ],
    };
    const jobs = await this.prisma.activityRefundJob.findMany({
      where: eligible,
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: 4,
    });
    let claimed = 0;
    for (const job of jobs) {
      if (this.stopped) break;
      const leaseToken = randomUUID();
      const claim = await this.prisma.activityRefundJob.updateMany({
        where: { id: job.id, ...eligible },
        data: {
          status: 'RUNNING',
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          attempts: { increment: 1 },
        },
      });
      if (claim.count !== 1) continue;
      claimed++;
      try {
        await this.process(job, leaseToken);
      } catch {
        // A crashed process or failed DB write is recovered by the expired lease.
        await this.release(
          job,
          leaseToken,
          '退款暂未提交，系统将自动重试',
          true,
        );
      }
    }
    return claimed;
  }
  private async process(job: ActivityRefundJob, leaseToken: string) {
    const actor: AuthUser = {
      sub: job.actorId,
      roles: job.actorRoles,
      displayName: '活动取消操作人',
    };
    if (!canExecuteDirectly(actor) || !['GAME', 'EVENT'].includes(job.kind)) {
      await this.release(
        job,
        leaseToken,
        '任务缺少有效的管理员授权，请核对取消记录',
        true,
      );
      return;
    }
    const where = {
      cancellationRequired: true,
      status: 'REQUESTED' as const,
      order:
        job.kind === 'GAME'
          ? { gameRegistration: { gameId: job.activityId } }
          : { eventTeam: { eventId: job.activityId } },
    };
    const rows = await this.prisma.refund.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    let failed = false;
    for (const row of rows) {
      if (this.stopped) break;
      const renewed = await this.prisma.activityRefundJob.updateMany({
        where: { id: job.id, status: 'RUNNING', leaseToken },
        data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      });
      if (renewed.count !== 1) return;
      try {
        await this.refunds.approveRefund(
          row.id,
          { reason: `管理员取消活动：${job.reason}`.slice(0, 300) },
          actor,
        );
      } catch {
        failed = true;
      }
    }
    const remaining = await this.prisma.refund.count({ where });
    if (!remaining) {
      await this.prisma.activityRefundJob.updateMany({
        where: { id: job.id, status: 'RUNNING', leaseToken },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
    } else {
      await this.release(
        job,
        leaseToken,
        failed ? `${remaining}笔退款暂未提交，系统将自动重试` : null,
        failed,
      );
    }
  }
  private release(
    job: ActivityRefundJob,
    leaseToken: string,
    lastError: string | null,
    failed: boolean,
  ) {
    const delay = failed
      ? Math.min(300_000, 5_000 * 2 ** Math.min(job.attempts, 6))
      : 0;
    return this.prisma.activityRefundJob.updateMany({
      where: { id: job.id, status: 'RUNNING', leaseToken },
      data: {
        status: 'QUEUED',
        leaseToken: null,
        leaseExpiresAt: null,
        lastError,
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  }
}
