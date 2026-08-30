import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { trainingContractContributionCents } from '@yanqing/shared';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  AttendanceStatus,
  BookingStatus,
  BusinessType,
  CourtUsage,
  OrderStatus,
  Prisma,
  ReconciliationPeriodStatus,
  SettlementStatus,
  SubjectAccount,
  TrainingAudience,
  TrainingConsumeCorrectionStatus,
  TrainingEnrollmentStatus,
  TrainingRecognitionType,
  TrainingSessionStatus,
  UserStatus,
} from '../generated/prisma/client.js';
import type {
  AttendanceActionDto,
  ConfirmTrainingConsumeDto,
  ConsumeTrainingDto,
  CreateTrainingConsumeCorrectionDto,
  CreateStudentDto,
  CreateTrainingClassDto,
  CreateTrainingProductDto,
  CreateTrainingSessionDto,
  CreateTrainingSettlementDto,
  DecideTrainingConsumeCorrectionDto,
  ListTrainingSettlementsDto,
  MakeupAttendanceDto,
  PurchaseTrainingDto,
  TrainingSettlementActionDto,
  UpdateStudentDto,
} from './training.dto.js';
import {
  executeOrderCreation,
  type OrderCreationFields,
} from '../orders/order-creation-idempotency.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * There is currently no dedicated TRAINING_SUPERVISOR value in the persisted
 * AppRole enum.  Until that enum is introduced, ADMIN and SUPER_ADMIN are the
 * only roles allowed to post a training consumption into the financial ledger.
 */
const TRAINING_APPROVER_ROLES: readonly AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];
const STUDENT_STAFF_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];
const TRAINING_CORRECTION_MAKER_ROLES: readonly AppRole[] = [
  AppRole.COACH,
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];
const TRAINING_SEAT_HOLD_MS = 15 * 60 * 1_000;
const TRAINING_ATTENDING_STATUSES: readonly TrainingEnrollmentStatus[] = [
  TrainingEnrollmentStatus.ACTIVE,
  TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
];

