import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  AppRole,
  LeadStatus,
  Prisma,
  TrainingTrialStatus,
} from '../../../generated/prisma/client.js';
import { orderCreationCommandHash } from '../../../orders/order-creation-idempotency.js';
import {
  assertOperationTimeWindow,
  TRAINING_ATTENDANCE_WINDOW_PARAMETER,
  TRAINING_COMPLETION_WINDOW_PARAMETER,
  type OperationTimeWindowSnapshot,
} from '../../../common/time-window/operation-time-window.js';
import type {
  AssessTrainingTrialDto,
  ConvertTrainingTrialDto,
  TrainingTrialActionDto,
} from '../../training-operations.dto.js';
import {
  normalizedText,
  isConcurrentWriteError,
  convertibleEnrollmentStatuses,
  trialInclude,
  trainingTrialResponse,
} from '../../shared/training-trials-support.js';

import {
  assertRole,
  appendLeadEvidence,
  audit,
} from '../../shared/training-trials-policy.js';

export function checkIn(
  prisma: PrismaService,
  id: string,
  dto: TrainingTrialActionDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅前台或管理员可办理试听签到',
  );
  return transition(prisma, id, dto, actor, {
    expected: [TrainingTrialStatus.RESERVED],
    target: TrainingTrialStatus.CHECKED_IN,
    action: 'CHECK_IN',
    data: { checkedInAt: new Date() },
    leadStatus: LeadStatus.ATTENDED,
    timeWindow: 'ATTENDANCE',
  });
}

export function noShow(
  prisma: PrismaService,
  id: string,
  dto: TrainingTrialActionDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅前台或管理员可登记试听未到',
  );
  return transition(prisma, id, dto, actor, {
    expected: [TrainingTrialStatus.RESERVED],
    target: TrainingTrialStatus.NO_SHOW,
    action: 'NO_SHOW',
    data: { noShowAt: new Date() },
    timeWindow: 'COMPLETION',
  });
}

export async function assess(
  prisma: PrismaService,
  id: string,
  dto: AssessTrainingTrialDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅试听教练或管理员可提交测评',
  );
  const trial = await load(prisma, id);
  assertCoachScope(trial, actor);
  const keys = dto.dimensions.map(({ key }) =>
    normalizedText(key, '测评维度编码', 1, 40),
  );
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('试听测评维度不能重复');
  }
  const dimensions = dto.dimensions.map((item) => ({
    key: normalizedText(item.key, '测评维度编码', 1, 40),
    label: normalizedText(item.label, '测评维度名称', 1, 80),
    score: item.score,
    note: item.note?.trim() || null,
  }));
  const recommendation = normalizedText(dto.recommendation, '测评建议', 2, 500);
  return transition(prisma, id, dto, actor, {
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
  });
}

export async function convert(
  prisma: PrismaService,
  id: string,
  dto: ConvertTrainingTrialDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅管理员可确认试听转正式课',
  );
  const trial = await load(prisma, id);
  const enrollmentId = normalizedText(dto.enrollmentId, '正式报名 ID', 1, 100);
  const enrollment = await prisma.trainingEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (
    !enrollment ||
    !convertibleEnrollmentStatuses.includes(enrollment.status)
  ) {
    throw new BadRequestException('正式课报名不存在或尚未完成支付激活');
  }
  if (enrollment.productId !== trial.productId) {
    throw new BadRequestException('正式课报名产品与试听产品不一致');
  }
  if (
    trial.studentId
      ? enrollment.studentId !== trial.studentId ||
        enrollment.buyerId !== trial.guardianId
      : enrollment.studentId !== null ||
        enrollment.buyerId !== (trial.memberId ?? trial.lead?.convertedMemberId)
  ) {
    throw new ForbiddenException('正式课报名不属于本次试听学员或监护人');
  }
  return transition(prisma, id, dto, actor, {
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
  });
}

export function lost(
  prisma: PrismaService,
  id: string,
  dto: TrainingTrialActionDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅管理员可确认试听流失',
  );
  return transition(prisma, id, dto, actor, {
    expected: [TrainingTrialStatus.ASSESSED, TrainingTrialStatus.NO_SHOW],
    target: TrainingTrialStatus.LOST,
    action: 'LOST',
    data: { lostAt: new Date() },
    leadStatus: LeadStatus.LOST,
  });
}

