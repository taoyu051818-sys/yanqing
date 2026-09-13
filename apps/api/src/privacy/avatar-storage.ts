import { join, posix } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const avatarPattern =
  /^\/uploads\/avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp))$/;

export function generatedAvatarFilename(avatarUrl: string | null | undefined) {
  return avatarUrl?.match(avatarPattern)?.[1] ?? null;
}

export function avatarUploadRoot(config: ConfigService) {
  return (
    config.get<string>('UPLOAD_DIR') ||
    config.get<string>('STORAGE_LOCAL_PATH') ||
    join(process.cwd(), 'uploads')
  );
}

export async function queueAvatarDeletion(
  tx: Prisma.TransactionClient,
  avatarUrl: string | null | undefined,
) {
  const filename = generatedAvatarFilename(avatarUrl);
  if (!filename) return;
  // Persist with the anonymization transaction. No filesystem writes here.
  await tx.avatarDeletionTask.upsert({
    where: { filename },
    create: { filename },
    update: {},
  });
}

export function configureUploadAssets(
  app: NestExpressApplication,
  config: ConfigService,
  prisma: PrismaService,
) {
  app.use(
    '/uploads',
    async (req: Request, res: Response, next: NextFunction) => {
      let avatarUrl: string;
      try {
        // Match the normalized path used by static serving, including old URL aliases.
        const relative = posix.normalize(decodeURIComponent(req.path));
        if (!/^\/avatars(?:\/|$)/i.test(relative)) {
          next();
          return;
        }
        avatarUrl = `/uploads/avatars${relative.slice('/avatars'.length)}`;
      } catch {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      if (!generatedAvatarFilename(avatarUrl)) {
        res.status(404).end();
        return;
      }
      try {
        const owner = await prisma.user.findFirst({
          where: { avatarUrl, status: { not: 'DELETED' }, deletedAt: null },
          select: { id: true },
        });
        if (!owner) {
          res.status(404).end();
          return;
        }
        next();
      } catch {
        res.status(503).end();
      }
    },
  );
  app.useStaticAssets(avatarUploadRoot(config), { prefix: '/uploads/' });
}
