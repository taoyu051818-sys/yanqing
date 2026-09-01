import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  LeadStatus,
  SourceChannel,
  TrainingAudience,
  TrainingEnrollmentStatus,
  TrainingTrialStatus,
  UserStatus,
} from '../generated/prisma/enums.js'
import { TrainingTrialsService } from './training-trials.service.js'
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js'

const frontDesk: AuthUser = {
  sub: 'front-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
}
const coach: AuthUser = {
  sub: 'coach-1',
  displayName: '试听教练',
  roles: [AppRole.COACH],
}
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '培训管理员',
  roles: [AppRole.ADMIN],
}

const baseTrial = (overrides: Record<string, unknown> = {}) => ({
  id: 'trial-1',
  trialNo: 'TRY001',
  status: TrainingTrialStatus.RESERVED,
  leadId: null,
  studentId: null,
  guardianId: null,
  memberId: 'member-1',
  productId: 'product-1',
  classId: 'class-1',
  sessionId: null,
  coachId: coach.sub,
  sourceChannel: SourceChannel.STORE_VISIT,
  class: { coachId: coach.sub, assistantId: null },
  lead: null,
  scheduledStartsAt: new Date(Date.now() + 10 * 60_000),
  scheduledEndsAt: new Date(Date.now() + 70 * 60_000),
  ...overrides,
})

