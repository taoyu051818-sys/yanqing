import type { TrainingProductView } from '@yanqing/shared';
import {
  Inject,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  TrainingAudience,
} from '../../generated/prisma/client.js';
import type {
  CreateTrainingClassDto,
  CreateTrainingProductDto,
  UpdateTrainingProductDto,
} from '../training.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import { YouthTrainingRulesService } from '../youth-training-rules.service.js';
import {
  findTrainingCommandReplay,
  assertTrainingCommandReplay,
} from '../shared/training-command-policy.js';
import {
  assertTrainingRole,
  trainingActorRole,
} from '../shared/training-operator-policy.js';
import { validateYouthProduct } from './training-product-policy.js';

const TRAINING_CONFIGURATION_ROLES: readonly AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

@Injectable()
export class TrainingCatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(YouthTrainingRulesService)
    private readonly youthRules?: YouthTrainingRulesService,
  ) {}

  async listProducts(actor: AuthUser): Promise<TrainingProductView[]> {
    const mayConfigureProducts = actor.roles.some(
      (role) => role === AppRole.ADMIN || role === AppRole.SUPER_ADMIN,
    );
    const mayViewClassAssignments = actor.roles.some(
      (role) =>
        role === AppRole.FRONT_DESK ||
        role === AppRole.COACH ||
        role === AppRole.ADMIN ||
        role === AppRole.SUPER_ADMIN,
    );
    const coachOnly =
      actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some(
        (role) => role === AppRole.ADMIN || role === AppRole.SUPER_ADMIN,
      );
    const products = await this.prisma.trainingProduct.findMany({
      where: mayConfigureProducts ? {} : { enabled: true },
      include: {
        classes: {
          where: {
            ...(mayConfigureProducts ? {} : { active: true }),
            ...(coachOnly
              ? { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] }
              : {}),
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      audience: product.audience,
      totalSessions: product.totalSessions,
      validityDays: product.validityDays,
      priceCents: product.priceCents,
      enabled: product.enabled,
      classes: product.classes.map((trainingClass) => ({
        id: trainingClass.id,
        name: trainingClass.name,
        capacity: trainingClass.capacity,
        active: trainingClass.active,
        ...(mayViewClassAssignments
          ? {
              coachId: trainingClass.coachId,
              assistantId: trainingClass.assistantId,
            }
          : {}),
      })),
    }));
  }

  async createProduct(dto: CreateTrainingProductDto, actor: AuthUser) {
    assertTrainingRole(
      actor,
      TRAINING_CONFIGURATION_ROLES,
      '仅管理员可创建培训产品',
    );
    const requestId = dto.creationIdempotencyKey?.trim() || undefined;
    const reason = dto.reason?.trim() || '创建培训产品';
    const unitRevenueCents = Math.round(dto.priceCents / dto.totalSessions);
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_PRODUCT_CREATE',
      code: dto.code,
      name: dto.name,
      audience: dto.audience,
      totalSessions: dto.totalSessions,
      validityDays: dto.validityDays,
      priceCents: dto.priceCents,
      refundRule: dto.refundRule,
      reason,
    });
    const replay = await findTrainingCommandReplay(this.prisma, requestId);
    if (replay) {
      const objectId = assertTrainingCommandReplay(replay, {
        actor,
        action: 'TRAINING_PRODUCT_CREATED',
        objectType: 'TrainingProduct',
        commandHash,
      });
      const existing = await this.prisma.trainingProduct.findUnique({
        where: { id: objectId },
      });
      if (!existing)
        throw new ConflictException('培训产品幂等记录对应的对象不存在');
      return existing;
    }
    const regulatoryValidation =
      dto.audience === TrainingAudience.YOUTH
        ? await validateYouthProduct(this.youthRules, {
            totalSessions: dto.totalSessions,
            validityDays: dto.validityDays,
            priceCents: dto.priceCents,
          })
        : null;

    return this.prisma.$transaction(
      async (tx) => {
        const concurrentReplay = await findTrainingCommandReplay(tx, requestId);
        if (concurrentReplay) {
          const objectId = assertTrainingCommandReplay(concurrentReplay, {
            actor,
            action: 'TRAINING_PRODUCT_CREATED',
            objectType: 'TrainingProduct',
            commandHash,
          });
          return tx.trainingProduct.findUniqueOrThrow({
            where: { id: objectId },
          });
        }
        const created = await tx.trainingProduct.create({
          data: {
            code: dto.code,
            name: dto.name,
            audience: dto.audience,
            totalSessions: dto.totalSessions,
            validityDays: dto.validityDays,
            priceCents: dto.priceCents,
            unitRevenueCents,
            refundRule: dto.refundRule as never,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: trainingActorRole(actor, TRAINING_CONFIGURATION_ROLES),
            action: 'TRAINING_PRODUCT_CREATED',
            objectType: 'TrainingProduct',
            objectId: created.id,
            oldValue: { exists: false } as never,
            newValue: {
              commandHash,
              code: created.code,
              name: created.name,
              audience: created.audience,
              totalSessions: created.totalSessions,
              validityDays: created.validityDays,
              priceCents: created.priceCents,
              unitRevenueCents: created.unitRevenueCents,
              refundRule: created.refundRule,
              enabled: created.enabled,
              regulatoryValidation,
            } as never,
            reason,
            requestId,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateProduct(
    id: string,
    dto: UpdateTrainingProductDto,
    actor: AuthUser,
  ) {
    assertTrainingRole(
      actor,
      TRAINING_CONFIGURATION_ROLES,
      '仅管理员可变更培训产品',
    );
    const current = await this.prisma.trainingProduct.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('培训产品不存在');
    const next = {
      name: dto.name?.trim() || current.name,
      totalSessions: dto.totalSessions ?? current.totalSessions,
      validityDays: dto.validityDays ?? current.validityDays,
      priceCents: dto.priceCents ?? current.priceCents,
      refundRule:
        dto.refundRule ?? (current.refundRule as Record<string, unknown>),
      enabled: dto.enabled ?? current.enabled,
    };
    const reason = dto.reason.trim();
    const requestId = dto.idempotencyKey.trim();
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_PRODUCT_UPDATE',
      productId: id,
      ...next,
      reason,
    });
    const replay = await findTrainingCommandReplay(this.prisma, requestId);
    if (replay) {
      const objectId = assertTrainingCommandReplay(replay, {
        actor,
        action: 'TRAINING_PRODUCT_UPDATED',
        objectType: 'TrainingProduct',
        commandHash,
      });
      if (objectId !== id)
        throw new ConflictException('产品变更幂等键已用于其他产品');
      return this.prisma.trainingProduct.findUniqueOrThrow({ where: { id } });
    }
    const regulatoryValidation =
      current.audience === TrainingAudience.YOUTH && next.enabled
        ? await validateYouthProduct(this.youthRules, next)
        : null;

    return this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.trainingProduct.findUnique({ where: { id } });
        if (!latest) throw new NotFoundException('培训产品不存在');
        if (latest.updatedAt.getTime() !== current.updatedAt.getTime()) {
          throw new ConflictException('培训产品已被其他操作更新，请刷新后重试');
        }
        const updated = await tx.trainingProduct.update({
          where: { id },
          data: {
            ...next,
            unitRevenueCents: Math.round(next.priceCents / next.totalSessions),
            refundRule: next.refundRule as never,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: trainingActorRole(actor, TRAINING_CONFIGURATION_ROLES),
            action: 'TRAINING_PRODUCT_UPDATED',
            objectType: 'TrainingProduct',
            objectId: id,
            reason,
            requestId,
            oldValue: {
              name: current.name,
              totalSessions: current.totalSessions,
              validityDays: current.validityDays,
              priceCents: current.priceCents,
              refundRule: current.refundRule,
              enabled: current.enabled,
            } as never,
            newValue: {
              commandHash,
              ...next,
              regulatoryValidation,
            } as never,
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createClass(dto: CreateTrainingClassDto, actor: AuthUser) {
    assertTrainingRole(
      actor,
      TRAINING_CONFIGURATION_ROLES,
      '仅管理员可创建培训班级',
    );
    const requestId = dto.creationIdempotencyKey?.trim() || undefined;
    const reason = dto.reason?.trim() || '创建培训班级';
    const costs = {
      coachCostCents: dto.coachCostCents ?? 0,
      assistantCostCents: dto.assistantCostCents ?? 0,
      materialCostCents: dto.materialCostCents ?? 0,
    };
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_CLASS_CREATE',
      code: dto.code,
      productId: dto.productId,
      name: dto.name,
      coachId: dto.coachId ?? null,
      assistantId: dto.assistantId ?? null,
      schedule: dto.schedule,
      capacity: dto.capacity,
      ...costs,
      reason,
    });
    const replay = await findTrainingCommandReplay(this.prisma, requestId);
    if (replay) {
      const objectId = assertTrainingCommandReplay(replay, {
        actor,
        action: 'TRAINING_CLASS_CREATED',
        objectType: 'TrainingClass',
        commandHash,
      });
      const existing = await this.prisma.trainingClass.findUnique({
        where: { id: objectId },
      });
      if (!existing)
        throw new ConflictException('培训班级幂等记录对应的对象不存在');
      return existing;
    }

    return this.prisma.$transaction(
      async (tx) => {
        const concurrentReplay = await findTrainingCommandReplay(tx, requestId);
        if (concurrentReplay) {
          const objectId = assertTrainingCommandReplay(concurrentReplay, {
            actor,
            action: 'TRAINING_CLASS_CREATED',
            objectType: 'TrainingClass',
            commandHash,
          });
          return tx.trainingClass.findUniqueOrThrow({
            where: { id: objectId },
          });
        }
        const created = await tx.trainingClass.create({
          data: {
            code: dto.code,
            productId: dto.productId,
            name: dto.name,
            coachId: dto.coachId,
            assistantId: dto.assistantId,
            schedule: dto.schedule as never,
            capacity: dto.capacity,
            ...costs,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: trainingActorRole(actor, TRAINING_CONFIGURATION_ROLES),
            action: 'TRAINING_CLASS_CREATED',
            objectType: 'TrainingClass',
            objectId: created.id,
            oldValue: { exists: false } as never,
            newValue: {
              commandHash,
              code: created.code,
              productId: created.productId,
              name: created.name,
              coachId: created.coachId,
              assistantId: created.assistantId,
              schedule: created.schedule,
              capacity: created.capacity,
              coachCostCents: created.coachCostCents,
              assistantCostCents: created.assistantCostCents,
              materialCostCents: created.materialCostCents,
              active: created.active,
            } as never,
            reason,
            requestId,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