export function cancel(
  prisma: PrismaService,
  id: string,
  dto: TrainingTrialActionDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅前台或管理员可取消试听',
  );
  return transition(prisma, id, dto, actor, {
    expected: [TrainingTrialStatus.RESERVED, TrainingTrialStatus.NO_SHOW],
    target: TrainingTrialStatus.CANCELLED,
    action: 'CANCEL',
    data: { cancelledAt: new Date() },
  });
}

export async function transition(
  prisma: PrismaService,
  id: string,
  dto: TrainingTrialActionDto,
  actor: AuthUser,
  options: {
    expected: TrainingTrialStatus[];
    target: TrainingTrialStatus;
    action: string;
    payload?: Record<string, unknown>;
    data?: Prisma.TrainingTrialUncheckedUpdateManyInput;
    leadStatus?: LeadStatus;
    convertedMemberId?: string;
    timeWindow?: 'ATTENDANCE' | 'COMPLETION';
  },
) {
  const reason = normalizedText(dto.reason, '操作原因', 2, 300);
  const idempotencyKey = normalizedText(dto.idempotencyKey, '幂等键', 8, 100);
  const commandHash = orderCreationCommandHash({
    kind: `TRAINING_TRIAL_${options.action}`,
    trialId: id,
    target: options.target,
    reason,
    payload: options.payload ?? null,
  });
  const replay = await prisma.trainingTrialTransition.findUnique({
    where: { idempotencyKey },
    include: { trial: { include: trialInclude } },
  });
  if (replay) {
    if (
      replay.trialId !== id ||
      replay.toStatus !== options.target ||
      replay.actorId !== actor.sub ||
      replay.commandHash !== commandHash
    ) {
      throw new ConflictException('试听动作幂等键已用于其他命令');
    }
    return trainingTrialResponse(replay.trial, true);
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.trainingTrial.findUnique({
          where: { id },
          include: { lead: true, class: true },
        });
        if (!current) throw new NotFoundException('试听记录不存在');
        if (!options.expected.includes(current.status)) {
          throw new ConflictException(
            `试听当前状态 ${current.status} 不允许执行 ${options.action}`,
          );
        }
        let timeWindowPolicy: OperationTimeWindowSnapshot | undefined;
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
          });
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
          });
        }
        const changed = await tx.trainingTrial.updateMany({
          where: { id, status: { in: options.expected } },
          data: { status: options.target, ...options.data },
        });
        if (changed.count !== 1) {
          throw new ConflictException('试听状态已被其他操作更新，请刷新后重试');
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
        });
        if (current.lead) {
          await appendLeadEvidence(
            tx,
            current.lead,
            actor,
            options.leadStatus,
            `TRIAL_${options.action}`,
            reason,
            options.convertedMemberId,
          );
        }
        await audit(
          tx,
          actor,
          id,
          `TRAINING_TRIAL_${options.action}`,
          current.status,
          options.target,
          reason,
          idempotencyKey,
          { commandHash, ...options.payload, timeWindowPolicy },
        );
        const trial = await tx.trainingTrial.findUniqueOrThrow({
          where: { id },
          include: trialInclude,
        });
        return trainingTrialResponse(trial, true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isConcurrentWriteError(error)) throw error;
    const concurrent = await prisma.trainingTrialTransition.findUnique({
      where: { idempotencyKey },
      include: { trial: { include: trialInclude } },
    });
    if (
      concurrent &&
      concurrent.trialId === id &&
      concurrent.toStatus === options.target &&
      concurrent.actorId === actor.sub &&
      concurrent.commandHash === commandHash
    ) {
      return trainingTrialResponse(concurrent.trial, true);
    }
    throw new ConflictException(
      '试听动作发生并发冲突，请刷新后使用原幂等键重试',
    );
  }
}

export function load(prisma: PrismaService, id: string) {
  return prisma.trainingTrial
    .findUnique({
      where: { id },
      include: trialInclude,
    })
    .then((trial) => {
      if (!trial) throw new NotFoundException('试听记录不存在');
      return trial;
    });
}

export function assertCoachScope(
  trial: Awaited<ReturnType<typeof load>>,
  actor: AuthUser,
) {
  const coachOnly =
    actor.roles.includes(AppRole.COACH) &&
    !actor.roles.some((role) =>
      ([AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role),
    );
  if (
    coachOnly &&
    trial.coachId !== actor.sub &&
    trial.class?.coachId !== actor.sub &&
    trial.class?.assistantId !== actor.sub
  ) {
    throw new ForbiddenException('教练只能处理本人试听或本人班级的试听');
  }
}
