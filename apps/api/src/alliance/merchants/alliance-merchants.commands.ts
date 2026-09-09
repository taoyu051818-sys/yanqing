import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma, UserStatus } from '../../generated/prisma/client.js';
import type {
  CreateMerchantDto,
  SetMerchantStatusDto,
} from '../alliance.dto.js';
import {
  isPrismaErrorCode,
  lifecycleCommandHash,
} from '../shared/alliance-support.js';
import {
  assertAllianceAdministrator,
  allianceAdministratorRole,
  lifecycleReason,
  allianceRequestId,
  assertAllianceCommandReplay,
} from '../shared/alliance-policy.js';

export async function listMerchants(prisma: PrismaService, actor: AuthUser) {
  const isPrivileged = actor.roles.some((role) =>
    [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
      role as never,
    ),
  );
  const isMerchantOnly =
    actor.roles.includes(AppRole.MERCHANT) && !isPrivileged;
  const merchantIds = isMerchantOnly
    ? ((
        await prisma.userRole.findMany({
          where: { userId: actor.sub, role: AppRole.MERCHANT },
          select: { merchantId: true },
        })
      )
        .map((role) => role.merchantId)
        .filter(Boolean) as string[])
    : undefined;

  const where = isMerchantOnly
    ? { id: { in: merchantIds || [] } }
    : isPrivileged
      ? undefined
      : { status: UserStatus.ACTIVE };

  // Contact details and settlement rules are operational secrets.  Finance
  // and administrators need the complete merchant record; members, front
  // desk staff and a merchant account itself receive only the catalogue
  // fields and aggregate counters needed by their workbench.
  if (isPrivileged) {
    return prisma.merchant.findMany({
      where,
      include: {
        _count: {
          select: { couponTemplates: true, couponRedemptions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  return prisma.merchant.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      level: true,
      status: true,
      cooperationStartsAt: true,
      cooperationEndsAt: true,
      _count: { select: { couponTemplates: true, couponRedemptions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createMerchant(
  prisma: PrismaService,
  dto: CreateMerchantDto,
  actor: AuthUser,
) {
  const code = dto.code.trim().toUpperCase();
  const name = dto.name.trim();
  const category = dto.category.trim();
  if (code.length < 2 || name.length < 2 || category.length < 2) {
    throw new BadRequestException('商户编码、名称和分类至少需要2个字符');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: {
          ...dto,
          code,
          name,
          category,
          contactName: dto.contactName?.trim() || undefined,
          contactPhone: dto.contactPhone?.trim() || undefined,
          settlementRule: dto.settlementRule as never,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'ALLIANCE_MERCHANT_CREATED',
          objectType: 'Merchant',
          objectId: created.id,
          newValue: {
            code: created.code,
            name: created.name,
            level: created.level,
          } as never,
        },
      });
      return created;
    });
  } catch (error) {
    if (isPrismaErrorCode(error, 'P2002'))
      throw new ConflictException('商户编码已存在');
    throw error;
  }
}

export async function setMerchantStatus(
  prisma: PrismaService,
  merchantId: string,
  dto: SetMerchantStatusDto,
  actor: AuthUser,
) {
  assertAllianceAdministrator(actor);
  if (dto.status !== UserStatus.ACTIVE && dto.status !== UserStatus.DISABLED) {
    throw new BadRequestException('商户仅允许启用或停用，不允许删除');
  }
  const reason = lifecycleReason(dto.reason);
  const requestId = allianceRequestId(dto.idempotencyKey);
  const action = 'ALLIANCE_MERCHANT_STATUS_SET';
  const commandHash = lifecycleCommandHash({
    kind: action,
    merchantId,
    status: dto.status,
    reason,
  });

  try {
    return await prisma.$transaction(
      async (tx) => {
        const replay = await tx.auditLog.findFirst({
          where: { requestId },
          select: {
            actorId: true,
            action: true,
            objectType: true,
            objectId: true,
            newValue: true,
          },
        });
        if (replay) {
          assertAllianceCommandReplay(replay, {
            actor,
            action,
            objectType: 'Merchant',
            objectId: merchantId,
            commandHash,
          });
          return tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
        }
        const merchant = await tx.merchant.findUnique({
          where: { id: merchantId },
        });
        if (!merchant) throw new NotFoundException('商户不存在');
        if (
          merchant.status !== UserStatus.ACTIVE &&
          merchant.status !== UserStatus.DISABLED
        ) {
          throw new ConflictException('已删除商户不能重新启用或停用');
        }
        const changed = await tx.merchant.updateMany({
          where: {
            id: merchantId,
            status: merchant.status,
            updatedAt: merchant.updatedAt,
          },
          data: { status: dto.status },
        });
        if (changed.count !== 1)
          throw new ConflictException('商户状态已由其他管理员变更');
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: allianceAdministratorRole(actor),
            action,
            objectType: 'Merchant',
            objectId: merchantId,
            oldValue: { status: merchant.status } as never,
            newValue: { status: dto.status, commandHash } as never,
            reason,
            requestId,
          },
        });
        return tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    const concurrentChange =
      error instanceof ConflictException &&
      error.message === '商户状态已由其他管理员变更';
    if (!isPrismaErrorCode(error, 'P2034') && !concurrentChange) throw error;
    const replay = await prisma.auditLog.findFirst({
      where: { requestId },
      select: {
        actorId: true,
        action: true,
        objectType: true,
        objectId: true,
        newValue: true,
      },
    });
    if (replay) {
      assertAllianceCommandReplay(replay, {
        actor,
        action,
        objectType: 'Merchant',
        objectId: merchantId,
        commandHash,
      });
      return prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
      });
    }
    if (concurrentChange) throw error;
    throw new ConflictException('商户状态刚刚发生变化，请刷新后重试');
  }
}
