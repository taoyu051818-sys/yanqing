import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  YouthTrainingRuleStatus,
} from '../generated/prisma/enums.js'
import { YouthTrainingRulesService } from './youth-training-rules.service.js'
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js'

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '制单管理员',
  roles: [AppRole.ADMIN],
}
const reviewer: AuthUser = {
  sub: 'super-1',
  displayName: '超级复核员',
  roles: [AppRole.SUPER_ADMIN],
}
const member: AuthUser = {
  sub: 'member-1',
  displayName: '普通会员',
  roles: [AppRole.MEMBER],
}

const activeRule = (overrides: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  version: 'YTR-001',
  status: YouthTrainingRuleStatus.PUBLISHED,
  maxTotalSessions: 20,
  maxValidityDays: 180,
  maxContractAmountCents: 300_000,
  warningThresholdDays: 30,
  hardBlock: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  ...overrides,
})

describe('YouthTrainingRulesService', () => {
  let prisma: any
  let service: YouthTrainingRulesService

  beforeEach(() => {
    prisma = {
      youthTrainingRule: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    prisma.$transaction = vi.fn(async (work: any) => work(prisma))
    service = new YouthTrainingRulesService(prisma)
  })

  it('blocks youth sales when no reviewed rule is effective', async () => {
    prisma.youthTrainingRule.findFirst.mockResolvedValue(null)
    await expect(
      service.validateProduct({
        totalSessions: 10,
        validityDays: 90,
        priceCents: 100_000,
      }),
    ).rejects.toThrow('正式销售已阻断')
  })

  it('hard-blocks configured violations without inventing any statutory value', async () => {
    prisma.youthTrainingRule.findFirst.mockResolvedValue(activeRule())
    await expect(
      service.validateProduct({
        totalSessions: 21,
        validityDays: 181,
        priceCents: 300_001,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('returns a versioned warning snapshot when the reviewed rule disables hard blocking', async () => {
    prisma.youthTrainingRule.findFirst.mockResolvedValue(
      activeRule({ hardBlock: false }),
    )
    const result = await service.validateProduct({
      totalSessions: 21,
      validityDays: 90,
      priceCents: 100_000,
    })
    expect(result).toMatchObject({
      ruleId: 'rule-1',
      version: 'YTR-001',
      result: 'WARNING',
      limits: { hardBlock: false, warningThresholdDays: 30 },
    })
    expect(result.violations).toHaveLength(1)
  })

  it('uses the configured expiry threshold as a visible product warning and enforces list roles in service', async () => {
    prisma.youthTrainingRule.findFirst.mockResolvedValue(activeRule())
    const result = await service.validateProduct({
      totalSessions: 20,
      validityDays: 160,
      priceCents: 300_000,
    })
    expect(result).toMatchObject({
      result: 'WARNING',
      violations: [],
      warnings: [expect.stringContaining('仅余 20 天')],
    })
    expect(() => service.list({}, member)).toThrow(ForbiddenException)
    service.list({}, admin)
    expect(prisma.youthTrainingRule.findMany).toHaveBeenCalled()
  })

  it('creates a complete ADMIN draft idempotently and writes immutable audit evidence', async () => {
    const dto = {
      maxTotalSessions: 20,
      maxValidityDays: 180,
      maxContractAmountCents: 300_000,
      warningThresholdDays: 30,
      hardBlock: true,
      effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
      reason: '依据当前经营合规要求制单',
      idempotencyKey: 'youth-rule-draft-001',
    }
    prisma.youthTrainingRule.findUnique.mockResolvedValue(null)
    prisma.youthTrainingRule.create.mockImplementation(({ data }: any) => ({
      id: 'rule-draft',
      status: YouthTrainingRuleStatus.DRAFT,
      ...data,
    }))

    const created = await service.create(dto, admin)
    expect(created.status).toBe(YouthTrainingRuleStatus.DRAFT)
    expect(prisma.youthTrainingRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedById: admin.sub,
        requestIdempotencyKey: dto.idempotencyKey,
        hardBlock: true,
      }),
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'YOUTH_TRAINING_RULE_DRAFTED',
        requestId: dto.idempotencyKey,
      }),
    })
  })

  it('enforces maker/checker and compare-and-set publication', async () => {
    const future = new Date(Date.now() + 3_600_000)
    const draft = {
      ...activeRule({
        id: 'draft-1',
        status: YouthTrainingRuleStatus.DRAFT,
        requestedById: admin.sub,
        effectiveFrom: future,
      }),
      reviewReason: null,
      reviewedById: null,
    }
    prisma.youthTrainingRule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draft)
    prisma.youthTrainingRule.findFirst
      .mockResolvedValueOnce(activeRule({ id: 'old-rule' }))
      .mockResolvedValueOnce(null)
    prisma.youthTrainingRule.updateMany.mockResolvedValue({ count: 1 })
    prisma.youthTrainingRule.findUniqueOrThrow.mockResolvedValue({
      ...draft,
      status: YouthTrainingRuleStatus.PUBLISHED,
      reviewedById: reviewer.sub,
    })

    const result = await service.publish(
      'draft-1',
      { reason: '复核字段完整且同意发布', idempotencyKey: 'publish-rule-001' },
      reviewer,
    )
    expect(result.status).toBe(YouthTrainingRuleStatus.PUBLISHED)
    expect(prisma.youthTrainingRule.update).toHaveBeenCalledWith({
      where: { id: 'old-rule' },
      data: {
        status: YouthTrainingRuleStatus.SUPERSEDED,
        effectiveTo: future,
      },
    })
    expect(prisma.youthTrainingRule.updateMany).toHaveBeenCalledWith({
      where: { id: 'draft-1', status: YouthTrainingRuleStatus.DRAFT },
      data: expect.objectContaining({
        reviewedById: reviewer.sub,
        decisionCommandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    })
  })

  it('rejects trimmed blank command text and an invalid warning threshold', async () => {
    await expect(
      service.create(
        {
          maxTotalSessions: 10,
          maxValidityDays: 20,
          maxContractAmountCents: 100_000,
          warningThresholdDays: 21,
          hardBlock: true,
          effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
          reason: '完整制单原因',
          idempotencyKey: 'youth-rule-invalid-threshold',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.create(
        {
          maxTotalSessions: 10,
          maxValidityDays: 20,
          maxContractAmountCents: 100_000,
          warningThresholdDays: 2,
          hardBlock: true,
          effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
          reason: '   ',
          idempotencyKey: '        ',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('recovers same-command P2034 draft and P2002 decision races exactly', async () => {
    const effectiveFrom = new Date(Date.now() + 3_600_000)
    const createDto = {
      maxTotalSessions: 20,
      maxValidityDays: 180,
      maxContractAmountCents: 300_000,
      warningThresholdDays: 30,
      hardBlock: true,
      effectiveFrom: effectiveFrom.toISOString(),
      reason: '并发制单恢复测试',
      idempotencyKey: 'youth-rule-race-create-001',
    }
    const createHash = orderCreationCommandHash({
      kind: 'YOUTH_TRAINING_RULE_CREATE',
      maxTotalSessions: 20,
      maxValidityDays: 180,
      maxContractAmountCents: 300_000,
      warningThresholdDays: 30,
      hardBlock: true,
      effectiveFrom,
      reason: createDto.reason,
    })
    const committedDraft = {
      ...activeRule({
        id: 'race-draft',
        status: YouthTrainingRuleStatus.DRAFT,
        requestedById: admin.sub,
        effectiveFrom,
      }),
      commandHash: createHash,
    }
    prisma.youthTrainingRule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committedDraft)
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' })
    await expect(service.create(createDto, admin)).resolves.toEqual(committedDraft)

    const decisionDto = {
      reason: '并发复核恢复测试',
      idempotencyKey: 'youth-rule-race-publish-001',
    }
    const decisionHash = orderCreationCommandHash({
      kind: 'YOUTH_TRAINING_RULE_DECIDE',
      ruleId: 'race-draft',
      target: YouthTrainingRuleStatus.PUBLISHED,
      reason: decisionDto.reason,
    })
    const committedDecision = {
      ...committedDraft,
      status: YouthTrainingRuleStatus.PUBLISHED,
      reviewedById: reviewer.sub,
      decisionCommandHash: decisionHash,
    }
    prisma.youthTrainingRule.findUnique.mockReset()
    prisma.youthTrainingRule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committedDecision)
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' })
    await expect(
      service.publish('race-draft', decisionDto, reviewer),
    ).resolves.toEqual(committedDecision)
  })

  it('rejects self-review and a lost concurrent publication race', async () => {
    const draft = {
      ...activeRule({
        id: 'draft-1',
        status: YouthTrainingRuleStatus.DRAFT,
        requestedById: reviewer.sub,
        effectiveFrom: new Date(Date.now() + 3_600_000),
      }),
    }
    prisma.youthTrainingRule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draft)
    await expect(
      service.publish(
        'draft-1',
        { reason: '本人尝试复核', idempotencyKey: 'publish-rule-self' },
        reviewer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)

    prisma.youthTrainingRule.findUnique.mockReset()
    prisma.youthTrainingRule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...draft, requestedById: admin.sub })
    prisma.youthTrainingRule.findFirst.mockResolvedValue(null)
    prisma.youthTrainingRule.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      service.publish(
        'draft-1',
        { reason: '并发复核', idempotencyKey: 'publish-rule-race' },
        reviewer,
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})
