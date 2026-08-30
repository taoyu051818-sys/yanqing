import { randomBytes } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  AppRole,
  BookingStatus,
  LeadStatus,
  Prisma,
  TrainingAudience,
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
  TrainingTrialStatus,
  UserStatus,
} from '../generated/prisma/client.js'
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js'
import {
  assertOperationTimeWindow,
  TRAINING_ATTENDANCE_WINDOW_PARAMETER,
  TRAINING_COMPLETION_WINDOW_PARAMETER,
  type OperationTimeWindowSnapshot,
} from '../common/time-window/operation-time-window.js'
import type {
  AssessTrainingTrialDto,
  ConvertTrainingTrialDto,
  CreateTrainingTrialDto,
  TrainingTrialActionDto,
  TrainingTrialQueryDto,
} from './training-operations.dto.js'

const trialNo = () =>
  `TRY${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(2).toString('hex').toUpperCase()}`

const normalizedText = (
  value: string,
  label: string,
  min: number,
  max: number,
) => {
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) {
    throw new BadRequestException(`${label}长度必须为 ${min}-${max} 个字符`)
  }
  return normalized
}

const optionalId = (value: string | undefined, label: string) => {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (!normalized) throw new BadRequestException(`${label}不能为空白字符`)
  return normalized
}

const isConcurrentWriteError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ['P2002', 'P2034'].includes(String((error as { code?: unknown }).code))

const activeLeadStatuses: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTING,
  LeadStatus.TRIAL_RESERVED,
]
const trialManagerRoles: AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]
const convertibleEnrollmentStatuses: TrainingEnrollmentStatus[] = [
  TrainingEnrollmentStatus.ACTIVE,
  TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
]

