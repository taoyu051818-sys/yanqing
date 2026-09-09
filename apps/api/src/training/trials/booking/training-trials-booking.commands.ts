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
  BookingStatus,
  LeadStatus,
  Prisma,
  TrainingAudience,
  TrainingSessionStatus,
  TrainingTrialStatus,
  UserStatus,
} from '../../../generated/prisma/client.js';
import { orderCreationCommandHash } from '../../../orders/order-creation-idempotency.js';
import type {
  CreateTrainingTrialDto,
  TrainingTrialQueryDto,
} from '../../training-operations.dto.js';
import {
  trialNo,
  normalizedText,
  optionalId,
  isConcurrentWriteError,
  activeLeadStatuses,
  trialManagerRoles,
  trialInclude,
  trainingTrialResponse,
} from '../../shared/training-trials-support.js';
import {
  assertRole,
  appendLeadEvidence,
  audit,
} from '../../shared/training-trials-policy.js';

export async function list(
  prisma: PrismaService,
  query: TrainingTrialQueryDto,
  actor: AuthUser,
  mine = false,
) {
  const coachOnly =
    actor.roles.includes(AppRole.COACH) &&
    !actor.roles.some((role) => trialManagerRoles.includes(role));
  const startsAt = query.from ? new Date(query.from) : undefined;
  const endsAt = query.to ? new Date(query.to) : undefined;
  const trials = await prisma.trainingTrial.findMany({
    where: {
      status: query.status,
      scheduledStartsAt:
        startsAt || endsAt ? { gte: startsAt, lt: endsAt } : undefined,
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
  });
  return trials.map((trial) => trainingTrialResponse(trial, !mine));
}

export async function create(
  prisma: PrismaService,
  dto: CreateTrainingTrialDto,
  actor: AuthUser,
) {
  assertRole(
    actor,
    [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '仅前台或管理员可预约试听',
  );
  dto = {
    ...dto,
    leadId: optionalId(dto.leadId, '线索 ID'),
    studentId: optionalId(dto.studentId, '学员 ID'),
    memberId: optionalId(dto.memberId, '会员 ID'),
    productId: normalizedText(dto.productId, '产品 ID', 1, 100),
    classId: optionalId(dto.classId, '班级 ID'),
    sessionId: optionalId(dto.sessionId, '课次 ID'),
    coachId: normalizedText(dto.coachId, '教练 ID', 1, 100),
  };
  const reason = normalizedText(dto.reason, '操作原因', 2, 300);
  const idempotencyKey = normalizedText(dto.idempotencyKey, '幂等键', 8, 100);
  const scheduledStartsAt = new Date(dto.scheduledStartsAt);
  const scheduledEndsAt = new Date(dto.scheduledEndsAt);
  if (scheduledEndsAt <= scheduledStartsAt) {
    throw new BadRequestException('试听结束时间必须晚于开始时间');
  }
  if (dto.studentId) {
    if (dto.memberId) {
      throw new BadRequestException(
        '青少年试听以学员为唯一主体，监护人由学员档案关联，不能再指定会员主体',
      );
    }
  } else if (
    Number(Boolean(dto.leadId)) + Number(Boolean(dto.memberId)) !==
    1
  ) {
    throw new BadRequestException(
      '成人试听必须在线索与会员中选择且仅选择一个主体',
    );
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
  });
  const replay = await prisma.trainingTrial.findUnique({
    where: { creationIdempotencyKey: idempotencyKey },
    include: trialInclude,
  });
  if (replay) {
    if (
      replay.createdById !== actor.sub ||
      replay.creationCommandHash !== commandHash
    ) {
      throw new ConflictException('试听预约幂等键已用于其他命令');
    }
    return trainingTrialResponse(replay, true);
  }
  if (scheduledStartsAt <= new Date()) {
    throw new BadRequestException('试听开始时间必须晚于当前时间');
  }

  const [product, trainingClass, session, student, lead, member, coach] =
    await Promise.all([
      prisma.trainingProduct.findUnique({ where: { id: dto.productId } }),
      dto.classId
        ? prisma.trainingClass.findUnique({ where: { id: dto.classId } })
        : null,
      dto.sessionId
        ? prisma.trainingSession.findUnique({
            where: { id: dto.sessionId },
            include: { class: true },
          })
        : null,
      dto.studentId
        ? prisma.student.findUnique({
            where: { id: dto.studentId },
            include: {
              guardian: {
                select: { id: true, status: true, deletedAt: true },
              },
            },
          })
        : null,
      dto.leadId
        ? prisma.customerLead.findUnique({ where: { id: dto.leadId } })
        : null,
      dto.memberId
        ? prisma.user.findUnique({ where: { id: dto.memberId } })
        : null,
      prisma.user.findUnique({
        where: { id: dto.coachId },
        include: { roles: { select: { role: true } } },
      }),
    ]);
  if (!product?.enabled)
    throw new NotFoundException('试听培训产品不存在或已下架');
  if (trainingClass && trainingClass.productId !== product.id) {
    throw new BadRequestException('试听班级不属于所选产品');
  }
  if (!trainingClass && !session) {
    throw new BadRequestException('试听必须关联班级或已排课次');
  }
  if (trainingClass && !trainingClass.active) {
    throw new ConflictException('试听班级已停用');
  }
  if (session) {
    if (trainingClass && session.classId !== trainingClass.id) {
      throw new BadRequestException('试听课次不属于所选班级');
    }
    if (session.class.productId !== product.id) {
      throw new BadRequestException('试听课次不属于所选产品');
    }
    if (session.status !== TrainingSessionStatus.SCHEDULED) {
      throw new ConflictException('试听课次不是待开课状态');
    }
    if (
      session.startsAt > scheduledStartsAt ||
      session.endsAt < scheduledEndsAt
    ) {
      throw new ConflictException('试听时段必须位于所选课次时段内');
    }
  }
  if (dto.studentId && !student)
    throw new NotFoundException('青少年学员不存在');
  if (student && !student.guardianConsentStatus) {
    throw new ConflictException('青少年学员尚未完成监护人授权');
  }
  if (
    student &&
    (student.guardian.status !== UserStatus.ACTIVE ||
      student.guardian.deletedAt)
  ) {
    throw new ConflictException('青少年学员监护人账号不可用');
  }
  if (product.audience === TrainingAudience.YOUTH && !student) {
    throw new BadRequestException('青少年试听必须关联已授权学员与监护人');
  }
  if (product.audience === TrainingAudience.ADULT && student) {
    throw new BadRequestException('成人试听不能关联青少年学员档案');
  }
  if (dto.leadId && (!lead || !activeLeadStatuses.includes(lead.status))) {
    throw new ConflictException('线索不存在或已进入终态，不能预约试听');
  }
  if (
    dto.memberId &&
    (!member || member.status !== UserStatus.ACTIVE || member.deletedAt)
  ) {
    throw new BadRequestException('试听会员不存在或账号不可用');
  }
  const coachRoles = coach
    ? [coach.primaryRole, ...coach.roles.map(({ role }) => role)]
    : [];
  if (
    !coach ||
    coach.status !== UserStatus.ACTIVE ||
    coach.deletedAt ||
    !coachRoles.includes(AppRole.COACH)
  ) {
    throw new BadRequestException('试听教练不存在、已停用或没有教练角色');
  }
  const scopedClass = trainingClass ?? session?.class;
  if (
    scopedClass?.coachId &&
    ![scopedClass.coachId, scopedClass.assistantId].includes(dto.coachId)
  ) {
    throw new ForbiddenException('试听教练必须是所选班级的教练或助教');
  }
  const courtBooking = await prisma.courtBooking.findFirst({
    where: {
      trainingClassId: scopedClass!.id,
      status: { not: BookingStatus.CANCELLED },
      startsAt: { lte: scheduledStartsAt },
      endsAt: { gte: scheduledEndsAt },
    },
    select: { courtId: true },
  });
  if (!courtBooking) {
    throw new ConflictException('试听时段没有已确认的培训场地资源');
  }
  const closure = await prisma.courtClosure.findFirst({
    where: {
      courtId: courtBooking.courtId,
      status: 'ACTIVE',
      startsAt: { lt: scheduledEndsAt },
      endsAt: { gt: scheduledStartsAt },
    },
    select: { id: true },
  });
  if (closure) throw new ConflictException('试听场地在所选时段已封场');
  await assertNoScheduleConflict(
    prisma,
    dto,
    scheduledStartsAt,
    scheduledEndsAt,
  );

  try {
    return await prisma.$transaction(
      async (tx) => {
        const concurrent = await tx.trainingTrial.findUnique({
          where: { creationIdempotencyKey: idempotencyKey },
          include: trialInclude,
        });
        if (concurrent) {
          if (
            concurrent.createdById !== actor.sub ||
            concurrent.creationCommandHash !== commandHash
          ) {
            throw new ConflictException('试听预约幂等键已用于其他命令');
          }
          return trainingTrialResponse(concurrent, true);
        }
        await assertNoScheduleConflict(
          tx,
          dto,
          scheduledStartsAt,
          scheduledEndsAt,
        );
        const currentLead = lead
          ? await tx.customerLead.findUnique({ where: { id: lead.id } })
          : null;
        if (
          lead &&
          (!currentLead || !activeLeadStatuses.includes(currentLead.status))
        ) {
          throw new ConflictException('线索已变化，不能预约试听，请刷新后重试');
        }
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
        });
        if (currentLead) {
          await appendLeadEvidence(
            tx,
            currentLead,
            actor,
            LeadStatus.TRIAL_RESERVED,
            'TRIAL_RESERVED',
            reason,
          );
        }
        await audit(
          tx,
          actor,
          created.id,
          'TRAINING_TRIAL_RESERVED',
          null,
          TrainingTrialStatus.RESERVED,
          reason,
          idempotencyKey,
          { commandHash },
        );
        const trial = await tx.trainingTrial.findUniqueOrThrow({
          where: { id: created.id },
          include: trialInclude,
        });
        return trainingTrialResponse(trial, true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isConcurrentWriteError(error)) throw error;
    const concurrent = await prisma.trainingTrial.findUnique({
      where: { creationIdempotencyKey: idempotencyKey },
      include: trialInclude,
    });
    if (
      concurrent &&
      concurrent.createdById === actor.sub &&
      concurrent.creationCommandHash === commandHash
    ) {
      return trainingTrialResponse(concurrent, true);
    }
    throw new ConflictException(
      '试听预约发生并发冲突，请刷新后使用原幂等键重试',
    );
  }
}

export async function assertNoScheduleConflict(
  db: Pick<PrismaService, 'trainingTrial'> | Prisma.TransactionClient,
  dto: CreateTrainingTrialDto,
  startsAt: Date,
  endsAt: Date,
) {
  const activeStatuses = [
    TrainingTrialStatus.RESERVED,
    TrainingTrialStatus.CHECKED_IN,
    TrainingTrialStatus.ASSESSED,
  ];
  const participantFilters: Prisma.TrainingTrialWhereInput[] = [];
  if (dto.leadId) participantFilters.push({ leadId: dto.leadId });
  if (dto.studentId) participantFilters.push({ studentId: dto.studentId });
  if (dto.memberId) participantFilters.push({ memberId: dto.memberId });
  const conflict = await db.trainingTrial.findFirst({
    where: {
      status: { in: activeStatuses },
      scheduledStartsAt: { lt: endsAt },
      scheduledEndsAt: { gt: startsAt },
      OR: [{ coachId: dto.coachId }, ...participantFilters],
    },
    select: { coachId: true, leadId: true, studentId: true, memberId: true },
  });
  if (!conflict) return;
  if (conflict.coachId === dto.coachId) {
    throw new ConflictException('试听教练在所选时段已有其他试听');
  }
  throw new ConflictException('试听对象在所选时段已有其他预约');
}
