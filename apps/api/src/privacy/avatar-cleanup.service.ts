import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { avatarUploadRoot, generatedAvatarFilename } from './avatar-storage.js';

@Injectable()
export class AvatarCleanupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AvatarCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV') === 'test') return;
    const run = () =>
      void this.sweep().catch(() =>
        this.logger.warn('头像文件清理暂未完成，稍后重试'),
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
    const rows = await this.prisma.avatarDeletionTask.findMany({
      where: { completedAt: null, nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    let completed = 0;
    for (const task of rows) {
      const avatarUrl = `/uploads/avatars/${task.filename}`;
      let errorCode: string | null = null;
      if (!generatedAvatarFilename(avatarUrl)) errorCode = 'INVALID_FILENAME';
      else {
        const owner = await this.prisma.user.findFirst({
          where: { avatarUrl, status: { not: 'DELETED' }, deletedAt: null },
          select: { id: true },
        });
        if (owner) errorCode = 'STILL_REFERENCED';
        else {
          try {
            await unlink(
              join(avatarUploadRoot(this.config), 'avatars', task.filename),
            );
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            // A different worker or an earlier interrupted attempt may have
            // already removed the file. This remains a successful completion.
            if (code !== 'ENOENT')
              errorCode = code?.slice(0, 60) || 'DELETE_FAILED';
          }
        }
      }
      const result = await this.prisma.avatarDeletionTask.updateMany({
        where: { id: task.id, completedAt: null },
        data: {
          attempts: { increment: 1 },
          completedAt: errorCode ? null : now,
          lastErrorCode: errorCode,
          nextAttemptAt: new Date(
            now.getTime() +
              Math.min(3_600_000, 60_000 * 2 ** Math.min(task.attempts, 6)),
          ),
        },
      });
      if (!errorCode) completed += result.count;
    }
    return completed;
  }
}