const trialInclude = {
  lead: {
    select: {
      id: true,
      displayName: true,
      status: true,
      sourceChannel: true,
      campaign: true,
      convertedMemberId: true,
    },
  },
  student: { select: { id: true, displayName: true, guardianId: true } },
  guardian: { select: { id: true, displayName: true } },
  member: { select: { id: true, displayName: true } },
  product: true,
  class: {
    include: {
      product: true,
    },
  },
  session: true,
  coach: { select: { id: true, displayName: true } },
  convertedEnrollment: {
    include: { product: true, class: true, student: true },
  },
  transitions: {
    include: { actor: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const

@Injectable()
export class TrainingTrialsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: TrainingTrialQueryDto, actor: AuthUser, mine = false) {
    const coachOnly =
      actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) =>
        trialManagerRoles.includes(role),
      )
    const startsAt = query.from ? new Date(query.from) : undefined
    const endsAt = query.to ? new Date(query.to) : undefined
    return this.prisma.trainingTrial.findMany({
      where: {
        status: query.status,
        scheduledStartsAt:
          startsAt || endsAt
            ? { gte: startsAt, lt: endsAt }
            : undefined,
        ...(mine
          ? { OR: [{ memberId: actor.sub }, { guardianId: actor.sub }] }
          : coachOnly
            ? {
                OR: [
                  { coachId: actor.sub },
                  { class: { coachId: actor.sub } },
                  { class: { assistantId: actor.sub } },
                ],
              }
            : {}),
      },
      include: trialInclude,
      orderBy: { scheduledStartsAt: 'desc' },
      take: 200,
    })
  }

  async create(dto: CreateTrainingTrialDto, actor: AuthUser) {
    this.assertRole(
      actor,
      [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
      '仅前台或管理员可预约试听',
    )
    dto = {
      ...dto,
      leadId: optionalId(dto.leadId, '线索 ID'),
      studentId: optionalId(dto.studentId, '学员 ID'),
      memberId: optionalId(dto.memberId, '会员 ID'),
      productId: normalizedText(dto.productId, '产品 ID', 1, 100),
      classId: optionalId(dto.classId, '班级 ID'),
      sessionId: optionalId(dto.sessionId, '课次 ID'),
      coachId: normalizedText(dto.coachId, '教练 ID', 1, 100),
    }
    const reason = normalizedText(dto.reason, '操作原因', 2, 300)
    const idempotencyKey = normalizedText(dto.idempotencyKey, '幂等键', 8, 100)
    const scheduledStartsAt = new Date(dto.scheduledStartsAt)
    const scheduledEndsAt = new Date(dto.scheduledEndsAt)
    if (scheduledEndsAt <= scheduledStartsAt) {
      throw new BadRequestException('试听结束时间必须晚于开始时间')
    }
    if (dto.studentId) {
      if (dto.memberId) {
        throw new BadRequestException('青少年试听以学员为唯一主体，监护人由学员档案关联，不能再指定会员主体')
      }
    } else if (Number(Boolean(dto.leadId)) + Number(Boolean(dto.memberId)) !== 1) {
      throw new BadRequestException('成人试听必须在线索与会员中选择且仅选择一个主体')
    }
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_TRIAL_RESERVE',
      leadId: dto.leadId ?? null,
      studentId: dto.studentId ?? null,
      memberId: dto.memberId ?? null,
      productId: dto.productId,
      classId: dto.classId ?? null,
      sessionId: dto.sessionId ?? null,
      coachId: dto.coachId,
      sourceChannel: dto.sourceChannel,
      scheduledStartsAt,
      scheduledEndsAt,
      reason,
    })
    const replay = await this.prisma.trainingTrial.findUnique({
      where: { creationIdempotencyKey: idempotencyKey },
      include: trialInclude,
    })
    if (replay) {
      if (replay.createdById !== actor.sub || replay.creationCommandHash !== commandHash) {
        throw new ConflictException('试听预约幂等键已用于其他命令')
      }
      return replay
    }
    if (scheduledStartsAt <= new Date()) {
      throw new BadRequestException('试听开始时间必须晚于当前时间')
    }

    const [product, trainingClass, session, student, lead, member, coach] =
      await Promise.all([
        this.prisma.trainingProduct.findUnique({ where: { id: dto.productId } }),
        dto.classId
          ? this.prisma.trainingClass.findUnique({ where: { id: dto.classId } })
          : null,
        dto.sessionId
          ? this.prisma.trainingSession.findUnique({
              where: { id: dto.sessionId },
              include: { class: true },
            })
          : null,
        dto.studentId
          ? this.prisma.student.findUnique({
              where: { id: dto.studentId },
              include: {
                guardian: {
                  select: { id: true, status: true, deletedAt: true },
                },
              },
            })
          : null,
        dto.leadId
          ? this.prisma.customerLead.findUnique({ where: { id: dto.leadId } })
          : null,
        dto.memberId
          ? this.prisma.user.findUnique({ where: { id: dto.memberId } })
          : null,
        this.prisma.user.findUnique({
          where: { id: dto.coachId },
          include: { roles: { select: { role: true } } },
        }),
      ])
    if (!product?.enabled) throw new NotFoundException('试听培训产品不存在或已下架')
    if (trainingClass && trainingClass.productId !== product.id) {
      throw new BadRequestException('试听班级不属于所选产品')
    }
    if (!trainingClass && !session) {
      throw new BadRequestException('试听必须关联班级或已排课次')
    }
    if (trainingClass && !trainingClass.active) {
      throw new ConflictException('试听班级已停用')
    }
    if (session) {
      if (trainingClass && session.classId !== trainingClass.id) {
        throw new BadRequestException('试听课次不属于所选班级')
      }
      if (session.class.productId !== product.id) {
        throw new BadRequestException('试听课次不属于所选产品')
      }
      if (session.status !== TrainingSessionStatus.SCHEDULED) {
        throw new ConflictException('试听课次不是待开课状态')
      }
      if (
        session.startsAt > scheduledStartsAt ||
        session.endsAt < scheduledEndsAt
      ) {
        throw new ConflictException('试听时段必须位于所选课次时段内')
      }
    }
    if (dto.studentId && !student) throw new NotFoundException('青少年学员不存在')
    if (student && !student.guardianConsentStatus) {
      throw new ConflictException('青少年学员尚未完成监护人授权')
    }
    if (
      student &&
      (student.guardian.status !== UserStatus.ACTIVE || student.guardian.deletedAt)
    ) {
      throw new ConflictException('青少年学员监护人账号不可用')
    }
    if (product.audience === TrainingAudience.YOUTH && !student) {
      throw new BadRequestException('青少年试听必须关联已授权学员与监护人')
    }
    if (product.audience === TrainingAudience.ADULT && student) {
      throw new BadRequestException('成人试听不能关联青少年学员档案')
    }
    if (dto.leadId && (!lead || !activeLeadStatuses.includes(lead.status))) {
      throw new ConflictException('线索不存在或已进入终态，不能预约试听')
    }
    if (dto.memberId && (!member || member.status !== UserStatus.ACTIVE || member.deletedAt)) {
      throw new BadRequestException('试听会员不存在或账号不可用')
    }
    const coachRoles = coach
      ? [coach.primaryRole, ...coach.roles.map(({ role }) => role)]
      : []
    if (
      !coach ||
      coach.status !== UserStatus.ACTIVE ||
      coach.deletedAt ||
      !coachRoles.includes(AppRole.COACH)
    ) {
      throw new BadRequestException('试听教练不存在、已停用或没有教练角色')
    }
    const scopedClass = trainingClass ?? session?.class
    if (
      scopedClass?.coachId &&
      ![scopedClass.coachId, scopedClass.assistantId].includes(dto.coachId)
    ) {
      throw new ForbiddenException('试听教练必须是所选班级的教练或助教')
    }
    const courtBooking = await this.prisma.courtBooking.findFirst({
      where: {
        trainingClassId: scopedClass!.id,
        status: { not: BookingStatus.CANCELLED },
        startsAt: { lte: scheduledStartsAt },
        endsAt: { gte: scheduledEndsAt },
      },
      select: { courtId: true },
    })
    if (!courtBooking) {
      throw new ConflictException('试听时段没有已确认的培训场地资源')
    }
    const closure = await this.prisma.courtClosure.findFirst({
      where: {
        courtId: courtBooking.courtId,
        status: 'ACTIVE',
        startsAt: { lt: scheduledEndsAt },
        endsAt: { gt: scheduledStartsAt },
      },
      select: { id: true },
    })
    if (closure) throw new ConflictException('试听场地在所选时段已封场')
    await this.assertNoScheduleConflict(
      this.prisma,
      dto,
      scheduledStartsAt,
      scheduledEndsAt,
    )

    try {
      return await this.prisma.$transaction(
        async (tx) => {
        const concurrent = await tx.trainingTrial.findUnique({
          where: { creationIdempotencyKey: idempotencyKey },
          include: trialInclude,
        })
        if (concurrent) {
          if (
            concurrent.createdById !== actor.sub ||
            concurrent.creationCommandHash !== commandHash
          ) {
            throw new ConflictException('试听预约幂等键已用于其他命令')
          }
          return concurrent
        }
        await this.assertNoScheduleConflict(
          tx,
          dto,
          scheduledStartsAt,
          scheduledEndsAt,
        )
        const created = await tx.trainingTrial.create({
          data: {
            trialNo: trialNo(),
            leadId: lead?.id,
            studentId: student?.id,
            guardianId: student?.guardianId,
            memberId: member?.id,
            productId: product.id,
            classId: trainingClass?.id ?? session?.classId,
            sessionId: session?.id,
            coachId: coach.id,
            sourceChannel: lead?.sourceChannel ?? dto.sourceChannel,
            scheduledStartsAt,
            scheduledEndsAt,
            createdById: actor.sub,
            creationIdempotencyKey: idempotencyKey,
            creationCommandHash: commandHash,
            transitions: {
              create: {
                fromStatus: null,
                toStatus: TrainingTrialStatus.RESERVED,
                action: 'RESERVE',
                reason,
                commandHash,
                idempotencyKey,
                actorId: actor.sub,
                payload: {
                  scheduledStartsAt: scheduledStartsAt.toISOString(),
                  scheduledEndsAt: scheduledEndsAt.toISOString(),
                  productId: product.id,
                  classId: trainingClass?.id ?? session?.classId ?? null,
                  sessionId: session?.id ?? null,
                  coachId: coach.id,
                },
              },
            },
          },
        })
        if (lead) {
          await this.appendLeadEvidence(
            tx,
            lead,
            actor,
            LeadStatus.TRIAL_RESERVED,
            'TRIAL_RESERVED',
            reason,
          )
        }
        await this.audit(
          tx,
          actor,
          created.id,
          'TRAINING_TRIAL_RESERVED',
          null,
          TrainingTrialStatus.RESERVED,
          reason,
          idempotencyKey,
          { commandHash },
        )
        return tx.trainingTrial.findUniqueOrThrow({
          where: { id: created.id },
          include: trialInclude,
        })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (!isConcurrentWriteError(error)) throw error
      const concurrent = await this.prisma.trainingTrial.findUnique({
        where: { creationIdempotencyKey: idempotencyKey },
        include: trialInclude,
      })
      if (
        concurrent &&
        concurrent.createdById === actor.sub &&
        concurrent.creationCommandHash === commandHash
      ) {
        return concurrent
      }
      throw new ConflictException('试听预约发生并发冲突，请刷新后使用原幂等键重试')
    }
  }

  checkIn(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    this.assertRole(actor, [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN], '仅前台或管理员可办理试听签到')
    return this.transition(id, dto, actor, {
      expected: [TrainingTrialStatus.RESERVED],
      target: TrainingTrialStatus.CHECKED_IN,
      action: 'CHECK_IN',
      data: { checkedInAt: new Date() },
      leadStatus: LeadStatus.ATTENDED,
      timeWindow: 'ATTENDANCE',
    })
  }

  noShow(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    this.assertRole(actor, [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN], '仅前台或管理员可登记试听未到')
    return this.transition(id, dto, actor, {
      expected: [TrainingTrialStatus.RESERVED],
      target: TrainingTrialStatus.NO_SHOW,
      action: 'NO_SHOW',
      data: { noShowAt: new Date() },
      timeWindow: 'COMPLETION',
    })
  }

  async assess(id: string, dto: AssessTrainingTrialDto, actor: AuthUser) {
    this.assertRole(actor, [AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN], '仅试听教练或管理员可提交测评')
    const trial = await this.load(id)
    this.assertCoachScope(trial, actor)
    const keys = dto.dimensions.map(({ key }) =>
      normalizedText(key, '测评维度编码', 1, 40),
    )
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('试听测评维度不能重复')
    }
    const dimensions = dto.dimensions.map((item) => ({
      key: normalizedText(item.key, '测评维度编码', 1, 40),
      label: normalizedText(item.label, '测评维度名称', 1, 80),
      score: item.score,
      note: item.note?.trim() || null,
    }))
    const recommendation = normalizedText(dto.recommendation, '测评建议', 2, 500)
    return this.transition(id, dto, actor, {
      expected: [TrainingTrialStatus.CHECKED_IN],
      target: TrainingTrialStatus.ASSESSED,
      action: 'ASSESS',
      payload: {
        dimensions,
        recommendation,
        note: dto.note?.trim() || null,
      },
      data: {
        assessmentDimensions: dimensions as never,
        recommendation,
        assessmentNote: dto.note?.trim() || null,
        assessedAt: new Date(),
      },
    })
  }

  async convert(id: string, dto: ConvertTrainingTrialDto, actor: AuthUser) {
    this.assertRole(actor, [AppRole.ADMIN, AppRole.SUPER_ADMIN], '仅管理员可确认试听转正式课')
    const trial = await this.load(id)
    const enrollmentId = normalizedText(dto.enrollmentId, '正式报名 ID', 1, 100)
    const enrollment = await this.prisma.trainingEnrollment.findUnique({
      where: { id: enrollmentId },
    })
    if (
      !enrollment ||
      !convertibleEnrollmentStatuses.includes(enrollment.status)
    ) {
      throw new BadRequestException('正式课报名不存在或尚未完成支付激活')
    }
    if (enrollment.productId !== trial.productId) {
      throw new BadRequestException('正式课报名产品与试听产品不一致')
    }
    if (
      trial.studentId
        ? enrollment.studentId !== trial.studentId || enrollment.buyerId !== trial.guardianId
        : enrollment.studentId !== null ||
          enrollment.buyerId !== (trial.memberId ?? trial.lead?.convertedMemberId)
    ) {
      throw new ForbiddenException('正式课报名不属于本次试听学员或监护人')
    }
    return this.transition(id, dto, actor, {
      expected: [TrainingTrialStatus.ASSESSED],
      target: TrainingTrialStatus.CONVERTED,
      action: 'CONVERT',
      payload: { enrollmentId: enrollment.id },
      data: {
        convertedEnrollmentId: enrollment.id,
        convertedAt: new Date(),
        memberId: trial.memberId ?? enrollment.buyerId,
      },
      leadStatus: LeadStatus.CONVERTED,
      convertedMemberId: enrollment.buyerId,
    })
  }

  lost(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    this.assertRole(actor, [AppRole.ADMIN, AppRole.SUPER_ADMIN], '仅管理员可确认试听流失')
    return this.transition(id, dto, actor, {
      expected: [TrainingTrialStatus.ASSESSED, TrainingTrialStatus.NO_SHOW],
      target: TrainingTrialStatus.LOST,
      action: 'LOST',
      data: { lostAt: new Date() },
      leadStatus: LeadStatus.LOST,
    })
  }

  cancel(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    this.assertRole(actor, [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN], '仅前台或管理员可取消试听')
    return this.transition(id, dto, actor, {
      expected: [TrainingTrialStatus.RESERVED, TrainingTrialStatus.NO_SHOW],
      target: TrainingTrialStatus.CANCELLED,
      action: 'CANCEL',
      data: { cancelledAt: new Date() },
    })
  }

  private async transition(
    id: string,
    dto: TrainingTrialActionDto,
    actor: AuthUser,
    options: {
      expected: TrainingTrialStatus[]
      target: TrainingTrialStatus
      action: string
      payload?: Record<string, unknown>
      data?: Prisma.TrainingTrialUncheckedUpdateManyInput
      leadStatus?: LeadStatus
      convertedMemberId?: string
      timeWindow?: 'ATTENDANCE' | 'COMPLETION'
    },
  ) {
    const reason = normalizedText(dto.reason, '操作原因', 2, 300)
    const idempotencyKey = normalizedText(dto.idempotencyKey, '幂等键', 8, 100)
    const commandHash = orderCreationCommandHash({
      kind: `TRAINING_TRIAL_${options.action}`,
      trialId: id,
      target: options.target,
      reason,
      payload: options.payload ?? null,
    })
    const replay = await this.prisma.trainingTrialTransition.findUnique({
      where: { idempotencyKey },
      include: { trial: { include: trialInclude } },
    })
    if (replay) {
      if (
        replay.trialId !== id ||
        replay.toStatus !== options.target ||
        replay.actorId !== actor.sub ||
        replay.commandHash !== commandHash
      ) {
        throw new ConflictException('试听动作幂等键已用于其他命令')
      }
      return replay.trial
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
        const current = await tx.trainingTrial.findUnique({
          where: { id },
          include: { lead: true, class: true },
        })
        if (!current) throw new NotFoundException('试听记录不存在')
        if (!options.expected.includes(current.status)) {
          throw new ConflictException(`试听当前状态 ${current.status} 不允许执行 ${options.action}`)
        }
        let timeWindowPolicy: OperationTimeWindowSnapshot | undefined
        if (options.timeWindow === 'ATTENDANCE') {
          timeWindowPolicy = await assertOperationTimeWindow(tx, {
            actor,
            parameterKey: TRAINING_ATTENDANCE_WINDOW_PARAMETER,
            defaults: { earlyMinutes: 30, lateMinutes: 120 },
            scheduledStartsAt: current.scheduledStartsAt,
            scheduledEndsAt: current.scheduledEndsAt,
            action: 'TRAINING_TRIAL_CHECK_IN',
            objectType: 'TrainingTrial',
            objectId: id,
            overrideReason: reason,
          })
        } else if (options.timeWindow === 'COMPLETION') {
          timeWindowPolicy = await assertOperationTimeWindow(tx, {
            actor,
            parameterKey: TRAINING_COMPLETION_WINDOW_PARAMETER,
            defaults: { earlyMinutes: 0, lateMinutes: 240 },
            scheduledStartsAt: current.scheduledEndsAt,
            scheduledEndsAt: current.scheduledEndsAt,
            action: 'TRAINING_TRIAL_NO_SHOW',
            objectType: 'TrainingTrial',
            objectId: id,
            overrideReason: reason,
          })
        }
        const changed = await tx.trainingTrial.updateMany({
          where: { id, status: { in: options.expected } },
          data: { status: options.target, ...options.data },
        })
        if (changed.count !== 1) {
          throw new ConflictException('试听状态已被其他操作更新，请刷新后重试')
        }
        await tx.trainingTrialTransition.create({
          data: {
            trialId: id,
            fromStatus: current.status,
            toStatus: options.target,
            action: options.action,
            reason,
            payload: {
              ...options.payload,
              ...(timeWindowPolicy ? { timeWindowPolicy } : {}),
            } as never,
            commandHash,
            idempotencyKey,
            actorId: actor.sub,
          },
        })
        if (current.lead) {
          await this.appendLeadEvidence(
            tx,
            current.lead,
            actor,
            options.leadStatus ?? current.lead.status,
            `TRIAL_${options.action}`,
            reason,
            options.convertedMemberId,
          )
        }
        await this.audit(
          tx,
          actor,
          id,
          `TRAINING_TRIAL_${options.action}`,
          current.status,
          options.target,
          reason,
          idempotencyKey,
          { commandHash, ...options.payload, timeWindowPolicy },
        )
        return tx.trainingTrial.findUniqueOrThrow({
          where: { id },
          include: trialInclude,
        })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (!isConcurrentWriteError(error)) throw error
      const concurrent = await this.prisma.trainingTrialTransition.findUnique({
        where: { idempotencyKey },
        include: { trial: { include: trialInclude } },
      })
      if (
        concurrent &&
        concurrent.trialId === id &&
        concurrent.toStatus === options.target &&
        concurrent.actorId === actor.sub &&
        concurrent.commandHash === commandHash
      ) {
        return concurrent.trial
      }
      throw new ConflictException('试听动作发生并发冲突，请刷新后使用原幂等键重试')
    }
  }

  private load(id: string) {
    return this.prisma.trainingTrial.findUnique({
      where: { id },
      include: trialInclude,
    }).then((trial) => {
      if (!trial) throw new NotFoundException('试听记录不存在')
      return trial
    })
  }

  private assertCoachScope(
    trial: Awaited<ReturnType<TrainingTrialsService['load']>>,
    actor: AuthUser,
  ) {
    const coachOnly =
      actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) =>
        ([AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role),
      )
    if (
      coachOnly &&
      trial.coachId !== actor.sub &&
      trial.class?.coachId !== actor.sub &&
      trial.class?.assistantId !== actor.sub
    ) {
      throw new ForbiddenException('教练只能处理本人试听或本人班级的试听')
    }
  }

  private assertRole(actor: AuthUser, roles: AppRole[], message: string) {
    if (!actor.roles.some((role) => roles.includes(role))) {
      throw new ForbiddenException(message)
    }
  }

  private async assertNoScheduleConflict(
    db: Pick<PrismaService, 'trainingTrial'> | Prisma.TransactionClient,
    dto: CreateTrainingTrialDto,
    startsAt: Date,
    endsAt: Date,
  ) {
    const activeStatuses = [
      TrainingTrialStatus.RESERVED,
      TrainingTrialStatus.CHECKED_IN,
      TrainingTrialStatus.ASSESSED,
    ]
    const participantFilters: Prisma.TrainingTrialWhereInput[] = []
    if (dto.leadId) participantFilters.push({ leadId: dto.leadId })
    if (dto.studentId) participantFilters.push({ studentId: dto.studentId })
    if (dto.memberId) participantFilters.push({ memberId: dto.memberId })
    const conflict = await db.trainingTrial.findFirst({
      where: {
        status: { in: activeStatuses },
        scheduledStartsAt: { lt: endsAt },
        scheduledEndsAt: { gt: startsAt },
        OR: [{ coachId: dto.coachId }, ...participantFilters],
      },
      select: { coachId: true, leadId: true, studentId: true, memberId: true },
    })
    if (!conflict) return
    if (conflict.coachId === dto.coachId) {
      throw new ConflictException('试听教练在所选时段已有其他试听')
    }
    throw new ConflictException('试听对象在所选时段已有其他预约')
  }

  private async appendLeadEvidence(
    tx: Prisma.TransactionClient,
    lead: {
      id: string
      status: LeadStatus
      convertedMemberId?: string | null
    },
    actor: AuthUser,
    statusAfter: LeadStatus,
    kind: string,
    reason: string,
    convertedMemberId?: string | null,
  ) {
    const now = new Date()
    await tx.customerLead.update({
      where: { id: lead.id },
      data: {
        status: statusAfter,
        ...(statusAfter === LeadStatus.CONVERTED
          ? { convertedMemberId, convertedAt: now }
          : {}),
        ...(statusAfter === LeadStatus.LOST
          ? { lostAt: now, lostReason: reason }
          : {}),
      },
    })
    await tx.leadFollowUp.create({
      data: {
        leadId: lead.id,
        actorId: actor.sub,
        kind,
        content: reason,
        statusBefore: lead.status,
        statusAfter,
      },
    })
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    trialId: string,
    action: string,
    before: TrainingTrialStatus | null,
    after: TrainingTrialStatus,
    reason: string,
    requestId: string,
    details: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action,
        objectType: 'TrainingTrial',
        objectId: trialId,
        reason,
        requestId,
        oldValue: { status: before } as never,
        newValue: { status: after, ...details } as never,
      },
    })
  }
}
