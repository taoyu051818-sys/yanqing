import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  OrderStatus,
  Prisma,
  SubjectAccount,
  TrainingAudience,
  TrainingEnrollmentStatus,
} from '../../generated/prisma/client.js';
import type { PurchaseTrainingDto } from '../training.dto.js';
import {
  executeOrderCreation,
  type OrderCreationFields,
} from '../../orders/order-creation-idempotency.js';
import { orderResponse } from '../../orders/order-response.js';
import { resolveOperatingShareSnapshot } from '../../common/finance/operating-share.js';
import { YouthTrainingRulesService } from '../youth-training-rules.service.js';
import { trainingActiveSeatWhere } from '../training-roster.js';
import { serial } from '../shared/training-command-policy.js';
import { validateYouthProduct } from '../catalog/training-product-policy.js';

const TRAINING_SEAT_HOLD_MS = 15 * 60 * 1_000;

@Injectable()
export class TrainingEnrollmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(YouthTrainingRulesService)
    private readonly youthRules?: YouthTrainingRulesService,
  ) {}

  async listEnrollments(actor: AuthUser, all = false) {
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
    const enrollments = await this.prisma.trainingEnrollment.findMany({
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
        order: { select: { status: true } },
        class: true,
        student: true,
        buyer: { select: { id: true, displayName: true } },
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
    const now = new Date();
    const activeYouthRule = this.youthRules
      ? await this.youthRules.active(now)
      : null;
    return enrollments.map((enrollment) => {
      const warnings: string[] = [];
      if (enrollment.product.audience === TrainingAudience.YOUTH) {
        const remainingDays = Math.ceil(
          (enrollment.expiresAt.getTime() - now.getTime()) / 86_400_000,
        );
        if (remainingDays <= 0) {
          warnings.push('青少年课包已到期');
        } else if (
          activeYouthRule &&
          remainingDays <= activeYouthRule.warningThresholdDays
        ) {
          warnings.push(
            `青少年课包将在 ${remainingDays} 天内到期（当前规则预警阈值 ${activeYouthRule.warningThresholdDays} 天）`,
          );
        }
      }
      const operational = all;
      return {
        id: enrollment.id,
        enrollmentNo: enrollment.enrollmentNo,
        contractNo: enrollment.contractNo,
        productId: enrollment.productId,
        classId: enrollment.classId,
        studentId: enrollment.studentId,
        buyerId: operational ? enrollment.buyerId : undefined,
        orderId: enrollment.orderId,
        totalSessions: enrollment.totalSessions,
        consumedSessions: enrollment.consumedSessions,
        totalAmountCents: enrollment.totalAmountCents,
        prepaidBalanceCents: enrollment.prepaidBalanceCents,
        confirmedRevenueCents: enrollment.confirmedRevenueCents,
        refundedCents: enrollment.refundedCents,
        status: enrollment.status,
        seatReservedUntil: enrollment.seatReservedUntil,
        startsAt: enrollment.startsAt,
        expiresAt: enrollment.expiresAt,
        product: {
          id: enrollment.product.id,
          name: enrollment.product.name,
          audience: enrollment.product.audience,
          totalSessions: enrollment.product.totalSessions,
          validityDays: enrollment.product.validityDays,
          priceCents: enrollment.product.priceCents,
        },
        class: enrollment.class
          ? {
              id: enrollment.class.id,
              name: enrollment.class.name,
              capacity: enrollment.class.capacity,
              active: enrollment.class.active,
            }
          : null,
        student: enrollment.student
          ? {
              id: enrollment.student.id,
              displayName: enrollment.student.displayName,
            }
          : null,
        buyer: operational ? enrollment.buyer : undefined,
        order: enrollment.order ? { status: enrollment.order.status } : null,
        attendances: enrollment.attendances.map((attendance) => ({
          id: attendance.id,
          sessionId: attendance.sessionId,
          enrollmentId: attendance.enrollmentId,
          status: attendance.status,
          consumedSessions: attendance.consumedSessions,
          confirmedRevenueCents: attendance.confirmedRevenueCents,
          growthPointsAwarded: attendance.growthPointsAwarded,
          feedback: attendance.feedback,
          checkedInAt: attendance.checkedInAt,
          consumedAt: attendance.consumedAt,
          ...(operational
            ? {
                operatorId: attendance.operatorId,
                revenueRecognitions: attendance.revenueRecognitions.map(
                  (recognition) => ({
                    id: recognition.id,
                    type: recognition.type,
                    sequence: recognition.sequence,
                    effectiveRevenueCents: recognition.effectiveRevenueCents,
                    reversedBy: recognition.reversedBy
                      ? {
                          id: recognition.reversedBy.id,
                          type: recognition.reversedBy.type,
                          sequence: recognition.reversedBy.sequence,
                        }
                      : null,
                    createdAt: recognition.createdAt,
                  }),
                ),
              }
            : {}),
          session: {
            id: attendance.session.id,
            classId: attendance.session.classId,
            startsAt: attendance.session.startsAt,
            endsAt: attendance.session.endsAt,
            status: attendance.session.status,
          },
        })),
        regulatoryWarnings: warnings,
      };
    });
  }

  async purchase(dto: PurchaseTrainingDto, actor: AuthUser) {
    const order = await executeOrderCreation(this.prisma, {
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
    return orderResponse(order);
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
    const now = new Date();
    const regulatoryValidation =
      product.audience === TrainingAudience.YOUTH
        ? await validateYouthProduct(
            this.youthRules,
            {
              totalSessions: product.totalSessions,
              validityDays: product.validityDays,
              priceCents: product.priceCents,
            },
            now,
          )
        : null;
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
              trainingActiveSeatWhere(),
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
        const operatingShare = await resolveOperatingShareSnapshot(
          tx,
          BusinessType.TRAINING,
          now,
        );
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
              consumptionPolicy: 'FROZEN_CONTRACT_CUMULATIVE_V1',
              refundRule: product.refundRule,
              classId: dto.classId,
              seatReservedUntil: seatReservedUntil?.toISOString(),
              youthRegulatoryValidation: regulatoryValidation,
              operatingShare,
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
            oldValue: { exists: false } as never,
            newValue: {
              commandHash: creation.creationCommandHash,
              productId: product.id,
              classId: dto.classId,
              studentId: dto.studentId,
              seatReservedUntil: seatReservedUntil?.toISOString(),
              youthRegulatoryValidation: regulatoryValidation,
            } as never,
            reason: '创建培训购买订单',
            requestId: creation.creationIdempotencyKey,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
