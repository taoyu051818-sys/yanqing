import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  rm,
  readFile,
  mkdir,
  writeFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrivacyService } from '../src/privacy/privacy.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import {
  configureUploadAssets,
  generatedAvatarFilename,
} from '../src/privacy/avatar-storage.js';
import { AvatarCleanupService } from '../src/privacy/avatar-cleanup.service.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => `avatar-${randomUUID()}`;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5z0AAAAASUVORK5CYII=',
  'base64',
);
describe.skipIf(!url)(
  'avatar data erasure with actual upload, PostgreSQL and local HTTP',
  () => {
    let db: PrismaService,
      app: NestExpressApplication,
      root: string,
      auth: AuthService,
      privacy: PrivacyService,
      admin: AuthUser;
    let cleanup: AvatarCleanupService;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error('Local isolated database required');
      root = await mkdtemp(join(tmpdir(), 'yanqing-avatar-fix-'));
      const config = new ConfigService({
        DATABASE_URL: url,
        UPLOAD_DIR: root,
        NODE_ENV: 'test',
      });
      db = new PrismaService(config);
      await db.$connect();
      auth = new AuthService(db, {} as never, config);
      privacy = new PrivacyService(db);
      cleanup = new AvatarCleanupService(db, config);
      const module = await Test.createTestingModule({}).compile();
      app = module.createNestApplication<NestExpressApplication>();
      configureUploadAssets(app, config, db);
      await app.init();
      const actor = await db.user.create({
        data: { displayName: key(), primaryRole: 'SUPER_ADMIN' },
      });
      admin = {
        sub: actor.id,
        displayName: actor.displayName,
        roles: ['SUPER_ADMIN'],
      };
    });
    afterAll(async () => {
      if (app) await app.close();
      if (db) await db.$disconnect();
      if (root) await rm(root, { recursive: true, force: true });
    });
    async function fixture() {
      const user = await db.user.create({
        data: { displayName: key(), memberProfile: { create: { tags: [] } } },
      });
      const actor: AuthUser = {
        sub: user.id,
        displayName: user.displayName,
        roles: ['MEMBER'],
      };
      const uploaded = await auth.updateAvatar(user.id, {
        buffer: png,
      } as Express.Multer.File);
      const avatarUrl = uploaded.avatarUrl!;
      const filename = generatedAvatarFilename(avatarUrl)!;
      const erasure = await privacy.create(
        { reason: '申请删除账号数据', idempotencyKey: key() },
        actor,
      );
      return {
        user,
        actor,
        avatarUrl,
        filename,
        path: join(root, 'avatars', filename),
        erasure,
      };
    }
    async function complete(
      f: Awaited<ReturnType<typeof fixture>>,
      service = privacy,
    ) {
      const { user, erasure } = f;
      await db.user.update({
        where: { id: user.id },
        data: { status: 'DISABLED' },
      });
      return service.complete(
        erasure.id,
        { reason: '确认注销申请无未完成业务', idempotencyKey: key() },
        admin,
      );
    }
    it('denies the old URL immediately after commit and deletes its file from a durable task', async () => {
      const f = await fixture();
      await request(app.getHttpServer())
        .get(f.avatarUrl)
        .expect(200)
        .expect('Cache-Control', /no-store/);
      await complete(f);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).status,
      ).toBe('DELETED');
      await request(app.getHttpServer()).get(f.avatarUrl).expect(404);
      expect(await readFile(f.path)).toEqual(png);
      expect(
        await db.avatarDeletionTask.findUniqueOrThrow({
          where: { filename: f.filename },
        }),
      ).toMatchObject({ attempts: 0, completedAt: null });
      await cleanup.sweep();
      await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        (
          await db.avatarDeletionTask.findUniqueOrThrow({
            where: { filename: f.filename },
          })
        ).completedAt,
      ).not.toBeNull();
    });
    it('keeps a failed filesystem deletion retryable without reopening the avatar URL', async () => {
      const f = await fixture();
      await complete(f);
      // An actual filesystem error, without mocking the worker or PostgreSQL.
      await rm(f.path);
      await mkdir(f.path);
      await cleanup.sweep();
      const failed = await db.avatarDeletionTask.findUniqueOrThrow({
        where: { filename: f.filename },
      });
      expect(failed.completedAt).toBeNull();
      expect(failed.attempts).toBe(1);
      expect(failed.lastErrorCode).toBeTruthy();
      await request(app.getHttpServer()).get(f.avatarUrl).expect(404);
      await rm(f.path, { recursive: true });
      await writeFile(f.path, png);
      await cleanup.sweep(new Date(+failed.nextAttemptAt + 1));
      await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        await db.avatarDeletionTask.findUniqueOrThrow({
          where: { filename: f.filename },
        }),
      ).toMatchObject({ attempts: 2, lastErrorCode: null });
    });
    it('rolls back the cleanup task and keeps the original file when anonymization fails', async () => {
      const f = await fixture();
      const failing = db.$extends({
        query: {
          auditLog: {
            async create({ args, query }) {
              if (args.data.action === 'DATA_ERASURE_COMPLETED')
                throw new Error(
                  'Synthetic post-anonymization transaction failure',
                );
              return query(args);
            },
          },
        },
      });
      await expect(
        complete(f, new PrivacyService(failing as unknown as PrismaService)),
      ).rejects.toThrow('Synthetic post-anonymization');
      expect(
        await db.user.findUniqueOrThrow({ where: { id: f.user.id } }),
      ).toMatchObject({
        status: 'DISABLED',
        avatarUrl: f.avatarUrl,
        deletedAt: null,
      });
      expect(
        await db.avatarDeletionTask.findUnique({
          where: { filename: f.filename },
        }),
      ).toBeNull();
      expect(await readFile(f.path)).toEqual(png);
      await request(app.getHttpServer()).get(f.avatarUrl).expect(200);
    });
    it('denies an unreferenced historical avatar even while its file still exists', async () => {
      const filename = `${randomUUID()}.png`;
      await writeFile(join(root, 'avatars', filename), png);
      await request(app.getHttpServer())
        .get(`/uploads/avatars/${filename}`)
        .expect(404);
    });
    it('does not delete an avatar which another live account still references', async () => {
      const f = await fixture();
      await db.avatarDeletionTask.create({ data: { filename: f.filename } });
      await cleanup.sweep();
      expect(await readFile(f.path)).toEqual(png);
      expect(
        await db.avatarDeletionTask.findUniqueOrThrow({
          where: { filename: f.filename },
        }),
      ).toMatchObject({ completedAt: null, lastErrorCode: 'STILL_REFERENCED' });
      await request(app.getHttpServer()).get(f.avatarUrl).expect(200);
    });
    it('rejects a delayed avatar update once the account is disabled and removes the unused new file', async () => {
      const f = await fixture();
      await db.user.update({
        where: { id: f.user.id },
        data: { status: 'DISABLED' },
      });
      const before = (await readdir(join(root, 'avatars'))).sort();
      await expect(
        auth.updateAvatar(f.user.id, { buffer: png } as Express.Multer.File),
      ).rejects.toMatchObject({ status: 401 });
      expect((await readdir(join(root, 'avatars'))).sort()).toEqual(before);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: f.user.id } }))
          .avatarUrl,
      ).toBe(f.avatarUrl);
    });
  },
);
