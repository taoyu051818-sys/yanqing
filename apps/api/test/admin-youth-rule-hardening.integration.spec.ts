import { afterAll, describe, expect, it } from 'vitest';
import { YouthTrainingRulesService } from '../src/training/youth-training-rules.service.js';
import {
  actor,
  connection,
  database,
  failAudit,
  key,
} from './support/admin-hardening-db.js';

const prisma = database();
afterAll(async () => {
  await prisma.$disconnect();
});
async function command() {
  const latest = await prisma.youthTrainingRule.findFirst({
    orderBy: { effectiveFrom: 'desc' },
  });
  return {
    maxTotalSessions: 36,
    maxValidityDays: 90,
    maxContractAmountCents: 500000,
    warningThresholdDays: 10,
    hardBlock: true,
    reason: '核对后发布青训规则',
    idempotencyKey: key('youth-rule'),
    effectiveFrom: new Date(
      Math.max(Date.now(), latest?.effectiveFrom.getTime() || 0) + 3600000,
    ).toISOString(),
  };
}
describe.skipIf(!connection)(
  'Administrator youth rule publication on PostgreSQL',
  () => {
    it.each(['ADMIN', 'SUPER_ADMIN'] as const)(
      '%s can publish its own rule once with the actual actor role in history',
      async (role) => {
        const admin = await actor(prisma, role),
          dto = await command();
        const service = new YouthTrainingRulesService(prisma);
        const first = await service.create(dto, admin),
          replay = await service.create(dto, admin);
        expect(first.status).toBe('PUBLISHED');
        expect(replay.id).toBe(first.id);
        expect(
          await prisma.youthTrainingRule.findUniqueOrThrow({
            where: { id: first.id },
          }),
        ).toMatchObject({ requestedById: admin.sub, reviewedById: admin.sub });
        const audit = await prisma.auditLog.findMany({
          where: { objectId: first.id },
        });
        expect(audit).toHaveLength(2);
        expect(
          audit.every(
            (row) => row.actorId === admin.sub && row.actorRole === role,
          ),
        ).toBe(true);
      },
    );
    it('a failed publication retains a recoverable draft and original-key retry does not create another version', async () => {
      const admin = await actor(prisma),
        dto = await command();
      await expect(
        new YouthTrainingRulesService(
          failAudit(prisma, 'YOUTH_TRAINING_RULE_PUBLISHED'),
        ).create(dto, admin),
      ).rejects.toThrow('Injected final audit failure');
      const draft = await prisma.youthTrainingRule.findUniqueOrThrow({
        where: { requestIdempotencyKey: dto.idempotencyKey },
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.reviewedById).toBeNull();
      const result = await new YouthTrainingRulesService(prisma).create(
        dto,
        admin,
      );
      expect(result).toMatchObject({ id: draft.id, status: 'PUBLISHED' });
      expect(
        await prisma.auditLog.count({
          where: {
            objectId: draft.id,
            action: 'YOUTH_TRAINING_RULE_PUBLISHED',
          },
        }),
      ).toBe(1);
    });
    it('finance cannot draft or publish a youth rule', async () => {
      const finance = await actor(prisma, 'FINANCE'),
        service = new YouthTrainingRulesService(prisma);
      await expect(
        service.create(await command(), finance),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.publish(
          'unavailable',
          { reason: '越权发布', idempotencyKey: key('forbidden') },
          finance,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  },
);
