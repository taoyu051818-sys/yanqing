import { it, expect, vi } from 'vitest';
import { TrainingCatalogService } from './training-catalog.service.js';
import { AppRole, TrainingAudience } from '../../generated/prisma/enums.js';
it('generates a course code once and replays a blank-code creation without a second write', async () => {
  let product: any, audit: any;
  const tx = {
    auditLog: {
      findFirst: vi.fn(() => audit),
      create: vi.fn(({ data }) => {
        audit = data;
        return data;
      }),
    },
    trainingProduct: {
      create: vi.fn(({ data }) => {
        product = { ...data, id: 'product-1', enabled: true };
        return product;
      }),
      findUnique: vi.fn(() => product),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (operation: any) => operation(tx)),
  };
  const service = new TrainingCatalogService(prisma as never);
  const command = {
    name: '成人一对一',
    audience: TrainingAudience.ADULT,
    totalSessions: 12,
    validityDays: 120,
    priceCents: 128000,
    refundRule: { beforeStart: 'FULL' },
    creationIdempotencyKey: 'generated-code-retry-1',
  };
  const actor = { sub: 'admin', displayName: '管理员', roles: [AppRole.ADMIN] };
  const first = await service.createProduct(command, actor),
    second = await service.createProduct(command, actor);
  expect(first.code).toMatch(/^COURSE\d{14}[A-F0-9]{6}$/);
  expect(second.code).toBe(first.code);
  expect(tx.trainingProduct.create).toHaveBeenCalledOnce();
  expect(tx.auditLog.create).toHaveBeenCalledOnce();
  expect(audit.newValue.code).toBe(first.code);
});
