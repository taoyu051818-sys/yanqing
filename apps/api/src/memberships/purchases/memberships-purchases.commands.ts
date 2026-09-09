import { assertMembershipPurchaseCompatible } from '../membership-entitlements.js';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BusinessType,
  MembershipStatus,
  OrderStatus,
  Prisma,
  SourceChannel,
  SubjectAccount,
} from '../../generated/prisma/client.js';
import type {
  CreateRechargeDto,
  PurchaseMembershipDto,
} from '../memberships.dto.js';
import { executeOrderCreation } from '../../orders/order-creation-idempotency.js';
import { orderResponse } from '../../orders/order-response.js';
import { resolveOperatingShareSnapshot } from '../../common/finance/operating-share.js';
import { orderNo } from '../shared/memberships-support.js';

export async function purchase(
  prisma: PrismaService,
  dto: PurchaseMembershipDto,
  actor: AuthUser,
) {
  const order = await executeOrderCreation(prisma, {
    memberId: actor.sub,
    creationIdempotencyKey: dto.creationIdempotencyKey,
    command: { kind: 'MEMBERSHIP_PURCHASE', productId: dto.productId },
    loadExisting: (id) =>
      prisma.order.findUniqueOrThrow({
        where: { id },
        include: { membership: true },
      }),
    create: (creation) =>
      prisma
        .$transaction(
          async (tx) => {
            const now = new Date();
            const [product, member] = await Promise.all([
              tx.membershipProduct.findUnique({ where: { id: dto.productId } }),
              tx.memberProfile.findUnique({ where: { userId: actor.sub } }),
            ]);
            if (
              !product?.enabled ||
              product.effectiveFrom > now ||
              (product.effectiveTo !== null && product.effectiveTo <= now)
            ) {
              throw new NotFoundException('会员产品不存在、未生效或已停用');
            }
            if (!member) throw new NotFoundException('会员档案不存在');
            await assertMembershipPurchaseCompatible(
              tx,
              member.id,
              product.level,
              undefined,
              now,
            );
            const startsAt = now;
            const endsAt = new Date(
              startsAt.getTime() + product.durationDays * 86_400_000,
            );
            const operatingShare = await resolveOperatingShareSnapshot(
              tx,
              BusinessType.MEMBERSHIP,
              now,
            );
            const created = await tx.order.create({
              data: {
                ...creation,
                orderNo: orderNo('MB'),
                memberId: actor.sub,
                createdById: actor.sub,
                businessType: BusinessType.MEMBERSHIP,
                subjectAccount: SubjectAccount.VENUE,
                sourceChannel: SourceChannel.MINI_PROGRAM,
                status: OrderStatus.PENDING,
                title: product.name,
                listAmountCents: product.priceCents,
                payableCents: product.priceCents,
                parameterSnapshot: {
                  productId: product.id,
                  productCode: product.code,
                  productVersion: product.version,
                  productName: product.name,
                  level: product.level,
                  priceCents: product.priceCents,
                  durationDays: product.durationDays,
                  benefits: product.benefits,
                  effectiveFrom: product.effectiveFrom.toISOString(),
                  effectiveTo: product.effectiveTo?.toISOString() ?? null,
                  operatingShare,
                },
                items: {
                  create: {
                    itemType: 'MEMBERSHIP',
                    itemId: product.id,
                    name: product.name,
                    unitPriceCents: product.priceCents,
                    amountCents: product.priceCents,
                    metadata: {
                      productCode: product.code,
                      productVersion: product.version,
                    },
                  },
                },
                membership: {
                  create: {
                    memberId: member.id,
                    productId: product.id,
                    startsAt,
                    endsAt,
                    status: MembershipStatus.FROZEN,
                  },
                },
              },
              include: { membership: true },
            });
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'MEMBERSHIP_ORDER_CREATED',
                objectType: 'Order',
                objectId: created.id,
                newValue: {
                  memberId: actor.sub,
                  createdById: actor.sub,
                  businessType: BusinessType.MEMBERSHIP,
                  amountCents: product.priceCents,
                  creationIdempotencyKeyPresent: Boolean(
                    creation.creationIdempotencyKey,
                  ),
                  productId: product.id,
                  productCode: product.code,
                  productVersion: product.version,
                  level: product.level,
                  durationDays: product.durationDays,
                } as never,
              },
            });
            return created;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        .catch((error) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034'
          )
            throw new ConflictException('会员订单发生并发变更，请刷新后重试');
          throw error;
        }),
  });
  return orderResponse(order);
}

export async function recharge(
  prisma: PrismaService,
  dto: CreateRechargeDto,
  actor: AuthUser,
) {
  const order = await executeOrderCreation(prisma, {
    memberId: actor.sub,
    creationIdempotencyKey: dto.creationIdempotencyKey,
    command: { kind: 'RECHARGE', planId: dto.planId },
    loadExisting: (id) => prisma.order.findUniqueOrThrow({ where: { id } }),
    create: (creation) =>
      prisma.$transaction(async (tx) => {
        const now = new Date();
        const plan = await tx.rechargePlan.findFirst({
          where: {
            id: dto.planId,
            enabled: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
        });
        if (!plan)
          throw new NotFoundException('充值计划不存在、未生效或已停用');
        const operatingShare = await resolveOperatingShareSnapshot(
          tx,
          BusinessType.RECHARGE,
          now,
        );
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo('RC'),
            memberId: actor.sub,
            createdById: actor.sub,
            businessType: BusinessType.RECHARGE,
            subjectAccount: SubjectAccount.VENUE,
            sourceChannel: SourceChannel.MINI_PROGRAM,
            status: OrderStatus.PENDING,
            title: plan.name,
            listAmountCents: plan.principalCents,
            payableCents: plan.principalCents,
            parameterSnapshot: {
              rechargePlanId: plan.id,
              rechargePlanCode: plan.code,
              rechargePlanVersion: plan.version,
              rechargePlanName: plan.name,
              principalCents: plan.principalCents,
              giftCents: plan.giftCents,
              effectiveFrom: plan.effectiveFrom.toISOString(),
              effectiveTo: plan.effectiveTo?.toISOString() ?? null,
              operatingShare,
            },
            items: {
              create: {
                itemType: 'RECHARGE',
                itemId: plan.id,
                name: plan.name,
                unitPriceCents: plan.principalCents,
                amountCents: plan.principalCents,
                metadata: {
                  rechargePlanCode: plan.code,
                  rechargePlanVersion: plan.version,
                  giftCents: plan.giftCents,
                },
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'RECHARGE_ORDER_CREATED',
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              memberId: actor.sub,
              createdById: actor.sub,
              businessType: BusinessType.RECHARGE,
              amountCents: plan.principalCents,
              creationIdempotencyKeyPresent: Boolean(
                creation.creationIdempotencyKey,
              ),
              rechargePlanId: plan.id,
              rechargePlanCode: plan.code,
              rechargePlanVersion: plan.version,
              principalCents: plan.principalCents,
              giftCents: plan.giftCents,
            } as never,
          },
        });
        return created;
      }),
  });
  return orderResponse(order);
}
