import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma, UserStatus } from '../../generated/prisma/client.js';
import type {
  CreateCouponTemplateDto,
  SetCouponTemplateStatusDto,
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

export async function listTemplates(prisma: PrismaService, actor: AuthUser) {
  const administrator = actor.roles.some((role) =>
    [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
  );
  if (!administrator && !actor.roles.includes(AppRole.MERCHANT)) {
    throw new ForbiddenException('当前角色无权查看联盟券模板');
  }
  const merchantIds = administrator
    ? undefined
    : ((
        await prisma.userRole.findMany({
          where: { userId: actor.sub, role: AppRole.MERCHANT },
          select: { merchantId: true },
        })
      )
        .map((role) => role.merchantId)
        .filter(Boolean) as string[]);

  return prisma.couponTemplate.findMany({
    where: merchantIds ? { merchantId: { in: merchantIds } } : undefined,
    include: {
      merchant: {
        select: { id: true, code: true, name: true, status: true },
      },
    },
    orderBy: [{ enabled: 'desc' }, { validTo: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createTemplate(
  prisma: PrismaService,
  dto: CreateCouponTemplateDto,
  actor: AuthUser,
) {
  const validFrom = new Date(dto.validFrom);
  const validTo = new Date(dto.validTo);
  if (
    !Number.isFinite(validFrom.getTime()) ||
    !Number.isFinite(validTo.getTime()) ||
    validTo <= validFrom
  ) {
    throw new BadRequestException('券有效期设置无效');
  }
  const code = dto.code.trim().toUpperCase();
  const name = dto.name.trim();
  const activityName = dto.activityName.trim();
  const benefitDescription = dto.benefitDescription.trim();
  if (
    [code, name, activityName, benefitDescription].some(
      (value) => value.length < 2,
    )
  ) {
    throw new BadRequestException(
      '券模板编码、名称、活动和权益说明至少需要2个字符',
    );
  }
  const merchant = await prisma.merchant.findUnique({
    where: { id: dto.merchantId },
    select: { id: true, status: true },
  });
  if (!merchant) throw new NotFoundException('商户不存在');
  if (merchant.status !== UserStatus.ACTIVE)
    throw new ConflictException('停用商户不能创建券模板');
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.couponTemplate.create({
        data: {
          ...dto,
          code,
          name,
          activityName,
          benefitDescription,
          validFrom,
          validTo,
        },
        include: {
          merchant: {
            select: { id: true, code: true, name: true, status: true },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'ALLIANCE_COUPON_TEMPLATE_CREATED',
          objectType: 'CouponTemplate',
          objectId: created.id,
          newValue: {
            merchantId: created.merchantId,
            code: created.code,
            issueLimit: created.issueLimit,
            allowVenueBooking: created.allowVenueBooking,
            validFrom: created.validFrom,
            validTo: created.validTo,
          } as never,
        },
      });
      return created;
    });
  } catch (error) {
    if (isPrismaErrorCode(error, 'P2002'))
      throw new ConflictException('券模板编码已存在');
    throw error;
  }
}

export async function setTemplateStatus(
  prisma: PrismaService,
  templateId: string,
  dto: SetCouponTemplateStatusDto,
  actor: AuthUser,
) {
  assertAllianceAdministrator(actor);
  const reason = lifecycleReason(dto.reason);
  const requestId = allianceRequestId(dto.idempotencyKey);
  const action = 'ALLIANCE_COUPON_TEMPLATE_STATUS_SET';
  const commandHash = lifecycleCommandHash({
    kind: action,
    templateId,
    enabled: dto.enabled,
    allowVenueBooking: dto.allowVenueBooking,
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
            objectType: 'CouponTemplate',
            objectId: templateId,
            commandHash,
          });
          return tx.couponTemplate.findUniqueOrThrow({
            where: { id: templateId },
            include: {
              merchant: {
                select: { id: true, code: true, name: true, status: true },
              },
            },
          });
        }
        const template = await tx.couponTemplate.findUnique({
          where: { id: templateId },
          include: { merchant: { select: { status: true } } },
        });
        if (!template) throw new NotFoundException('券模板不存在');
        if (dto.enabled && template.merchant.status !== UserStatus.ACTIVE) {
          throw new ConflictException('停用商户的券模板不能启用');
        }
        const changed = await tx.couponTemplate.updateMany({
          where: {
            id: templateId,
            enabled: template.enabled,
            updatedAt: template.updatedAt,
          },
          data: {
            enabled: dto.enabled,
            ...(dto.allowVenueBooking === undefined
              ? {}
              : { allowVenueBooking: dto.allowVenueBooking }),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('券模板状态已由其他管理员变更');
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: allianceAdministratorRole(actor),
            action,
            objectType: 'CouponTemplate',
            objectId: templateId,
            oldValue: {
              enabled: template.enabled,
              allowVenueBooking: template.allowVenueBooking,
            } as never,
            newValue: {
              enabled: dto.enabled,
              allowVenueBooking:
                dto.allowVenueBooking ?? template.allowVenueBooking,
              commandHash,
            } as never,
            reason,
            requestId,
          },
        });
        return tx.couponTemplate.findUniqueOrThrow({
          where: { id: templateId },
          include: {
            merchant: {
              select: { id: true, code: true, name: true, status: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    const concurrentChange =
      error instanceof ConflictException &&
      error.message === '券模板状态已由其他管理员变更';
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
        objectType: 'CouponTemplate',
        objectId: templateId,
        commandHash,
      });
      return prisma.couponTemplate.findUniqueOrThrow({
        where: { id: templateId },
        include: {
          merchant: {
            select: { id: true, code: true, name: true, status: true },
          },
        },
      });
    }
    if (concurrentChange) throw error;
    throw new ConflictException('券模板状态刚刚发生变化，请刷新后重试');
  }
}