const TRAINING_SETTLEMENT_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  listProducts() {
    return this.prisma.trainingProduct.findMany({
      where: { enabled: true },
      include: { classes: { where: { active: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  listEnrollments(actor: AuthUser, all = false) {
    const coachScope =
      all &&
      actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) =>
        [
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
          AppRole.FINANCE,
          AppRole.FRONT_DESK,
        ].includes(role as never),
      );
    return this.prisma.trainingEnrollment.findMany({
      where: all
        ? coachScope
          ? {
              class: {
                OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
              },
            }
          : undefined
        : { buyerId: actor.sub },
      include: {
        product: true,
        class: true,
        student: true,
        attendances: {
          include: {
            session: true,
            revenueRecognitions: {
              include: { reversedBy: true },
              orderBy: { sequence: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listSessions(actor?: AuthUser) {
    const coachScope =
      actor?.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) =>
        [
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
          AppRole.FINANCE,
          AppRole.FRONT_DESK,
        ].includes(role as never),
      );
    return this.prisma.trainingSession.findMany({
      where: coachScope
        ? {
            class: {
              OR: [{ coachId: actor?.sub }, { assistantId: actor?.sub }],
            },
          }
        : undefined,
      include: {
        class: { include: { product: true } },
        attendances: {
          include: {
            enrollment: {
              include: {
                buyer: { select: { displayName: true } },
                student: true,
              },
            },
          },
        },
      },
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
  }

  createProduct(dto: CreateTrainingProductDto) {
    return this.prisma.trainingProduct.create({
      data: {
        ...dto,
        unitRevenueCents: Math.round(dto.priceCents / dto.totalSessions),
        refundRule: dto.refundRule as never,
      },
    });
  }

  createClass(dto: CreateTrainingClassDto) {
    return this.prisma.trainingClass.create({
      data: {
        ...dto,
        schedule: dto.schedule as never,
      },
    });
  }

  async listStudents(actor: AuthUser, all = false, guardianId?: string) {
    if (all && !this.hasAnyRole(actor, STUDENT_STAFF_ROLES)) {
      throw new ForbiddenException('仅前台或管理员可查看全部学员档案');
    }
    const normalizedGuardianId = guardianId?.trim();
    if (guardianId !== undefined && !normalizedGuardianId) {
      throw new BadRequestException('监护人账号不能为空');
    }
    return this.prisma.student.findMany({
      where: all
        ? normalizedGuardianId
          ? { guardianId: normalizedGuardianId }
          : undefined
        : { guardianId: actor.sub },
      include: { guardian: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createStudent(dto: CreateStudentDto, actor: AuthUser) {
    const displayName = dto.displayName.trim();
    if (!displayName) throw new BadRequestException('学员姓名不能为空');
    const guardianId = dto.guardianId?.trim() || actor.sub;
    const actingForAnotherGuardian = guardianId !== actor.sub;
    if (
      actingForAnotherGuardian &&
      !this.hasAnyRole(actor, STUDENT_STAFF_ROLES)
    ) {
      throw new ForbiddenException('只能为自己的监护账号创建学员');
    }
    const authorizationNote = dto.authorizationNote?.trim();
    if (
      actingForAnotherGuardian &&
      dto.guardianConsentStatus &&
      !authorizationNote
    ) {
      throw new BadRequestException('代监护人登记授权时必须填写授权凭证说明');
    }
    const birthMonth = this.normalizeBirthMonth(dto.birthMonth);

    return this.prisma.$transaction(async (tx) => {
      const guardian = await tx.user.findFirst({
        where: { id: guardianId, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true },
      });
      if (!guardian) throw new NotFoundException('监护人账号不存在或不可用');
      const student = await tx.student.create({
        data: {
          guardianId,
          displayName,
          birthMonth,
          guardianConsentStatus: dto.guardianConsentStatus,
          authorizationNote:
            authorizationNote ||
            (dto.guardianConsentStatus
              ? '监护人通过小程序确认授权'
              : undefined),
        },
        include: { guardian: { select: { id: true, displayName: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_STUDENT_CREATED',
          objectType: 'Student',
          objectId: student.id,
          reason: authorizationNote,
          newValue: {
            guardianId,
            displayName,
            birthMonth: birthMonth?.toISOString(),
            guardianConsentStatus: dto.guardianConsentStatus,
          } as never,
        },
      });
      return student;
    });
  }

  async updateStudent(
    studentId: string,
    dto: UpdateStudentDto,
    actor: AuthUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.student.findUnique({
        where: { id: studentId },
        include: { guardian: { select: { id: true, displayName: true } } },
      });
      if (!current) throw new NotFoundException('学员档案不存在');
      const actingForAnotherGuardian = current.guardianId !== actor.sub;
      if (
        actingForAnotherGuardian &&
        !this.hasAnyRole(actor, STUDENT_STAFF_ROLES)
      ) {
        throw new ForbiddenException('只能修改自己监护的学员档案');
      }
      const displayName =
        dto.displayName === undefined ? undefined : dto.displayName.trim();
      if (displayName !== undefined && !displayName)
        throw new BadRequestException('学员姓名不能为空');
      const authorizationNote = dto.authorizationNote?.trim();
      if (
        actingForAnotherGuardian &&
        dto.guardianConsentStatus === true &&
        !current.guardianConsentStatus &&
        !authorizationNote
      ) {
        throw new BadRequestException('代监护人确认授权时必须填写授权凭证说明');
      }
      const birthMonth =
        dto.birthMonth === undefined
          ? undefined
          : this.normalizeBirthMonth(dto.birthMonth);
      const nextAuthorizationNote =
        authorizationNote ||
        (!actingForAnotherGuardian &&
        dto.guardianConsentStatus === true &&
        !current.guardianConsentStatus
          ? '监护人通过小程序确认授权'
          : undefined);
      const updated = await tx.student.update({
        where: { id: studentId },
        data: {
          displayName,
          birthMonth,
          guardianConsentStatus: dto.guardianConsentStatus,
          authorizationNote: nextAuthorizationNote,
        },
        include: { guardian: { select: { id: true, displayName: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_STUDENT_UPDATED',
          objectType: 'Student',
          objectId: studentId,
          reason: authorizationNote,
          oldValue: {
            displayName: current.displayName,
            birthMonth: current.birthMonth?.toISOString(),
            guardianConsentStatus: current.guardianConsentStatus,
            authorizationNote: current.authorizationNote,
          } as never,
          newValue: {
            displayName: updated.displayName,
            birthMonth: updated.birthMonth?.toISOString(),
            guardianConsentStatus: updated.guardianConsentStatus,
            authorizationNote: updated.authorizationNote,
          } as never,
        },
      });
      return updated;
    });
  }

  async purchase(dto: PurchaseTrainingDto, actor: AuthUser) {
    return executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: {
        kind: 'TRAINING_PURCHASE',
        productId: dto.productId,
        classId: dto.classId?.trim() || null,
        studentId: dto.studentId?.trim() || null,
        sourceChannel: dto.sourceChannel,
      },
      loadExisting: (id) =>
        this.prisma.order.findUniqueOrThrow({
          where: { id },
          include: { trainingEnrollment: true, items: true },
        }),
      create: (creation) => this.purchaseOnce(dto, actor, creation),
    });
  }

  private async purchaseOnce(
    dto: PurchaseTrainingDto,
    actor: AuthUser,
    creation: OrderCreationFields,
  ) {
    const product = await this.prisma.trainingProduct.findUnique({
      where: { id: dto.productId },
    });
    if (!product?.enabled)
      throw new NotFoundException('培训产品不存在或已下架');
    if (dto.classId) {
      const trainingClass = await this.prisma.trainingClass.findFirst({
        where: { id: dto.classId, productId: product.id, active: true },
      });
      if (!trainingClass)
        throw new BadRequestException('班级不属于所选培训产品');
    }
    if (product.audience === TrainingAudience.YOUTH && !dto.studentId) {
      throw new BadRequestException('青少年课程必须选择学员');
    }
    if (dto.studentId) {
      const student = await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          guardianId: actor.sub,
          guardianConsentStatus: true,
        },
      });
      if (!student)
        throw new BadRequestException('学员不存在或监护人授权未完成');
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + product.validityDays * 86_400_000,
    );
    const seatReservedUntil = dto.classId
      ? new Date(now.getTime() + TRAINING_SEAT_HOLD_MS)
      : undefined;
    return this.prisma.$transaction(
      async (tx) => {
        if (dto.classId) {
          const trainingClass = await tx.trainingClass.findFirst({
            where: { id: dto.classId, productId: product.id, active: true },
          });
          if (!trainingClass)
            throw new BadRequestException('班级不属于所选培训产品');
          const seatWhere: Prisma.TrainingEnrollmentWhereInput = {
            classId: trainingClass.id,
            OR: [
              { status: { in: [...TRAINING_ATTENDING_STATUSES] } },
              {
                status: TrainingEnrollmentStatus.PENDING_PAYMENT,
                seatReservedUntil: { gt: now },
              },
            ],
          };
          const sameLearner = await tx.trainingEnrollment.findFirst({
            where: {
              ...seatWhere,
              ...(dto.studentId
                ? { studentId: dto.studentId }
                : { buyerId: actor.sub, studentId: null }),
            },
            select: { id: true },
          });
          if (sameLearner)
            throw new ConflictException('该学员已报名本班或仍在名额保留期内');
          const occupiedSeats = await tx.trainingEnrollment.count({
            where: seatWhere,
          });
          if (occupiedSeats >= trainingClass.capacity)
            throw new ConflictException('班级名额已满');
        }
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: serial('TR'),
            memberId: actor.sub,
            businessType: BusinessType.TRAINING,
            subjectAccount: SubjectAccount.TRAINING,
            sourceChannel: dto.sourceChannel,
            status: OrderStatus.PENDING,
            title: product.name,
            listAmountCents: product.priceCents,
            payableCents: product.priceCents,
            parameterSnapshot: {
              productId: product.id,
              totalSessions: product.totalSessions,
              unitRevenueCents: product.unitRevenueCents,
              refundRule: product.refundRule,
              classId: dto.classId,
              seatReservedUntil: seatReservedUntil?.toISOString(),
            },
            items: {
              create: {
                itemType: 'TRAINING_PRODUCT',
                itemId: product.id,
                name: product.name,
                unitPriceCents: product.priceCents,
                amountCents: product.priceCents,
              },
            },
            trainingEnrollment: {
              create: {
                enrollmentNo: serial('ENR'),
                productId: product.id,
                classId: dto.classId,
                studentId: dto.studentId,
                buyerId: actor.sub,
                contractNo: serial('HT'),
                totalSessions: product.totalSessions,
                totalAmountCents: product.priceCents,
                prepaidBalanceCents: 0,
                seatReservedUntil,
                startsAt: now,
                expiresAt,
                status: TrainingEnrollmentStatus.PENDING_PAYMENT,
              },
            },
          },
          include: { trainingEnrollment: true, items: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_ORDER_CREATED',
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              productId: product.id,
              classId: dto.classId,
              studentId: dto.studentId,
              seatReservedUntil: seatReservedUntil?.toISOString(),
            } as never,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createSession(dto: CreateTrainingSessionDto, actor: AuthUser) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException('结束时间必须晚于开始时间');
    if (new Set(dto.courtIds).size !== dto.courtIds.length)
      throw new BadRequestException('场地不能重复');
    const trainingClass = await this.prisma.trainingClass.findUnique({
      where: { id: dto.classId },
      include: {
        enrollments: {
          where: { status: { in: [...TRAINING_ATTENDING_STATUSES] } },
        },
      },
    });
    if (!trainingClass?.active) throw new NotFoundException('培训班不存在');
    if (
      actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) =>
        [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
      ) &&
      trainingClass.coachId !== actor.sub &&
      trainingClass.assistantId !== actor.sub
    ) {
      throw new ForbiddenException('教练只能为自己负责的班级排课');
    }
    const occupiedCourtHours =
      dto.courtIds.length *
      ((endsAt.getTime() - startsAt.getTime()) / 3_600_000);

    return this.prisma.$transaction(
      async (tx) => {
        const conflict = await tx.courtBooking.findFirst({
          where: {
            courtId: { in: dto.courtIds },
            status: { not: BookingStatus.CANCELLED },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        });
        if (conflict) throw new ConflictException('所选场地与已有预订冲突');
        const session = await tx.trainingSession.create({
          data: {
            classId: dto.classId,
            startsAt,
            endsAt,
            courtCount: dto.courtIds.length,
            occupiedCourtHours,
            coachCostCents: trainingClass.coachCostCents,
            assistantCostCents: trainingClass.assistantCostCents,
            materialCostCents: trainingClass.materialCostCents,
            note: dto.note,
            attendances: {
              create: trainingClass.enrollments.map((enrollment) => ({
                enrollmentId: enrollment.id,
                status: AttendanceStatus.PENDING,
              })),
            },
          },
          include: { attendances: true },
        });
        await tx.courtBooking.createMany({
          data: dto.courtIds.map((courtId) => ({
            courtId,
            status: BookingStatus.CONFIRMED,
            startsAt,
            endsAt,
            usage: CourtUsage.TRAINING,
            trainingClassId: dto.classId,
            note: `培训课次 ${session.id}，仅记录资源占用，不生成培训场地费`,
          })),
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_SESSION_CREATED',
            objectType: 'TrainingSession',
            objectId: session.id,
            newValue: {
              courtIds: dto.courtIds,
              occupiedCourtHours,
              venueFeeCents: 0,
            } as never,
          },
        });
        return session;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Backwards-compatible command used by the first mini-app release.  A
   * coach now creates a pending recommendation; only an administrator can
   * post the recognition and decrement the prepaid balance.  Existing admin
   * callers can keep using this route and are treated as an explicit
   * confirmation.
   */
  async consume(sessionId: string, dto: ConsumeTrainingDto, actor: AuthUser) {
    if (this.isTrainingApprover(actor)) {
      return this.confirmConsume(sessionId, dto, actor, {
        auditAction: 'TRAINING_SESSION_CONSUMED',
      });
    }
    if (actor.roles.includes(AppRole.COACH)) {
      return this.proposeConsume(sessionId, dto, actor);
    }
    throw new ForbiddenException(
      '仅教练可提交消课建议，培训主管或管理员可确认入账',
    );
  }

  /**
   * Coach-side maker command.  It intentionally does not touch the
   * enrollment balance, revenue recognition, growth points, or attendance
   * status.  `operatorId` is used as the proposal marker because the current
   * schema has no separate approval-task table.
   */
  async proposeConsume(
    sessionId: string,
    dto: ConsumeTrainingDto,
    actor: AuthUser,
  ) {
    if (!actor.roles.includes(AppRole.COACH)) {
      throw new ForbiddenException('仅教练可提交消课建议');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const attendance = await tx.trainingAttendance.findUnique({
          where: {
            sessionId_enrollmentId: {
              sessionId,
              enrollmentId: dto.enrollmentId,
            },
          },
          include: {
            session: { include: { class: true } },
            enrollment: { include: { product: true } },
            revenueRecognitions: {
              include: { reversedBy: true },
              orderBy: { sequence: 'desc' },
            },
          },
        });
        if (!attendance) throw new NotFoundException('课次签到记录不存在');
        const classAssignmentPresent =
          Object.prototype.hasOwnProperty.call(
            attendance.session.class,
            'coachId',
          ) ||
          Object.prototype.hasOwnProperty.call(
            attendance.session.class,
            'assistantId',
          );
        if (
          classAssignmentPresent &&
          attendance.session.class.coachId !== actor.sub &&
          attendance.session.class.assistantId !== actor.sub
        ) {
          throw new ForbiddenException('教练只能提交自己负责班级的消课建议');
        }
        if (
          this.activeConsumeRecognition(attendance.revenueRecognitions) ||
          attendance.consumedSessions > 0
        ) {
          throw new ConflictException('该课次已经消课，禁止重复确认');
        }
        if (attendance.status !== AttendanceStatus.ATTENDED) {
          throw new ConflictException('学员完成到场登记后才能提交消课建议');
        }
        const enrollment = attendance.enrollment;
        if (!TRAINING_ATTENDING_STATUSES.includes(enrollment.status)) {
          throw new ConflictException('报名记录不是在读状态');
        }
        if (
          enrollment.consumedSessions >= enrollment.totalSessions ||
          enrollment.prepaidBalanceCents <= 0
        ) {
          throw new ConflictException('可用课时或预收余额不足');
        }

        // Mobile clients may retry after a timeout.  Returning the existing
        // recommendation is safe because no financial mutation has happened.
        if (attendance.operatorId) {
          if (attendance.operatorId !== actor.sub) {
            throw new ConflictException('该课次已有其他教练提交消课建议');
          }
          return {
            ...attendance,
            workflowStatus: 'PENDING_CONFIRMATION' as const,
            proposedById: attendance.operatorId,
          };
        }

        const feedback = dto.feedback?.trim() || undefined;
        const updated = await tx.trainingAttendance.update({
          where: { id: attendance.id },
          data: {
            // Keep PENDING until the checker confirms the financial posting.
            operatorId: actor.sub,
            feedback,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_CONSUME_PROPOSED',
            objectType: 'TrainingAttendance',
            objectId: attendance.id,
            newValue: {
              workflowStatus: 'PENDING_CONFIRMATION',
              requestedAttendanceStatus: dto.attendanceStatus ?? 'PRESENT',
              feedback,
            } as never,
          },
        });
        return {
          ...updated,
          workflowStatus: 'PENDING_CONFIRMATION' as const,
          proposedById: actor.sub,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Checker command.  It is intentionally separate from `proposeConsume` so
   * a coach token can never reach the ledger mutation.  The optional audit
   * action is used only by the legacy `consume` route to preserve its old
   * audit label for administrator callers.
   */
  async confirmConsume(
    sessionId: string,
    dto: ConfirmTrainingConsumeDto | ConsumeTrainingDto,
    actor: AuthUser,
    options: { auditAction?: string } = {},
  ) {
    this.assertTrainingApprover(actor);
    const auditAction = options.auditAction ?? 'TRAINING_CONSUME_CONFIRMED';
    const reason =
      'reason' in dto ? dto.reason?.trim() || undefined : undefined;

    return this.prisma.$transaction(
      async (tx) => {
        const attendance = await tx.trainingAttendance.findUnique({
          where: {
            sessionId_enrollmentId: {
              sessionId,
              enrollmentId: dto.enrollmentId,
            },
          },
          include: {
            session: { include: { class: true } },
            enrollment: { include: { product: true } },
            revenueRecognitions: {
              include: { reversedBy: true },
              orderBy: { sequence: 'desc' },
            },
          },
        });
        if (!attendance) throw new NotFoundException('课次签到记录不存在');
        const activeRecognition = this.activeConsumeRecognition(
          attendance.revenueRecognitions,
        );
        if (activeRecognition) {
          const requestedKey =
            'idempotencyKey' in dto ? dto.idempotencyKey?.trim() : undefined;
          if (
            !requestedKey ||
            requestedKey === activeRecognition?.idempotencyKey
          )
            return activeRecognition;
          throw new ConflictException('该课次已经消课，禁止重复确认');
        }
        if (attendance.consumedSessions > 0) {
          throw new ConflictException('考勤消课状态与确认流水不一致');
        }
        if (attendance.status !== AttendanceStatus.ATTENDED) {
          throw new ConflictException('当前考勤状态不能确认消课');
        }
        if (!attendance.operatorId) {
          throw new ConflictException('必须先由教练提交消课建议，再由培训主管确认入账');
        }
        if (attendance.operatorId === actor.sub) {
          throw new ForbiddenException('消课建议提交人与确认人不能是同一账号');
        }
        const enrollment = attendance.enrollment;
        if (!TRAINING_ATTENDING_STATUSES.includes(enrollment.status)) {
          throw new ConflictException('报名记录不是在读状态');
        }
        if (
          enrollment.consumedSessions >= enrollment.totalSessions ||
          enrollment.prepaidBalanceCents <= 0
        ) {
          throw new ConflictException('可用课时或预收余额不足');
        }
        const confirmedRevenueCents = Math.min(
          enrollment.product.unitRevenueCents,
          enrollment.prepaidBalanceCents,
        );
        const rateBps = await this.contractRateAt(
          tx,
          attendance.session.startsAt,
        );
        const venueContributionCents = trainingContractContributionCents(
          confirmedRevenueCents,
          rateBps,
        );
        const now = new Date();
        const consumedSessions = enrollment.consumedSessions + 1;
        const remainingPrepaidCents =
          enrollment.prepaidBalanceCents - confirmedRevenueCents;
        const feedback =
          dto.feedback?.trim() || attendance.feedback || undefined;
        const proposedById = attendance.operatorId;
        const nextSequence =
          attendance.revenueRecognitions.reduce(
            (maximum, item) => Math.max(maximum, item.sequence),
            0,
          ) + 1;
        const requestedIdempotencyKey =
          'idempotencyKey' in dto ? dto.idempotencyKey?.trim() : undefined;
        const recognitionIdempotencyKey =
          requestedIdempotencyKey || `CONSUME:${attendance.id}:${nextSequence}`;
        if (requestedIdempotencyKey) {
          const existingByKey = await tx.trainingRevenueRecognition.findUnique({
            where: { idempotencyKey: requestedIdempotencyKey },
            include: { reversedBy: true },
          });
          if (existingByKey) {
            if (
              existingByKey.attendanceId === attendance.id &&
              existingByKey.type === TrainingRecognitionType.CONSUME &&
              !existingByKey.reversedBy
            )
              return existingByKey;
            throw new ConflictException('消课幂等键已用于其他流水');
          }
        }
        const growthPointsAwarded =
          enrollment.product.audience === TrainingAudience.YOUTH ? 1 : 0;

        await tx.trainingAttendance.update({
          where: { id: attendance.id },
          data: {
            status: AttendanceStatus.ATTENDED,
            consumedSessions: 1,
            confirmedRevenueCents,
            growthPointsAwarded,
            feedback,
            // The checker is the final operator of record.  The maker is
            // retained in the confirmation audit's oldValue payload.
            operatorId: actor.sub,
            checkedInAt: now,
            consumedAt: now,
          },
        });
        await tx.trainingEnrollment.update({
          where: { id: enrollment.id },
          data: {
            consumedSessions,
            confirmedRevenueCents: { increment: confirmedRevenueCents },
            prepaidBalanceCents: { decrement: confirmedRevenueCents },
            status:
              consumedSessions >= enrollment.totalSessions ||
              remainingPrepaidCents <= 0
                ? TrainingEnrollmentStatus.COMPLETED
                : enrollment.status,
          },
        });
        const recognition = await tx.trainingRevenueRecognition.create({
          data: {
            attendanceId: attendance.id,
            enrollmentId: enrollment.id,
            type: TrainingRecognitionType.CONSUME,
            sequence: nextSequence,
            effectiveRevenueCents: confirmedRevenueCents,
            contractRateBps: rateBps,
            venueContributionCents,
            venueFeeCents: 0,
            trainingPayableVenueCents: 0,
            idempotencyKey: recognitionIdempotencyKey,
          },
        });
        if (enrollment.product.audience === TrainingAudience.YOUTH) {
          const growthAccount = await tx.account.upsert({
            where: {
              userId_type: {
                userId: enrollment.buyerId,
                type: AccountType.GROWTH_POINTS,
              },
            },
            update: {},
            create: {
              userId: enrollment.buyerId,
              type: AccountType.GROWTH_POINTS,
            },
          });
          const growthKey =
            nextSequence === 1
              ? `GROWTH:${attendance.id}`
              : `GROWTH:${attendance.id}:${nextSequence}`;
          const growthTxn = await tx.accountTransaction.findUnique({
            where: { idempotencyKey: growthKey },
          });
          if (!growthTxn) {
            const changedGrowth = await tx.account.updateMany({
              where: { id: growthAccount.id, version: growthAccount.version },
              data: { balance: { increment: 1 }, version: { increment: 1 } },
            });
            if (changedGrowth.count !== 1)
              throw new ConflictException('成长积分账户已变化，请重试');
            await tx.accountTransaction.create({
              data: {
                accountId: growthAccount.id,
                kind: AccountTxnKind.CREDIT,
                amount: 1,
                balanceBefore: growthAccount.balance,
                balanceAfter: growthAccount.balance + 1,
                reasonCode: 'TRAINING_GROWTH',
                reason: '完成青少年培训课次',
                operatorId: actor.sub,
                idempotencyKey: growthKey,
              },
            });
          }
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: auditAction,
            objectType: 'TrainingAttendance',
            objectId: attendance.id,
            reason,
            oldValue: {
              workflowStatus: proposedById
                ? 'PENDING_CONFIRMATION'
                : 'UNSUBMITTED',
              proposedById,
            } as never,
            newValue: {
              workflowStatus: 'CONFIRMED',
              confirmedRevenueCents,
              contractRateBps: rateBps,
              venueContributionCents,
              venueFeeCents: 0,
              trainingPayableVenueCents: 0,
            } as never,
          },
        });
        return recognition;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Record the operational attendance decision without touching the training
   * ledger.  This is deliberately separate from `consume` so a coach/front
   * desk can make a maker entry while the financial checker remains an
   * administrator.  A leave decision is persisted as MAKEUP_REQUIRED: it is
   * an approved leave which still needs a later session assignment.
   */
  async markAttendance(
    sessionId: string,
    dto: AttendanceActionDto,
    actor: AuthUser,
  ) {
    if (
      !actor.roles.some((role) =>
        (
          [
            AppRole.COACH,
            AppRole.FRONT_DESK,
            AppRole.ADMIN,
            AppRole.SUPER_ADMIN,
          ] as AppRole[]
        ).includes(role as never),
      )
    ) {
      throw new ForbiddenException('当前账号无权登记培训出勤');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const attendance = await tx.trainingAttendance.findUnique({
          where: {
            sessionId_enrollmentId: {
              sessionId,
              enrollmentId: dto.enrollmentId,
            },
          },
          include: {
            session: { include: { class: true } },
            revenueRecognitions: {
              include: { reversedBy: true },
              orderBy: { sequence: 'desc' },
            },
          },
        });
        if (!attendance) throw new NotFoundException('课次签到记录不存在');
        this.assertAttendanceOperator(attendance.session.class, actor);

        if (
          this.activeConsumeRecognition(attendance.revenueRecognitions) ||
          attendance.consumedSessions > 0
        ) {
          throw new ConflictException('已消课记录不能修改出勤状态');
        }
        if (
          dto.status === AttendanceStatus.PENDING ||
          dto.status === AttendanceStatus.MADE_UP ||
          dto.status === AttendanceStatus.MAKEUP_REQUIRED
        ) {
          throw new BadRequestException('请使用出勤、缺勤或请假状态登记');
        }
        if (
          (dto.status === AttendanceStatus.LEAVE ||
            dto.status === AttendanceStatus.CANCELLED) &&
          !dto.reason?.trim()
        ) {
          throw new BadRequestException('请假或取消课次必须填写原因');
        }

        const nextStatus =
          dto.status === AttendanceStatus.LEAVE
            ? AttendanceStatus.MAKEUP_REQUIRED
            : dto.status;
        const terminalStatuses = new Set<AttendanceStatus>([
          AttendanceStatus.ATTENDED,
          AttendanceStatus.ABSENT,
          AttendanceStatus.CANCELLED,
          AttendanceStatus.MAKEUP_REQUIRED,
        ]);
        if (
          terminalStatuses.has(attendance.status) &&
          attendance.status !== nextStatus
        ) {
          throw new ConflictException('当前出勤状态已锁定，请提交更正申请');
        }
        if (attendance.status === nextStatus) return attendance;

        const feedback =
          dto.feedback?.trim() || attendance.feedback || undefined;
        const now = new Date();
        const updated = await tx.trainingAttendance.update({
          where: { id: attendance.id },
          data: {
            status: nextStatus,
            feedback,
            // Attendance evidence and the financial consume proposal are two
            // distinct commands.  The attendance actor remains in AuditLog;
            // operatorId is reserved exclusively for the later proposal's
            // maker so an arrival scan cannot masquerade as approval input.
            operatorId: attendance.operatorId,
            checkedInAt:
              nextStatus === AttendanceStatus.ATTENDED
                ? (attendance.checkedInAt ?? now)
                : attendance.checkedInAt,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_ATTENDANCE_MARKED',
            objectType: 'TrainingAttendance',
            objectId: attendance.id,
            reason: dto.reason?.trim() || undefined,
            oldValue: { status: attendance.status } as never,
            newValue: {
              status: nextStatus,
              requestedStatus: dto.status,
              checkedInAt:
                nextStatus === AttendanceStatus.ATTENDED
                  ? now.toISOString()
                  : null,
            } as never,
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Assign an approved leave to a later session.  Assignment changes only the
   * operational attendance state; the target session is still checked in and
   * consumed through the normal maker/checker flow, so it cannot create a
   * second charge by itself.
   */
  async scheduleMakeup(
    sessionId: string,
    dto: MakeupAttendanceDto,
    actor: AuthUser,
  ) {
    if (
      !actor.roles.some((role) =>
        (
          [AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]
        ).includes(role as never),
      )
    ) {
      throw new ForbiddenException('当前账号无权安排补课');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const original = await tx.trainingAttendance.findUnique({
          where: {
            sessionId_enrollmentId: {
              sessionId,
              enrollmentId: dto.enrollmentId,
            },
          },
          include: {
            session: { include: { class: true } },
          },
        });
        if (!original) throw new NotFoundException('原课次签到记录不存在');
        this.assertAttendanceOperator(original.session.class, actor);

        if (original.status === AttendanceStatus.MADE_UP) {
          return {
            ...original,
            workflowStatus: 'MAKEUP_ALREADY_SCHEDULED' as const,
            makeupSessionId: dto.makeupSessionId,
          };
        }
        if (
          original.status !== AttendanceStatus.MAKEUP_REQUIRED &&
          original.status !== AttendanceStatus.LEAVE
        ) {
          throw new ConflictException('只有已批准请假的课次可以安排补课');
        }
        if (dto.makeupSessionId === sessionId) {
          throw new BadRequestException('补课课次必须晚于原课次');
        }

        const makeupSession = await tx.trainingSession.findUnique({
          where: { id: dto.makeupSessionId },
          include: {
            class: true,
            attendances: { where: { enrollmentId: dto.enrollmentId } },
          },
        });
        if (!makeupSession) throw new NotFoundException('补课课次不存在');
        if (makeupSession.classId !== original.session.classId) {
          throw new BadRequestException('补课必须安排在同一培训班');
        }
        if (makeupSession.startsAt <= original.session.startsAt) {
          throw new BadRequestException('补课课次必须晚于原课次');
        }
        if (
          makeupSession.status === TrainingSessionStatus.CANCELLED ||
          makeupSession.status === TrainingSessionStatus.COMPLETED
        ) {
          throw new ConflictException('已取消或已结束的课次不能安排补课');
        }
        const target = makeupSession.attendances[0];
        if (!target)
          throw new ConflictException('补课课次没有该学员的签到名额');
        if (
          target.status !== AttendanceStatus.PENDING &&
          target.status !== AttendanceStatus.LEAVE
        ) {
          throw new ConflictException('补课课次的学员名额已被处理');
        }

        const updated = await tx.trainingAttendance.update({
          where: { id: original.id },
          data: {
            status: AttendanceStatus.MADE_UP,
            feedback: [original.feedback, `补课安排:${makeupSession.id}`]
              .filter(Boolean)
              .join('；'),
            operatorId: original.operatorId ?? actor.sub,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_MAKEUP_SCHEDULED',
            objectType: 'TrainingAttendance',
            objectId: original.id,
            reason: dto.reason?.trim() || undefined,
            oldValue: { status: original.status } as never,
            newValue: {
              status: AttendanceStatus.MADE_UP,
              makeupSessionId: makeupSession.id,
              targetAttendanceId: target.id,
            } as never,
          },
        });
        return {
          ...updated,
          workflowStatus: 'MAKEUP_SCHEDULED' as const,
          makeupSessionId: makeupSession.id,
          targetAttendanceId: target.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertAttendanceOperator(
    trainingClass: { coachId: string | null; assistantId: string | null },
    actor: AuthUser,
  ): void {
    if (
      this.isTrainingApprover(actor) ||
      actor.roles.includes(AppRole.FRONT_DESK)
    )
      return;
    if (
      actor.roles.includes(AppRole.COACH) &&
      (trainingClass.coachId === actor.sub ||
        trainingClass.assistantId === actor.sub)
    ) {
      return;
    }
    throw new ForbiddenException('只能操作自己负责班级的培训出勤');
  }

  private isTrainingApprover(actor: AuthUser): boolean {
    return actor.roles.some((role) => TRAINING_APPROVER_ROLES.includes(role));
  }

  private assertTrainingApprover(actor: AuthUser): void {
    if (!this.isTrainingApprover(actor)) {
      throw new ForbiddenException('仅培训主管或管理员可确认消课入账');
    }
  }

  async completeSession(sessionId: string, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      // The fallback keeps the command compatible with older lightweight
      // adapters used by the first mini-app release; Prisma always exposes
      // findUnique in production.
      const session = tx.trainingSession.findUnique
        ? await tx.trainingSession.findUnique({
            where: { id: sessionId },
            include: { class: true },
          })
        : ({
            id: sessionId,
            status: TrainingSessionStatus.SCHEDULED,
            class: {},
          } as never);
      if (!session) throw new NotFoundException('培训课次不存在');
      const classAssignmentPresent =
        Object.prototype.hasOwnProperty.call(session.class, 'coachId') ||
        Object.prototype.hasOwnProperty.call(session.class, 'assistantId');
      if (
        classAssignmentPresent &&
        actor.roles.includes(AppRole.COACH) &&
        !actor.roles.some((role) =>
          [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
        ) &&
        session.class.coachId !== actor.sub &&
        session.class.assistantId !== actor.sub
      ) {
        throw new ForbiddenException('教练只能结束自己负责班级的课次');
      }
      if (session.status === TrainingSessionStatus.COMPLETED) return session;
      if (session.status === TrainingSessionStatus.CANCELLED)
        throw new ConflictException('已取消课次不能结课');
      const pending = await tx.trainingAttendance.count({
        where: {
          sessionId,
          status: {
            in: [
              AttendanceStatus.PENDING,
              AttendanceStatus.LEAVE,
              AttendanceStatus.MAKEUP_REQUIRED,
            ],
          },
        },
      });
      if (pending > 0)
        throw new ConflictException('仍有学员未处理签到/请假状态');
      const updated = await tx.trainingSession.update({
        where: { id: sessionId },
        data: { status: TrainingSessionStatus.COMPLETED },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_SESSION_COMPLETED',
          objectType: 'TrainingSession',
          objectId: sessionId,
        },
      });
      return updated;
    });
  }

  listConsumeCorrections(actor: AuthUser) {
    const allowed = [
      AppRole.COACH,
      AppRole.FRONT_DESK,
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ] as const;
    if (!this.hasAnyRole(actor, allowed)) {
      throw new ForbiddenException('当前角色无权查看消课冲正申请');
    }
    const coachScope = this.isCoachOnly(actor);
    return this.prisma.trainingConsumeCorrection.findMany({
      where: coachScope
        ? {
            attendance: {
              session: {
                class: {
                  OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
                },
              },
            },
          }
        : undefined,
      include: {
        recognition: true,
        reversalRecognition: true,
        attendance: {
          include: {
            session: true,
            enrollment: { include: { student: true } },
          },
        },
        requestedBy: { select: { id: true, displayName: true } },
        reviewedBy: { select: { id: true, displayName: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async requestConsumeCorrection(
    dto: CreateTrainingConsumeCorrectionDto,
    actor: AuthUser,
  ) {
    if (!this.hasAnyRole(actor, TRAINING_CORRECTION_MAKER_ROLES)) {
      throw new ForbiddenException('仅教练、前台或管理员可申请消课冲正');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('冲正申请原因不能为空');
    const existing = await this.prisma.trainingConsumeCorrection.findUnique({
      where: { requestIdempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      return this.assertCorrectionRequestReplay(existing, dto, actor, reason);
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const recognition = await tx.trainingRevenueRecognition.findUnique({
            where: { id: dto.recognitionId },
            include: {
              reversedBy: true,
              attendance: {
                include: { session: { include: { class: true } } },
              },
            },
          });
          if (
            !recognition ||
            recognition.type !== TrainingRecognitionType.CONSUME
          ) {
            throw new NotFoundException('可冲正的消课确认流水不存在');
          }
          if (recognition.reversedBy)
            throw new ConflictException('该消课流水已冲正');
          if (this.isCoachOnly(actor)) {
            const trainingClass = recognition.attendance.session.class;
            if (
              trainingClass.coachId !== actor.sub &&
              trainingClass.assistantId !== actor.sub
            ) {
              throw new ForbiddenException(
                '教练只能申请自己负责班级的消课冲正',
              );
            }
          }
          const pending = await tx.trainingConsumeCorrection.findFirst({
            where: {
              recognitionId: recognition.id,
              status: {
                in: [
                  TrainingConsumeCorrectionStatus.REQUESTED,
                  TrainingConsumeCorrectionStatus.APPROVED,
                ],
              },
            },
          });
          if (pending)
            throw new ConflictException(
              '该消课流水已有待处理或已批准的冲正申请',
            );
          const correction = await tx.trainingConsumeCorrection.create({
            data: {
              recognitionId: recognition.id,
              attendanceId: recognition.attendanceId,
              reason,
              requestedById: actor.sub,
              requestIdempotencyKey: dto.idempotencyKey,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'TRAINING_CONSUME_CORRECTION_REQUESTED',
              objectType: 'TrainingConsumeCorrection',
              objectId: correction.id,
              reason,
              oldValue: { status: null } as never,
              newValue: {
                status: TrainingConsumeCorrectionStatus.REQUESTED,
                recognitionId: recognition.id,
              } as never,
            },
          });
          return correction;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate =
          await this.prisma.trainingConsumeCorrection.findUnique({
            where: { requestIdempotencyKey: dto.idempotencyKey },
          });
        if (duplicate)
          return this.assertCorrectionRequestReplay(
            duplicate,
            dto,
            actor,
            reason,
          );
        const active = await this.prisma.trainingConsumeCorrection.findFirst({
          where: {
            recognitionId: dto.recognitionId,
            status: {
              in: [
                TrainingConsumeCorrectionStatus.REQUESTED,
                TrainingConsumeCorrectionStatus.APPROVED,
              ],
            },
          },
        });
        if (active)
          throw new ConflictException('该消课流水已有待处理或已批准的冲正申请');
      }
      throw error;
    }
  }

  async approveConsumeCorrection(
    id: string,
    dto: DecideTrainingConsumeCorrectionDto,
    actor: AuthUser,
  ) {
    this.assertTrainingApprover(actor);
    const reviewReason = dto.reason?.trim() || '复核同意消课冲正';
    const decisionReplay =
      await this.prisma.trainingConsumeCorrection.findUnique({
        where: { decisionIdempotencyKey: dto.idempotencyKey },
        include: { recognition: true, reversalRecognition: true },
      });
    if (decisionReplay) {
      if (
        decisionReplay.id === id &&
        decisionReplay.status === TrainingConsumeCorrectionStatus.APPROVED
      ) {
        return decisionReplay;
      }
      throw new ConflictException('冲正决策幂等键已用于其他申请或动作');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const correction = await tx.trainingConsumeCorrection.findUnique({
          where: { id },
          include: {
            recognition: { include: { reversedBy: true } },
            attendance: {
              include: { enrollment: { include: { product: true } } },
            },
            reversalRecognition: true,
          },
        });
        if (!correction) throw new NotFoundException('消课冲正申请不存在');
        if (correction.status === TrainingConsumeCorrectionStatus.APPROVED) {
          if (correction.decisionIdempotencyKey !== dto.idempotencyKey) {
            throw new ConflictException('冲正申请已使用其他幂等键批准');
          }
          return correction;
        }
        if (correction.status !== TrainingConsumeCorrectionStatus.REQUESTED) {
          throw new ConflictException('只有待复核申请可以批准');
        }
        if (correction.requestedById === actor.sub) {
          throw new ForbiddenException('消课冲正申请人与复核人不能为同一账号');
        }
        if (
          correction.recognition.type !== TrainingRecognitionType.CONSUME ||
          correction.recognition.reversedBy
        ) {
          throw new ConflictException('目标消课流水已冲正或不可冲正');
        }
        const attendance = correction.attendance;
        const enrollment = attendance.enrollment;
        if (
          attendance.consumedSessions !== 1 ||
          attendance.confirmedRevenueCents !==
            correction.recognition.effectiveRevenueCents ||
          enrollment.consumedSessions < 1 ||
          enrollment.confirmedRevenueCents <
            correction.recognition.effectiveRevenueCents
        ) {
          throw new ConflictException('当前消课余额与待冲正流水不一致');
        }
        const sequence = await tx.trainingRevenueRecognition.aggregate({
          where: { attendanceId: attendance.id },
          _max: { sequence: true },
        });
        const reversal = await tx.trainingRevenueRecognition.create({
          data: {
            attendanceId: attendance.id,
            enrollmentId: enrollment.id,
            type: TrainingRecognitionType.REVERSAL,
            sequence: (sequence._max.sequence ?? 0) + 1,
            reversalOfId: correction.recognition.id,
            effectiveRevenueCents:
              -correction.recognition.effectiveRevenueCents,
            contractRateBps: correction.recognition.contractRateBps,
            venueContributionCents:
              -correction.recognition.venueContributionCents,
            venueFeeCents: 0,
            trainingPayableVenueCents: 0,
            idempotencyKey: `TRAINING_REVERSAL:${dto.idempotencyKey}`,
          },
        });
        const nextEnrollmentStatus =
          enrollment.status === TrainingEnrollmentStatus.COMPLETED
            ? enrollment.refundedCents > 0
              ? TrainingEnrollmentStatus.PARTIALLY_REFUNDED
              : TrainingEnrollmentStatus.ACTIVE
            : enrollment.status;
        const enrollmentChanged = await tx.trainingEnrollment.updateMany({
          where: {
            id: enrollment.id,
            consumedSessions: enrollment.consumedSessions,
            confirmedRevenueCents: enrollment.confirmedRevenueCents,
            prepaidBalanceCents: enrollment.prepaidBalanceCents,
          },
          data: {
            consumedSessions: { decrement: 1 },
            confirmedRevenueCents: {
              decrement: correction.recognition.effectiveRevenueCents,
            },
            prepaidBalanceCents: {
              increment: correction.recognition.effectiveRevenueCents,
            },
            status: nextEnrollmentStatus,
          },
        });
        if (enrollmentChanged.count !== 1)
          throw new ConflictException('报名余额已变化，请重试');
        const attendanceChanged = await tx.trainingAttendance.updateMany({
          where: {
            id: attendance.id,
            consumedSessions: attendance.consumedSessions,
            confirmedRevenueCents: attendance.confirmedRevenueCents,
          },
          data: {
            status: AttendanceStatus.ATTENDED,
            consumedSessions: 0,
            confirmedRevenueCents: 0,
            growthPointsAwarded: 0,
            operatorId: null,
            consumedAt: null,
          },
        });
        if (attendanceChanged.count !== 1)
          throw new ConflictException('考勤消课状态已变化，请重试');
        if (
          enrollment.product.audience === TrainingAudience.YOUTH &&
          attendance.growthPointsAwarded > 0
        ) {
          const growthAccount = await tx.account.findUnique({
            where: {
              userId_type: {
                userId: enrollment.buyerId,
                type: AccountType.GROWTH_POINTS,
              },
            },
          });
          if (
            !growthAccount ||
            growthAccount.balance < attendance.growthPointsAwarded
          ) {
            throw new BadRequestException('成长积分余额不足，无法冲正');
          }
          const growthChanged = await tx.account.updateMany({
            where: {
              id: growthAccount.id,
              version: growthAccount.version,
              balance: { gte: attendance.growthPointsAwarded },
            },
            data: {
              balance: { decrement: attendance.growthPointsAwarded },
              version: { increment: 1 },
            },
          });
          if (growthChanged.count !== 1)
            throw new ConflictException('成长积分账户已变化，请重试');
          await tx.accountTransaction.create({
            data: {
              accountId: growthAccount.id,
              kind: AccountTxnKind.DEBIT,
              amount: -attendance.growthPointsAwarded,
              balanceBefore: growthAccount.balance,
              balanceAfter:
                growthAccount.balance - attendance.growthPointsAwarded,
              reasonCode: 'TRAINING_GROWTH_REVERSAL',
              reason: correction.reason,
              operatorId: actor.sub,
              idempotencyKey: `TRAINING_GROWTH_REVERSAL:${correction.id}`,
              metadata: {
                correctionId: correction.id,
                recognitionId: correction.recognition.id,
              },
            },
          });
        }
        const approved = await tx.trainingConsumeCorrection.update({
          where: { id },
          data: {
            status: TrainingConsumeCorrectionStatus.APPROVED,
            reviewReason,
            reviewedById: actor.sub,
            reviewedAt: new Date(),
            reversalRecognitionId: reversal.id,
            decisionIdempotencyKey: dto.idempotencyKey,
          },
          include: { recognition: true, reversalRecognition: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_CONSUME_CORRECTION_APPROVED',
            objectType: 'TrainingConsumeCorrection',
            objectId: id,
            reason: reviewReason,
            oldValue: {
              status: correction.status,
              attendance: {
                status: attendance.status,
                checkedInAt: attendance.checkedInAt?.toISOString(),
                consumedSessions: attendance.consumedSessions,
                confirmedRevenueCents: attendance.confirmedRevenueCents,
                consumedAt: attendance.consumedAt?.toISOString(),
              },
            } as never,
            newValue: {
              status: TrainingConsumeCorrectionStatus.APPROVED,
              reversalRecognitionId: reversal.id,
              effectiveRevenueCents: reversal.effectiveRevenueCents,
              venueFeeCents: 0,
              trainingPayableVenueCents: 0,
              attendance: {
                status: AttendanceStatus.ATTENDED,
                checkedInAt: attendance.checkedInAt?.toISOString(),
                consumedSessions: 0,
                confirmedRevenueCents: 0,
                consumedAt: null,
              },
            } as never,
          },
        });
        return approved;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async rejectConsumeCorrection(
    id: string,
    dto: DecideTrainingConsumeCorrectionDto,
    actor: AuthUser,
  ) {
    this.assertTrainingApprover(actor);
    const reviewReason = dto.reason?.trim();
    if (!reviewReason)
      throw new BadRequestException('驳回冲正申请必须填写原因');
    const decisionReplay =
      await this.prisma.trainingConsumeCorrection.findUnique({
        where: { decisionIdempotencyKey: dto.idempotencyKey },
      });
    if (decisionReplay) {
      if (
        decisionReplay.id === id &&
        decisionReplay.status === TrainingConsumeCorrectionStatus.REJECTED
      ) {
        return decisionReplay;
      }
      throw new ConflictException('冲正决策幂等键已用于其他申请或动作');
    }
    return this.prisma.$transaction(async (tx) => {
      const correction = await tx.trainingConsumeCorrection.findUnique({
        where: { id },
      });
      if (!correction) throw new NotFoundException('消课冲正申请不存在');
      if (correction.status === TrainingConsumeCorrectionStatus.REJECTED) {
        if (correction.decisionIdempotencyKey !== dto.idempotencyKey) {
          throw new ConflictException('冲正申请已使用其他幂等键驳回');
        }
        return correction;
      }
      if (correction.status !== TrainingConsumeCorrectionStatus.REQUESTED) {
        throw new ConflictException('只有待复核申请可以驳回');
      }
      if (correction.requestedById === actor.sub) {
        throw new ForbiddenException('消课冲正申请人与复核人不能为同一账号');
      }
      const rejected = await tx.trainingConsumeCorrection.update({
        where: { id },
        data: {
          status: TrainingConsumeCorrectionStatus.REJECTED,
          reviewReason,
          reviewedById: actor.sub,
          reviewedAt: new Date(),
          decisionIdempotencyKey: dto.idempotencyKey,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_CONSUME_CORRECTION_REJECTED',
          objectType: 'TrainingConsumeCorrection',
          objectId: id,
          reason: reviewReason,
          oldValue: { status: correction.status } as never,
          newValue: {
            status: TrainingConsumeCorrectionStatus.REJECTED,
          } as never,
        },
      });
      return rejected;
    });
  }

  async financialSummary(periodStart: Date, periodEnd: Date) {
    const [recognitions, sessions, enrollments] = await Promise.all([
      this.prisma.trainingRevenueRecognition.findMany({
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
      }),
      this.prisma.trainingSession.findMany({
        where: {
          status: TrainingSessionStatus.COMPLETED,
          startsAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      this.prisma.trainingEnrollment.aggregate({
        _sum: { prepaidBalanceCents: true, refundedCents: true },
      }),
    ]);
    const confirmedRevenueCents = recognitions.reduce(
      (sum, item) => sum + item.effectiveRevenueCents,
      0,
    );
    const coachCostCents = sessions.reduce(
      (sum, session) => sum + session.coachCostCents,
      0,
    );
    const assistantCostCents = sessions.reduce(
      (sum, session) => sum + session.assistantCostCents,
      0,
    );
    const materialCostCents = sessions.reduce(
      (sum, session) => sum + session.materialCostCents,
      0,
    );
    const occupiedCourtHours = sessions.reduce(
      (sum, session) => sum + Number(session.occupiedCourtHours),
      0,
    );
    const contractRateBps = 2_000;
    const venueContractContributionCents =
      confirmedRevenueCents >= 0
        ? trainingContractContributionCents(confirmedRevenueCents, 2_000)
        : -trainingContractContributionCents(-confirmedRevenueCents, 2_000);
    const directCostCents =
      coachCostCents + assistantCostCents + materialCostCents;
    const cashContributionMarginCents = confirmedRevenueCents - directCostCents;
    const summary = {
      effectiveRevenueCents: confirmedRevenueCents,
      contractRateBps,
      venueContractContributionCents,
      venueFeeCents: 0,
      trainingPayableFromVenueCents: 0,
      directCostCents,
      cashContributionMarginCents,
      occupiedCourtHours,
      resourceEfficiencyCentsPerCourtHour:
        occupiedCourtHours === 0
          ? null
          : Math.round(cashContributionMarginCents / occupiedCourtHours),
    };
    return {
      ...summary,
      unusedBalanceCents: enrollments._sum.prepaidBalanceCents ?? 0,
      refundedCents: enrollments._sum.refundedCents ?? 0,
      recognitionCount: recognitions.length,
      consumeCount: recognitions.filter(
        (item) => item.type === TrainingRecognitionType.CONSUME,
      ).length,
      reversalCount: recognitions.filter(
        (item) => item.type === TrainingRecognitionType.REVERSAL,
      ).length,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
    };
  }

  async createSettlement(dto: CreateTrainingSettlementDto, actor: AuthUser) {
    this.assertTrainingSettlementRole(actor);
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart)
      throw new BadRequestException('结算结束时间必须晚于开始时间');
    await this.assertSettlementPeriodUnlocked(
      this.prisma,
      periodStart,
      periodEnd,
    );

    const uniqueWhere = {
      periodStart_periodEnd: { periodStart, periodEnd },
    };
    const existing = await this.prisma.trainingSettlement.findUnique({
      where: uniqueWhere,
    });
    if (existing) {
      this.assertSettlementDraftMatches(existing, dto);
      return existing;
    }

    const base = await this.financialSummary(periodStart, periodEnd);
    const directCostCents =
      base.coachCostCents +
      base.assistantCostCents +
      base.materialCostCents +
      dto.acquisitionCostCents +
      dto.marketingCostCents;
    const cashContributionMarginCents =
      base.effectiveRevenueCents - directCostCents;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.assertSettlementPeriodUnlocked(
            tx,
            periodStart,
            periodEnd,
          );
          const duplicate = await tx.trainingSettlement.findUnique({
            where: uniqueWhere,
          });
          if (duplicate) {
            this.assertSettlementDraftMatches(duplicate, dto);
            return duplicate;
          }
          const settlement = await tx.trainingSettlement.create({
            data: {
              periodStart,
              periodEnd,
              effectiveRevenueCents: base.effectiveRevenueCents,
              contractRateBps: base.contractRateBps,
              venueContributionCents: base.venueContractContributionCents,
              venueFeeCents: 0,
              trainingPayableVenueCents: 0,
              coachCostCents: base.coachCostCents,
              assistantCostCents: base.assistantCostCents,
              materialCostCents: base.materialCostCents,
              acquisitionCostCents: dto.acquisitionCostCents,
              marketingCostCents: dto.marketingCostCents,
              occupiedCourtHours: base.occupiedCourtHours,
              cashContributionMarginCents,
              status: SettlementStatus.DRAFT,
            },
          });
          await tx.trainingRevenueRecognition.updateMany({
            where: {
              settlementId: null,
              createdAt: { gte: periodStart, lt: periodEnd },
            },
            data: { settlementId: settlement.id },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'TRAINING_SETTLEMENT_CREATED',
              objectType: 'TrainingSettlement',
              objectId: settlement.id,
              newValue: {
                status: SettlementStatus.DRAFT,
                effectiveRevenueCents: settlement.effectiveRevenueCents,
                venueContributionCents: settlement.venueContributionCents,
                acquisitionCostCents: settlement.acquisitionCostCents,
                marketingCostCents: settlement.marketingCostCents,
                venueFeeCents: 0,
              } as never,
            },
          });
          return settlement;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        const duplicate = await this.prisma.trainingSettlement.findUnique({
          where: uniqueWhere,
        });
        if (duplicate) {
          this.assertSettlementDraftMatches(duplicate, dto);
          return duplicate;
        }
      }
      throw error;
    }
  }

  async listSettlements(
    query: ListTrainingSettlementsDto,
    actor: AuthUser,
  ) {
    this.assertTrainingSettlementRole(actor);
    const periodStart = query.periodStart
      ? new Date(query.periodStart)
      : undefined;
    const periodEnd = query.periodEnd ? new Date(query.periodEnd) : undefined;
    if (periodStart && periodEnd && periodEnd <= periodStart) {
      throw new BadRequestException('查询结束时间必须晚于开始时间');
    }
    const settlements = await this.prisma.trainingSettlement.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
        ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
      },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    if (!settlements.length) return [];

    const audits = await this.prisma.auditLog.findMany({
      where: {
        objectType: 'TrainingSettlement',
        objectId: { in: settlements.map((settlement) => settlement.id) },
        action: { startsWith: 'TRAINING_SETTLEMENT_' },
      },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return settlements.map((settlement) => {
      const history = audits.filter(
        (audit) => audit.objectId === settlement.id,
      );
      const creator = history.find(
        (audit) => audit.action === 'TRAINING_SETTLEMENT_CREATED',
      );
      return {
        ...settlement,
        createdById: creator?.actorId ?? null,
        createdBy: creator?.actor ?? null,
        workflowHistory: history.map((audit) => ({
          action: audit.action,
          actorId: audit.actorId,
          actorName: audit.actor?.displayName ?? null,
          reason: audit.reason,
          oldValue: audit.oldValue,
          newValue: audit.newValue,
          at: audit.createdAt,
        })),
      };
    });
  }

  submitSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionTrainingSettlement({
      id,
      dto,
      actor,
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.PENDING_CONFIRMATION,
      action: 'TRAINING_SETTLEMENT_SUBMITTED',
    });
  }

  confirmSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionTrainingSettlement({
      id,
      dto,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.CONFIRMED,
      action: 'TRAINING_SETTLEMENT_CONFIRMED',
      forbidCreator: true,
      data: { confirmedById: actor.sub, confirmedAt: new Date() },
    });
  }

  settleSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionTrainingSettlement({
      id,
      dto,
      actor,
      from: SettlementStatus.CONFIRMED,
      to: SettlementStatus.SETTLED,
      action: 'TRAINING_SETTLEMENT_SETTLED',
      forbidCreator: true,
    });
  }

  returnSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionTrainingSettlement({
      id,
      dto,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.DRAFT,
      action: 'TRAINING_SETTLEMENT_RETURNED',
      forbidCreator: true,
      requireReason: true,
      data: { confirmedById: null, confirmedAt: null },
    });
  }

  voidSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return this.transitionTrainingSettlement({
      id,
      dto,
      actor,
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.VOID,
      action: 'TRAINING_SETTLEMENT_VOIDED',
      requireReason: true,
    });
  }

  private async transitionTrainingSettlement(input: {
    id: string;
    dto: TrainingSettlementActionDto;
    actor: AuthUser;
    from: SettlementStatus;
    to: SettlementStatus;
    action: string;
    forbidCreator?: boolean;
    requireReason?: boolean;
    data?: Record<string, unknown>;
  }) {
    this.assertTrainingSettlementRole(input.actor);
    const reason = input.dto.reason?.trim();
    if (input.requireReason && (!reason || reason.length < 2)) {
      throw new BadRequestException('退回或作废结算单必须填写原因');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.trainingSettlement.findUnique({
          where: { id: input.id },
        });
        if (!current) throw new NotFoundException('培训结算单不存在');

        const creator = await tx.auditLog.findFirst({
          where: {
            objectType: 'TrainingSettlement',
            objectId: input.id,
            action: 'TRAINING_SETTLEMENT_CREATED',
          },
          orderBy: { createdAt: 'asc' },
        });
        if (input.forbidCreator && creator?.actorId === input.actor.sub) {
          throw new ForbiddenException('制单人不能确认、结算或退回自己的培训结算单');
        }

        if (input.dto.idempotencyKey) {
          const replay = await tx.auditLog.findFirst({
            where: {
              objectType: 'TrainingSettlement',
              objectId: input.id,
              requestId: input.dto.idempotencyKey,
            },
          });
          if (replay) {
            if (replay.action !== input.action) {
              throw new ConflictException('幂等键已用于其他培训结算动作');
            }
            return current;
          }
        }

        if (current.status === input.to) return current;
        if (current.status !== input.from) {
          throw new ConflictException(
            `培训结算单当前状态为 ${current.status}，不能执行该操作`,
          );
        }
        await this.assertSettlementPeriodUnlocked(
          tx,
          current.periodStart,
          current.periodEnd,
        );

        const changed = await tx.trainingSettlement.updateMany({
          where: { id: input.id, status: input.from },
          data: { status: input.to, ...input.data },
        });
        if (changed.count !== 1) {
          const latest = await tx.trainingSettlement.findUnique({
            where: { id: input.id },
          });
          if (latest?.status === input.to) return latest;
          throw new ConflictException('培训结算单已被其他操作更新，请刷新后重试');
        }
        const updated = await tx.trainingSettlement.findUniqueOrThrow({
          where: { id: input.id },
        });
        await tx.auditLog.create({
          data: {
            actorId: input.actor.sub,
            actorRole: input.actor.roles[0],
            action: input.action,
            objectType: 'TrainingSettlement',
            objectId: input.id,
            oldValue: {
              status: input.from,
              confirmedById: current.confirmedById,
              confirmedAt: current.confirmedAt,
            } as never,
            newValue: {
              status: input.to,
              confirmedById: updated.confirmedById,
              confirmedAt: updated.confirmedAt,
            } as never,
            reason,
            requestId: input.dto.idempotencyKey,
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertTrainingSettlementRole(actor: AuthUser): void {
    if (
      !actor.roles.some((role) => TRAINING_SETTLEMENT_ROLES.includes(role))
    ) {
      throw new ForbiddenException('仅财务或管理员可操作培训结算');
    }
  }

  private assertSettlementDraftMatches(
    settlement: { acquisitionCostCents: number; marketingCostCents: number },
    dto: CreateTrainingSettlementDto,
  ): void {
    if (
      settlement.acquisitionCostCents !== dto.acquisitionCostCents ||
      settlement.marketingCostCents !== dto.marketingCostCents
    ) {
      throw new ConflictException(
        '该培训结算周期已生成，费用口径不同，不能覆盖原草稿',
      );
    }
  }

  private async assertSettlementPeriodUnlocked(
    client: Pick<Prisma.TransactionClient, 'reconciliationPeriod'>,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const shifted = new Date(periodStart.getTime() + SHANGHAI_OFFSET_MS);
    const firstBusinessDay = new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      ) - SHANGHAI_OFFSET_MS,
    );
    const locked = await client.reconciliationPeriod.findFirst({
      where: {
        status: ReconciliationPeriodStatus.LOCKED,
        businessDate: { gte: firstBusinessDay, lt: periodEnd },
      },
      select: { businessDate: true },
    });
    if (locked) {
      throw new ConflictException(
        `账期包含已锁定营业日 ${locked.businessDate.toISOString().slice(0, 10)}，不能新增或变更结算`,
      );
    }
  }

  private activeConsumeRecognition<
    T extends {
      type: TrainingRecognitionType;
      reversedBy?: unknown | null;
    },
  >(recognitions: readonly T[] = []): T | undefined {
    return recognitions.find(
      (item) =>
        item.type === TrainingRecognitionType.CONSUME && !item.reversedBy,
    );
  }

  private isCoachOnly(actor: AuthUser): boolean {
    return (
      actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) =>
        (
          [
            AppRole.FRONT_DESK,
            AppRole.FINANCE,
            AppRole.ADMIN,
            AppRole.SUPER_ADMIN,
          ] as AppRole[]
        ).includes(role),
      )
    );
  }

  private assertCorrectionRequestReplay<
    T extends {
      recognitionId: string;
      reason: string;
      requestedById: string;
    },
  >(
    existing: T,
    dto: CreateTrainingConsumeCorrectionDto,
    actor: AuthUser,
    reason: string,
  ): T {
    if (
      existing.requestedById !== actor.sub ||
      existing.recognitionId !== dto.recognitionId ||
      existing.reason !== reason
    ) {
      throw new ConflictException('冲正申请幂等键已用于其他操作人或命令');
    }
    return existing;
  }

  private hasAnyRole(actor: AuthUser, roles: readonly AppRole[]): boolean {
    return actor.roles.some((role) => roles.includes(role));
  }

  private normalizeBirthMonth(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException('出生月份格式无效');
    const normalized = new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1),
    );
    const currentMonth = new Date();
    const currentMonthStart = new Date(
      Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1),
    );
    if (normalized > currentMonthStart)
      throw new BadRequestException('出生月份不能晚于当前月份');
    if (normalized.getUTCFullYear() < 1900)
      throw new BadRequestException('出生月份超出合理范围');
    return normalized;
  }

  private async contractRateAt(
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<number> {
    const parameter = await tx.systemParameter.findFirst({
      where: {
        key: 'training.contract_rate_bps',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const rate = typeof parameter?.value === 'number' ? parameter.value : 2_000;
    if (rate !== 2_000) {
      throw new BadRequestException('培训合同流水比例必须为20%');
    }
    return rate;
  }
}