describe('TrainingTrialsService', () => {
  let prisma: any
  let service: TrainingTrialsService

  beforeEach(() => {
    prisma = {
      trainingTrial: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      trainingTrialTransition: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      trainingProduct: { findUnique: vi.fn() },
      trainingClass: { findUnique: vi.fn() },
      trainingSession: { findUnique: vi.fn() },
      trainingEnrollment: { findUnique: vi.fn() },
      student: { findUnique: vi.fn() },
      customerLead: { findUnique: vi.fn(), update: vi.fn() },
      user: { findUnique: vi.fn() },
      courtBooking: { findFirst: vi.fn() },
      courtClosure: { findFirst: vi.fn() },
      leadFollowUp: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    prisma.$transaction = vi.fn(async (work: any) => work(prisma))
    service = new TrainingTrialsService(prisma)
  })

  it('projects member and operator trial views without replay or cost evidence', async () => {
    const raw = baseTrial({
      creationIdempotencyKey: 'trial-secret-key',
      creationCommandHash: 'trial-secret-hash',
      createdById: 'front-1',
      product: {
        id: 'product-1', name: '试听课', audience: TrainingAudience.ADULT,
        totalSessions: 12, validityDays: 90, priceCents: 68_000,
        unitRevenueCents: 5_666, refundRule: { internal: true },
      },
      class: {
        id: 'class-1', name: '成人班', capacity: 12, active: true,
        coachId: coach.sub, assistantId: null, coachCostCents: 20_000,
        product: null,
      },
      transitions: [{
        id: 'transition-1', fromStatus: null,
        toStatus: TrainingTrialStatus.RESERVED, action: 'RESERVE',
        reason: '预约试听', actorId: 'front-1', idempotencyKey: 'secret',
        commandHash: 'hash', payload: { internal: true },
        actor: { id: 'front-1', displayName: '前台' }, createdAt: new Date(),
      }],
    })
    prisma.trainingTrial.findMany.mockResolvedValue([raw])
    const member: AuthUser = {
      sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER],
    }

    const mine = await service.list({}, member, true)
    const managed = await service.list({}, coach)

    expect(mine[0]).not.toHaveProperty('creationIdempotencyKey')
    expect(mine[0]).not.toHaveProperty('creationCommandHash')
    expect(mine[0]).not.toHaveProperty('transitions')
    expect(mine[0]?.product).not.toHaveProperty('refundRule')
    expect(managed[0]?.class).not.toHaveProperty('coachCostCents')
    expect(managed[0]?.transitions[0]).toMatchObject({
      id: 'transition-1', reason: '预约试听', actor: { displayName: '前台' },
    })
    expect(managed[0]?.transitions[0]).not.toHaveProperty('idempotencyKey')
    expect(managed[0]?.transitions[0]).not.toHaveProperty('commandHash')
    expect(managed[0]?.transitions[0]).not.toHaveProperty('payload')
  })

  it('reserves a youth trial with lead, guardian, class and coach evidence', async () => {
    const startsAt = new Date(Date.now() + 86_400_000)
    const dto = {
      leadId: 'lead-1',
      studentId: 'student-1',
      productId: 'product-1',
      classId: 'class-1',
      coachId: coach.sub,
      sourceChannel: SourceChannel.OTHER,
      scheduledStartsAt: startsAt.toISOString(),
      scheduledEndsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      reason: '监护人确认预约试听',
      idempotencyKey: 'trial-reserve-001',
    }
    prisma.trainingTrial.findUnique.mockResolvedValue(null)
    prisma.trainingTrial.findFirst.mockResolvedValue(null)
    prisma.trainingProduct.findUnique.mockResolvedValue({
      id: 'product-1', enabled: true, audience: TrainingAudience.YOUTH,
    })
    prisma.trainingClass.findUnique.mockResolvedValue({
      id: 'class-1', productId: 'product-1', coachId: coach.sub, assistantId: null, active: true,
    })
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1', guardianId: 'guardian-1', guardianConsentStatus: true,
      guardian: { id: 'guardian-1', status: UserStatus.ACTIVE, deletedAt: null },
    })
    prisma.customerLead.findUnique.mockResolvedValue({
      id: 'lead-1', status: LeadStatus.CONTACTING, sourceChannel: SourceChannel.REFERRAL,
    })
    prisma.user.findUnique.mockResolvedValue({
      id: coach.sub,
      primaryRole: AppRole.COACH,
      roles: [],
      status: UserStatus.ACTIVE,
      deletedAt: null,
    })
    prisma.courtBooking.findFirst.mockResolvedValue({ courtId: 'court-1' })
    prisma.courtClosure.findFirst.mockResolvedValue(null)
    prisma.trainingTrial.create.mockResolvedValue({ id: 'trial-1' })
    prisma.trainingTrial.findUniqueOrThrow.mockResolvedValue(
      baseTrial({ studentId: 'student-1', guardianId: 'guardian-1' }),
    )

    await service.create(dto, frontDesk)

    expect(prisma.trainingTrial.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guardianId: 'guardian-1',
        sourceChannel: SourceChannel.REFERRAL,
        creationIdempotencyKey: dto.idempotencyKey,
        transitions: {
          create: expect.objectContaining({
            fromStatus: null,
            toStatus: TrainingTrialStatus.RESERVED,
            action: 'RESERVE',
            idempotencyKey: dto.idempotencyKey,
          }),
        },
      }),
    })
    expect(prisma.customerLead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ status: LeadStatus.TRIAL_RESERVED }),
    })
    expect(prisma.leadFollowUp.create).toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'TRAINING_TRIAL_RESERVED' }),
    })
  })

  it('blocks inactive guardians and reservations without an allocated court', async () => {
    const startsAt = new Date(Date.now() + 86_400_000)
    const dto = {
      studentId: 'student-1',
      productId: 'product-1',
      classId: 'class-1',
      coachId: coach.sub,
      sourceChannel: SourceChannel.STORE_VISIT,
      scheduledStartsAt: startsAt.toISOString(),
      scheduledEndsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      reason: '监护人预约试听',
      idempotencyKey: 'trial-guardian-001',
    }
    prisma.trainingTrial.findUnique.mockResolvedValue(null)
    prisma.trainingProduct.findUnique.mockResolvedValue({
      id: 'product-1', enabled: true, audience: TrainingAudience.YOUTH,
    })
    prisma.trainingClass.findUnique.mockResolvedValue({
      id: 'class-1', productId: 'product-1', coachId: coach.sub, assistantId: null, active: true,
    })
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1', guardianId: 'guardian-1', guardianConsentStatus: true,
      guardian: { id: 'guardian-1', status: UserStatus.DISABLED, deletedAt: null },
    })
    prisma.user.findUnique.mockResolvedValue({
      id: coach.sub, primaryRole: AppRole.COACH, roles: [],
      status: UserStatus.ACTIVE, deletedAt: null,
    })
    await expect(service.create(dto, frontDesk)).rejects.toThrow('监护人账号不可用')

    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1', guardianId: 'guardian-1', guardianConsentStatus: true,
      guardian: { id: 'guardian-1', status: UserStatus.ACTIVE, deletedAt: null },
    })
    prisma.courtBooking.findFirst.mockResolvedValue(null)
    await expect(service.create(dto, frontDesk)).rejects.toThrow('没有已确认的培训场地资源')
  })

  it('blocks overlapping coach or participant reservations', async () => {
    const startsAt = new Date(Date.now() + 86_400_000)
    const dto = {
      memberId: 'member-1', productId: 'product-1', classId: 'class-1',
      coachId: coach.sub, sourceChannel: SourceChannel.STORE_VISIT,
      scheduledStartsAt: startsAt.toISOString(),
      scheduledEndsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      reason: '会员预约试听', idempotencyKey: 'trial-overlap-001',
    }
    prisma.trainingTrial.findUnique.mockResolvedValue(null)
    prisma.trainingProduct.findUnique.mockResolvedValue({
      id: 'product-1', enabled: true, audience: TrainingAudience.ADULT,
    })
    prisma.trainingClass.findUnique.mockResolvedValue({
      id: 'class-1', productId: 'product-1', coachId: coach.sub, assistantId: null, active: true,
    })
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'member-1', status: UserStatus.ACTIVE, deletedAt: null })
      .mockResolvedValueOnce({
        id: coach.sub, primaryRole: AppRole.COACH, roles: [],
        status: UserStatus.ACTIVE, deletedAt: null,
      })
    prisma.courtBooking.findFirst.mockResolvedValue({ courtId: 'court-1' })
    prisma.courtClosure.findFirst.mockResolvedValue(null)
    prisma.trainingTrial.findFirst.mockResolvedValue({
      coachId: coach.sub, leadId: null, studentId: null, memberId: 'other-member',
    })
    await expect(service.create(dto, frontDesk)).rejects.toThrow('教练在所选时段已有其他试听')
  })

  it('uses compare-and-set transitions and returns an exact idempotent replay', async () => {
    const current = baseTrial()
    prisma.trainingTrialTransition.findUnique.mockResolvedValueOnce(null)
    prisma.trainingTrial.findUnique.mockResolvedValue(current)
    prisma.trainingTrial.updateMany.mockResolvedValue({ count: 1 })
    prisma.trainingTrialTransition.create.mockResolvedValue({ id: 'transition-1' })
    prisma.trainingTrial.findUniqueOrThrow.mockResolvedValue({
      ...current,
      status: TrainingTrialStatus.CHECKED_IN,
    })
    const dto = { reason: '前台核对本人到场', idempotencyKey: 'trial-check-in-001' }

    const first = await service.checkIn('trial-1', dto, frontDesk)
    const transitionData = prisma.trainingTrialTransition.create.mock.calls[0][0].data
    prisma.trainingTrialTransition.findUnique.mockResolvedValueOnce({
      trialId: 'trial-1',
      toStatus: TrainingTrialStatus.CHECKED_IN,
      actorId: frontDesk.sub,
      commandHash: transitionData.commandHash,
      trial: first,
    })
    const replay = await service.checkIn('trial-1', dto, frontDesk)

    expect(replay).toEqual(first)
    expect(prisma.trainingTrial.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.trainingTrial.updateMany).toHaveBeenCalledWith({
      where: { id: 'trial-1', status: { in: [TrainingTrialStatus.RESERVED] } },
      data: expect.objectContaining({ status: TrainingTrialStatus.CHECKED_IN }),
    })
  })

  it('records no-show time evidence and rejects blank command text after trimming', async () => {
    prisma.trainingTrialTransition.findUnique.mockResolvedValue(null)
    prisma.trainingTrial.findUnique.mockResolvedValue(baseTrial({
      scheduledStartsAt: new Date(Date.now() - 2 * 60 * 60_000),
      scheduledEndsAt: new Date(Date.now() - 60 * 60_000),
    }))
    prisma.trainingTrial.updateMany.mockResolvedValue({ count: 1 })
    prisma.trainingTrial.findUniqueOrThrow.mockResolvedValue(
      baseTrial({ status: TrainingTrialStatus.NO_SHOW, noShowAt: new Date() }),
    )
    await service.noShow(
      'trial-1',
      { reason: '约定时间未到场', idempotencyKey: 'trial-no-show-001' },
      frontDesk,
    )
    expect(prisma.trainingTrial.updateMany).toHaveBeenCalledWith({
      where: { id: 'trial-1', status: { in: [TrainingTrialStatus.RESERVED] } },
      data: expect.objectContaining({
        status: TrainingTrialStatus.NO_SHOW,
        noShowAt: expect.any(Date),
      }),
    })
    await expect(
      service.checkIn(
        'trial-1',
        { reason: '   ', idempotencyKey: '        ' },
        frontDesk,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('blocks trial check-in before opening and no-show before the scheduled end', async () => {
    prisma.trainingTrialTransition.findUnique.mockResolvedValue(null)
    prisma.trainingTrial.findUnique.mockResolvedValueOnce(baseTrial({
      scheduledStartsAt: new Date(Date.now() + 2 * 60 * 60_000),
      scheduledEndsAt: new Date(Date.now() + 3 * 60 * 60_000),
    }))

    await expect(service.checkIn(
      'trial-1',
      { reason: '尝试提前签到', idempotencyKey: 'trial-early-check-in' },
      admin,
    )).rejects.toBeInstanceOf(ConflictException)

    prisma.trainingTrial.findUnique.mockResolvedValueOnce(baseTrial({
      scheduledStartsAt: new Date(Date.now() - 30 * 60_000),
      scheduledEndsAt: new Date(Date.now() + 30 * 60_000),
    }))
    await expect(service.noShow(
      'trial-1',
      { reason: '尝试提前判定未到', idempotencyKey: 'trial-early-no-show' },
      admin,
    )).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.trainingTrial.updateMany).not.toHaveBeenCalled()
    expect(prisma.trainingTrialTransition.create).not.toHaveBeenCalled()
  })

  it('recovers same-command P2002 transition races instead of leaking an internal error', async () => {
    const dto = { reason: '前台核对本人到场', idempotencyKey: 'trial-race-replay-001' }
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_TRIAL_CHECK_IN',
      trialId: 'trial-1',
      target: TrainingTrialStatus.CHECKED_IN,
      reason: dto.reason,
      payload: null,
    })
    const replayTrial = baseTrial({ status: TrainingTrialStatus.CHECKED_IN })
    prisma.trainingTrialTransition.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        trialId: 'trial-1',
        toStatus: TrainingTrialStatus.CHECKED_IN,
        actorId: frontDesk.sub,
        commandHash,
        trial: replayTrial,
      })
    prisma.$transaction.mockRejectedValue({ code: 'P2002' })
    const result = await service.checkIn('trial-1', dto, frontDesk)
    expect(result).toMatchObject({
      id: replayTrial.id,
      trialNo: replayTrial.trialNo,
      status: TrainingTrialStatus.CHECKED_IN,
    })
    expect(result).not.toHaveProperty('creationIdempotencyKey')
    expect(result).not.toHaveProperty('creationCommandHash')
  })

  it('recovers same-command P2034 reservation races from the committed creation key', async () => {
    const startsAt = new Date(Date.now() + 86_400_000)
    const dto = {
      memberId: 'member-1', productId: 'product-1', classId: 'class-1',
      coachId: coach.sub, sourceChannel: SourceChannel.STORE_VISIT,
      scheduledStartsAt: startsAt.toISOString(),
      scheduledEndsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      reason: '会员确认试听预约', idempotencyKey: 'trial-create-race-001',
    }
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_TRIAL_RESERVE',
      leadId: null,
      studentId: null,
      memberId: dto.memberId,
      productId: dto.productId,
      classId: dto.classId,
      sessionId: null,
      coachId: dto.coachId,
      sourceChannel: dto.sourceChannel,
      scheduledStartsAt: new Date(dto.scheduledStartsAt),
      scheduledEndsAt: new Date(dto.scheduledEndsAt),
      reason: dto.reason,
    })
    const replay = {
      ...baseTrial(),
      createdById: frontDesk.sub,
      creationCommandHash: commandHash,
    }
    prisma.trainingTrial.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replay)
    prisma.trainingTrial.findFirst.mockResolvedValue(null)
    prisma.trainingProduct.findUnique.mockResolvedValue({
      id: 'product-1', enabled: true, audience: TrainingAudience.ADULT,
    })
    prisma.trainingClass.findUnique.mockResolvedValue({
      id: 'class-1', productId: 'product-1', coachId: coach.sub, assistantId: null, active: true,
    })
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'member-1', status: UserStatus.ACTIVE, deletedAt: null })
      .mockResolvedValueOnce({
        id: coach.sub, primaryRole: AppRole.COACH, roles: [],
        status: UserStatus.ACTIVE, deletedAt: null,
      })
    prisma.courtBooking.findFirst.mockResolvedValue({ courtId: 'court-1' })
    prisma.courtClosure.findFirst.mockResolvedValue(null)
    prisma.$transaction.mockRejectedValue({ code: 'P2034' })
    const result = await service.create(dto, frontDesk)
    expect(result).toMatchObject({
      id: replay.id,
      trialNo: replay.trialNo,
      status: TrainingTrialStatus.RESERVED,
    })
    expect(result).not.toHaveProperty('createdById')
    expect(result).not.toHaveProperty('creationCommandHash')
  })

  it('rejects direct state overwrite and a lost concurrent transition race', async () => {
    prisma.trainingTrialTransition.findUnique.mockResolvedValue(null)
    prisma.trainingTrial.findUnique.mockResolvedValue(
      baseTrial({ status: TrainingTrialStatus.ASSESSED }),
    )
    await expect(
      service.checkIn(
        'trial-1',
        { reason: '错误重复签到', idempotencyKey: 'trial-invalid-state' },
        frontDesk,
      ),
    ).rejects.toBeInstanceOf(ConflictException)

    prisma.trainingTrial.findUnique.mockResolvedValue(baseTrial())
    prisma.trainingTrial.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      service.checkIn(
        'trial-1',
        { reason: '并发签到尝试', idempotencyKey: 'trial-race-state' },
        frontDesk,
      ),
    ).rejects.toThrow('已被其他操作更新')
  })

  it('allows only the assigned coach or class coach to submit structured assessment', async () => {
    prisma.trainingTrial.findUnique.mockResolvedValue(
      baseTrial({ coachId: 'coach-other', class: { coachId: 'coach-other', assistantId: null } }),
    )
    await expect(
      service.assess(
        'trial-1',
        {
          dimensions: [{ key: 'movement', label: '步法', score: 3 }],
          recommendation: '建议进入基础班',
          reason: '完成现场测评',
          idempotencyKey: 'trial-assess-scope',
        },
        coach,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)

    prisma.trainingTrial.findUnique.mockResolvedValue(baseTrial({ status: TrainingTrialStatus.CHECKED_IN }))
    await expect(
      service.assess(
        'trial-1',
        {
          dimensions: [
            { key: 'movement', label: '步法', score: 3 },
            { key: 'movement', label: '重复步法', score: 4 },
          ],
          recommendation: '建议进入基础班',
          reason: '完成现场测评',
          idempotencyKey: 'trial-assess-duplicate',
        },
        coach,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('converts only an activated matching formal enrollment after assessment', async () => {
    const assessed = baseTrial({
      status: TrainingTrialStatus.ASSESSED,
      lead: { id: 'lead-1', status: LeadStatus.ATTENDED, convertedMemberId: 'member-1' },
    })
    prisma.trainingTrial.findUnique.mockResolvedValue(assessed)
    prisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 'enrollment-1',
      status: TrainingEnrollmentStatus.ACTIVE,
      productId: 'product-1',
      studentId: null,
      buyerId: 'member-1',
    })
    prisma.trainingTrialTransition.findUnique.mockResolvedValue(null)
    prisma.trainingTrial.updateMany.mockResolvedValue({ count: 1 })
    prisma.trainingTrial.findUniqueOrThrow.mockResolvedValue({
      ...assessed,
      status: TrainingTrialStatus.CONVERTED,
      convertedEnrollmentId: 'enrollment-1',
    })

    const converted = await service.convert(
      'trial-1',
      {
        enrollmentId: 'enrollment-1',
        reason: '正式课已支付并完成归属核对',
        idempotencyKey: 'trial-convert-001',
      },
      admin,
    )
    expect(converted.status).toBe(TrainingTrialStatus.CONVERTED)
    expect(prisma.trainingTrial.updateMany).toHaveBeenCalledWith({
      where: { id: 'trial-1', status: { in: [TrainingTrialStatus.ASSESSED] } },
      data: expect.objectContaining({
        convertedEnrollmentId: 'enrollment-1',
        memberId: 'member-1',
      }),
    })
  })
})
