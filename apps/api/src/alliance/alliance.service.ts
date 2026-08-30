import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { calculateRoi } from '@yanqing/shared';
import QRCode from 'qrcode';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  CouponStatus,
  Prisma,
  SettlementStatus,
  UserStatus,
} from '../generated/prisma/client.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from '../operations/frontdesk-shift-gate.js';
import type {
  AllianceSettlementDto,
  CreateCouponTemplateDto,
  CreateMerchantDto,
  GenerateCouponCodesDto,
  RedeemCouponDto,
  SetCouponTemplateStatusDto,
  SetMerchantStatusDto,
  SettlementActionDto,
} from './alliance.dto.js';

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

const lifecycleCommandHash = (command: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(command)).digest('hex');

const couponBatchCode = (requestId: string, index: number) =>
  `YQ-${createHash('sha256').update(requestId).digest('hex').toUpperCase()}-${String(index + 1).padStart(4, '0')}`;

const NEWCOMER_COUPON_PREFIX = 'NEWCOMER';
const NEWCOMER_VALIDITY_PARAMETER = 'newcomer.experience.valid_days';
const DEFAULT_NEWCOMER_VALIDITY_DAYS = 7;

@Injectable()
export class AllianceService {
  constructor(private readonly prisma: PrismaService) {}

  async listMerchants(actor: AuthUser) {
    const isPrivileged = actor.roles.some((role) =>
      [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    );
    const isMerchantOnly =
      actor.roles.includes(AppRole.MERCHANT) && !isPrivileged;
    const merchantIds = isMerchantOnly
      ? ((
          await this.prisma.userRole.findMany({
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
      return this.prisma.merchant.findMany({
        where,
        include: {
          _count: {
            select: { couponTemplates: true, couponRedemptions: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.merchant.findMany({
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

  async createMerchant(dto: CreateMerchantDto, actor: AuthUser) {
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    const category = dto.category.trim();
    if (code.length < 2 || name.length < 2 || category.length < 2) {
      throw new BadRequestException('商户编码、名称和分类至少需要2个字符');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
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

  async setMerchantStatus(
    merchantId: string,
    dto: SetMerchantStatusDto,
    actor: AuthUser,
  ) {
    this.assertAllianceAdministrator(actor);
    if (
      dto.status !== UserStatus.ACTIVE &&
      dto.status !== UserStatus.DISABLED
    ) {
      throw new BadRequestException('商户仅允许启用或停用，不允许删除');
    }
    const reason = this.lifecycleReason(dto.reason);
    const requestId = this.allianceRequestId(dto.idempotencyKey);
    const action = 'ALLIANCE_MERCHANT_STATUS_SET';
    const commandHash = lifecycleCommandHash({
      kind: action,
      merchantId,
      status: dto.status,
      reason,
    });

    try {
      return await this.prisma.$transaction(
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
            this.assertAllianceCommandReplay(replay, {
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
              actorRole: this.allianceAdministratorRole(actor),
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
      const replay = await this.prisma.auditLog.findFirst({
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
        this.assertAllianceCommandReplay(replay, {
          actor,
          action,
          objectType: 'Merchant',
          objectId: merchantId,
          commandHash,
        });
        return this.prisma.merchant.findUniqueOrThrow({
          where: { id: merchantId },
        });
      }
      if (concurrentChange) throw error;
      throw new ConflictException('商户状态刚刚发生变化，请刷新后重试');
    }
  }

  async listTemplates(actor: AuthUser) {
    const administrator = actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    );
    if (!administrator && !actor.roles.includes(AppRole.MERCHANT)) {
      throw new ForbiddenException('当前角色无权查看联盟券模板');
    }
    const merchantIds = administrator
      ? undefined
      : ((
          await this.prisma.userRole.findMany({
            where: { userId: actor.sub, role: AppRole.MERCHANT },
            select: { merchantId: true },
          })
        )
          .map((role) => role.merchantId)
          .filter(Boolean) as string[]);

    return this.prisma.couponTemplate.findMany({
      where: merchantIds ? { merchantId: { in: merchantIds } } : undefined,
      include: {
        merchant: {
          select: { id: true, code: true, name: true, status: true },
        },
      },
      orderBy: [
        { enabled: 'desc' },
        { validTo: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async createTemplate(dto: CreateCouponTemplateDto, actor: AuthUser) {
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
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: dto.merchantId },
      select: { id: true, status: true },
    });
    if (!merchant) throw new NotFoundException('商户不存在');
    if (merchant.status !== UserStatus.ACTIVE)
      throw new ConflictException('停用商户不能创建券模板');
    try {
      return await this.prisma.$transaction(async (tx) => {
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

  async setTemplateStatus(
    templateId: string,
    dto: SetCouponTemplateStatusDto,
    actor: AuthUser,
  ) {
    this.assertAllianceAdministrator(actor);
    const reason = this.lifecycleReason(dto.reason);
    const requestId = this.allianceRequestId(dto.idempotencyKey);
    const action = 'ALLIANCE_COUPON_TEMPLATE_STATUS_SET';
    const commandHash = lifecycleCommandHash({
      kind: action,
      templateId,
      enabled: dto.enabled,
      reason,
    });

    try {
      return await this.prisma.$transaction(
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
            this.assertAllianceCommandReplay(replay, {
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
            data: { enabled: dto.enabled },
          });
          if (changed.count !== 1)
            throw new ConflictException('券模板状态已由其他管理员变更');
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: this.allianceAdministratorRole(actor),
              action,
              objectType: 'CouponTemplate',
              objectId: templateId,
              oldValue: { enabled: template.enabled } as never,
              newValue: { enabled: dto.enabled, commandHash } as never,
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
      const replay = await this.prisma.auditLog.findFirst({
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
        this.assertAllianceCommandReplay(replay, {
          actor,
          action,
          objectType: 'CouponTemplate',
          objectId: templateId,
          commandHash,
        });
        return this.prisma.couponTemplate.findUniqueOrThrow({
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

  listMyCoupons(actor: AuthUser) {
    return this.prisma.couponCode.findMany({
      where: { holderId: actor.sub },
      // A member only needs the benefit and public partner identity.  Never
      // serialize the merchant contact or settlement rule through the nested
      // template relation: that would bypass the redaction in listMerchants.
      select: {
        id: true,
        templateId: true,
        code: true,
        status: true,
        holderId: true,
        claimedAt: true,
        redeemedAt: true,
        expiresAt: true,
        attributedAmountCents: true,
        createdAt: true,
        updatedAt: true,
        template: {
          select: {
            id: true,
            code: true,
            name: true,
            activityName: true,
            benefitDescription: true,
            faceValueCents: true,
            validFrom: true,
            validTo: true,
            enabled: true,
            merchant: {
              select: {
                id: true,
                code: true,
                name: true,
                category: true,
                level: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
    });
  }

  async generateCodes(
    templateId: string,
    dto: GenerateCouponCodesDto,
    actor: AuthUser,
  ) {
    const requestId = this.allianceRequestId(dto.idempotencyKey);
    const action = 'COUPON_CODES_GENERATED';
    const commandHash = lifecycleCommandHash({
      kind: action,
      templateId,
      count: dto.count,
    });
    const ownedTemplate = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: {
        merchantId: true,
        enabled: true,
        validTo: true,
        merchant: { select: { status: true } },
      },
    });
    if (!ownedTemplate) throw new NotFoundException('券模板不存在');
    await this.assertMerchantAccess(
      ownedTemplate.merchantId,
      actor,
      '只能操作本商户的券码',
    );
    const replay = await this.prisma.auditLog.findFirst({
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
      return this.couponBatchReplay(replay, {
        actor,
        action,
        objectType: 'CouponTemplate',
        objectId: templateId,
        commandHash,
        count: dto.count,
      });
    }
    if (!ownedTemplate.enabled) throw new ConflictException('券模板已下线');
    if (ownedTemplate.merchant.status !== UserStatus.ACTIVE)
      throw new ConflictException('商户已停用');
    if (ownedTemplate.validTo <= new Date())
      throw new ConflictException('券模板已过期');

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const committed = await tx.auditLog.findFirst({
            where: { requestId },
            select: {
              actorId: true,
              action: true,
              objectType: true,
              objectId: true,
              newValue: true,
            },
          });
          if (committed) {
            return this.couponBatchReplay(committed, {
              actor,
              action,
              objectType: 'CouponTemplate',
              objectId: templateId,
              commandHash,
              count: dto.count,
            });
          }
          const template = await tx.couponTemplate.findUnique({
            where: { id: templateId },
            include: { merchant: { select: { status: true } } },
          });
          if (!template?.enabled)
            throw new NotFoundException('券模板不存在或已下线');
          if (template.merchant.status !== UserStatus.ACTIVE)
            throw new ConflictException('商户已停用');
          if (template.validTo <= new Date())
            throw new ConflictException('券模板已过期');
          if (template.issuedCount + dto.count > template.issueLimit) {
            throw new BadRequestException('生成数量超过模板发行上限');
          }
          const codes = Array.from({ length: dto.count }, (_, index) => ({
            templateId,
            code: couponBatchCode(requestId, index),
            expiresAt: template.validTo,
          }));
          await tx.couponCode.createMany({ data: codes });
          const changed = await tx.couponTemplate.updateMany({
            where: {
              id: templateId,
              enabled: true,
              issuedCount: template.issuedCount,
              updatedAt: template.updatedAt,
            },
            data: { issuedCount: { increment: dto.count } },
          });
          if (changed.count !== 1)
            throw new ConflictException('券模板发行额度已由其他操作更新');
          const generatedCodes = codes.map((item) => item.code);
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action,
              objectType: 'CouponTemplate',
              objectId: templateId,
              newValue: {
                commandHash,
                count: dto.count,
                codes: generatedCodes,
              } as never,
              requestId,
            },
          });
          return { count: dto.count, codes: generatedCodes };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        !isPrismaErrorCode(error, 'P2002') &&
        !isPrismaErrorCode(error, 'P2034')
      )
        throw error;
      const committed = await this.prisma.auditLog.findFirst({
        where: { requestId },
        select: {
          actorId: true,
          action: true,
          objectType: true,
          objectId: true,
          newValue: true,
        },
      });
      if (committed) {
        return this.couponBatchReplay(committed, {
          actor,
          action,
          objectType: 'CouponTemplate',
          objectId: templateId,
          commandHash,
          count: dto.count,
        });
      }
      throw new ConflictException('发行命令与已有券码冲突，请刷新后重试');
    }
  }

  async claim(code: string, actor: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const coupon = await tx.couponCode.findUnique({
          where: { code },
          include: {
            template: { include: { merchant: { select: { status: true } } } },
          },
        });
        if (!coupon) {
          throw new ConflictException('券码不存在或已被领取');
        }
        // A repeated claim from the same member is a safe retry.  Do not
        // increment the template counter again; a different member still
        // receives the normal conflict response below.
        if (coupon.status !== CouponStatus.ISSUED) {
          if (
            coupon.status === CouponStatus.CLAIMED &&
            coupon.holderId === actor.sub
          )
            return coupon;
          throw new ConflictException('券码不存在或已被领取');
        }
        const now = new Date();
        if (
          !coupon.template.enabled ||
          coupon.template.merchant.status !== UserStatus.ACTIVE ||
          coupon.template.validFrom > now ||
          coupon.template.validTo <= now
        ) {
          throw new ConflictException('券活动未开始或已结束');
        }
        const newcomer = coupon.template.code.startsWith(
          NEWCOMER_COUPON_PREFIX,
        );
        if (newcomer) {
          const profile = await tx.memberProfile.findUnique({
            where: { userId: actor.sub },
            select: { isNewCustomer: true },
          });
          if (!profile?.isNewCustomer)
            throw new ConflictException('新客体验权益仅限新客领取');
          const priorNewcomerCoupon = await tx.couponCode.findFirst({
            where: {
              holderId: actor.sub,
              id: { not: coupon.id },
              status: { in: [CouponStatus.CLAIMED, CouponStatus.REDEEMED] },
              template: { code: { startsWith: NEWCOMER_COUPON_PREFIX } },
            },
            select: { id: true },
          });
          if (priorNewcomerCoupon)
            throw new ConflictException('新客体验权益每人仅限一次');
        }
        const claimed = await tx.couponCode.count({
          where: {
            templateId: coupon.templateId,
            holderId: actor.sub,
            status: { in: [CouponStatus.CLAIMED, CouponStatus.REDEEMED] },
          },
        });
        if (claimed >= coupon.template.claimLimitPerUser)
          throw new ConflictException('超过每人领取上限');
        // Claim is a one-time state transition.  Guard the write with the
        // observed ISSUED status so two members cannot both claim the same
        // code under a weaker transaction adapter.  Repeating the same claim
        // by the winning member is idempotent and does not increment counts.
        const newcomerValidity = newcomer
          ? await this.resolveNewcomerValidity(tx, now)
          : null;
        const claimExpiresAt = newcomerValidity
          ? new Date(
              Math.min(
                coupon.expiresAt.getTime(),
                coupon.template.validTo.getTime(),
                now.getTime() + newcomerValidity.days * 86_400_000,
              ),
            )
          : coupon.expiresAt;
        const changed = await tx.couponCode.updateMany({
          where: { id: coupon.id, status: CouponStatus.ISSUED },
          data: {
            status: CouponStatus.CLAIMED,
            holderId: actor.sub,
            claimedAt: now,
            expiresAt: claimExpiresAt,
          },
        });
        if (changed.count !== 1) {
          const latest = await tx.couponCode.findUnique({
            where: { id: coupon.id },
          });
          if (
            latest?.status === CouponStatus.CLAIMED &&
            latest.holderId === actor.sub
          )
            return latest;
          throw new ConflictException('券码已被并发领取');
        }
        await tx.couponTemplate.update({
          where: { id: coupon.templateId },
          data: { claimedCount: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ALLIANCE_COUPON_CLAIMED',
            objectType: 'CouponCode',
            objectId: coupon.id,
            newValue: {
              templateId: coupon.templateId,
              newcomer,
              claimedAt: now.toISOString(),
              expiresAt: claimExpiresAt.toISOString(),
              validityParameterId: newcomerValidity?.parameterId ?? null,
              validityDays: newcomerValidity?.days ?? null,
            } as never,
          },
        });
        return tx.couponCode.findUniqueOrThrow({ where: { id: coupon.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async redeem(dto: RedeemCouponDto, actor: AuthUser) {
    await this.assertRedemptionAccess(dto.merchantId, actor);
    const idempotent = await this.prisma.couponCode.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (idempotent) {
      // An idempotency key identifies one concrete redemption command, not a
      // reusable read token.  Reusing it with another code, merchant or
      // amount must be visible as a conflict instead of silently returning
      // the first result.
      if (idempotent.code !== dto.code) {
        throw new ConflictException('券核销幂等键已用于其他券码');
      }
      if (idempotent.redeemedMerchantId !== dto.merchantId) {
        throw new ForbiddenException('券核销幂等键已用于其他商户');
      }
      if (idempotent.attributedAmountCents !== dto.attributedAmountCents) {
        throw new ConflictException('券核销幂等键已用于不同成交金额');
      }
      return idempotent;
    }

    const redeemMerchant = await this.prisma.merchant.findUnique({
      where: { id: dto.merchantId },
      select: { status: true },
    });
    if (!redeemMerchant) throw new NotFoundException('商户不存在');
    if (redeemMerchant.status !== UserStatus.ACTIVE)
      throw new ConflictException('商户已停用，不能核销券码');

    const preflight = await this.prisma.couponCode.findUnique({
      where: { code: dto.code },
      include: { template: true },
    });
    if (!preflight) throw new NotFoundException('券码不存在');
    if (preflight.status !== CouponStatus.CLAIMED) {
      await this.recordDuplicateRedemption(preflight);
      throw new ConflictException('券码未领取、已核销或已失效');
    }
    if (preflight.template.merchantId !== dto.merchantId)
      throw new ForbiddenException('券码不属于本商户');
    if (preflight.expiresAt <= new Date())
      throw new ConflictException('券码已过期');

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const coupon = await tx.couponCode.findUnique({
            where: { code: dto.code },
            include: { template: true },
          });
          if (!coupon) throw new NotFoundException('券码不存在');
          if (coupon.status !== CouponStatus.CLAIMED)
            throw new ConflictException('券码已被并发核销');
          if (coupon.template.merchantId !== dto.merchantId)
            throw new ForbiddenException('券码不属于本商户');
          if (coupon.expiresAt <= new Date())
            throw new ConflictException('券码已过期');
          // A venue front-desk redemption is a shift-bound cash-desk action.
          // Pure merchant operators redeem against their own independent till
          // and therefore do not participate in the venue shift lifecycle.
          const isVenueOperator = actor.roles.some((role) =>
            [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
              role as never,
            ),
          );
          const shiftAuthorization = isVenueOperator
            ? await requireOpenFrontDeskShift(tx, actor)
            : null;
          const changed = await tx.couponCode.updateMany({
            where: { id: coupon.id, status: CouponStatus.CLAIMED },
            data: {
              status: CouponStatus.REDEEMED,
              redeemedById: actor.sub,
              redeemedMerchantId: dto.merchantId,
              redeemedAt: new Date(),
              attributedAmountCents: dto.attributedAmountCents,
              idempotencyKey: dto.idempotencyKey,
            },
          });
          if (changed.count !== 1)
            throw new ConflictException('券码已被并发核销');
          await tx.couponTemplate.update({
            where: { id: coupon.templateId },
            data: { redeemedCount: { increment: 1 } },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'ALLIANCE_COUPON_REDEEMED',
              objectType: 'CouponCode',
              objectId: coupon.id,
              newValue: {
                merchantId: dto.merchantId,
                attributedAmountCents: dto.attributedAmountCents,
                frontDeskShiftId: shiftAuthorization?.shiftId ?? null,
                adminEmergencyBypass:
                  shiftAuthorization?.mode === 'ADMIN_BYPASS',
              } as never,
            },
          });
          if (shiftAuthorization) {
            await auditAdminShiftBypass(
              tx,
              actor,
              shiftAuthorization,
              'ALLIANCE_COUPON_REDEEM',
              'CouponCode',
              coupon.id,
            );
          }
          return tx.couponCode.findUniqueOrThrow({ where: { id: coupon.id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === '券码已被并发核销'
      ) {
        await this.recordDuplicateRedemption(preflight);
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.couponCode.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (duplicate) {
          if (duplicate.code !== dto.code)
            throw new ConflictException('券核销幂等键已用于其他券码');
          if (duplicate.redeemedMerchantId !== dto.merchantId)
            throw new ForbiddenException('券核销幂等键已用于其他商户');
          if (duplicate.attributedAmountCents !== dto.attributedAmountCents)
            throw new ConflictException('券核销幂等键已用于不同成交金额');
          return duplicate;
        }
      }
      throw error;
    }
  }

  async qr(code: string, actor: AuthUser) {
    const coupon = await this.prisma.couponCode.findUnique({
      where: { code },
      include: { template: true },
    });
    if (!coupon) throw new NotFoundException('券码不存在');
    const staffRoles = new Set<AppRole>([
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    if (
      coupon.holderId !== actor.sub &&
      !actor.roles.some((role) => staffRoles.has(role))
    ) {
      await this.assertMerchantAccess(coupon.template.merchantId, actor);
    }
    const svg = await QRCode.toString(`yanqing://alliance/coupon/${code}`, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    return { code, svg };
  }

  async createSettlement(dto: AllianceSettlementDto, actor: AuthUser) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart) throw new BadRequestException('结算周期无效');
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: dto.merchantId },
    });
    if (!merchant) throw new NotFoundException('商户不存在');
    const codes = await this.prisma.couponCode.findMany({
      where: {
        template: { merchantId: dto.merchantId },
        createdAt: { lt: periodEnd },
        OR: [
          { redeemedAt: { gte: periodStart, lt: periodEnd } },
          { claimedAt: { gte: periodStart, lt: periodEnd } },
          { createdAt: { gte: periodStart, lt: periodEnd } },
        ],
      },
      include: { holder: { include: { memberProfile: true } } },
    });
    const issuedCount = codes.filter(
      (code) => code.createdAt >= periodStart,
    ).length;
    const claimedCount = codes.filter(
      (code) =>
        code.claimedAt &&
        code.claimedAt >= periodStart &&
        code.claimedAt < periodEnd,
    ).length;
    const redeemed = codes.filter(
      (code) =>
        code.redeemedAt &&
        code.redeemedAt >= periodStart &&
        code.redeemedAt < periodEnd,
    );
    const effectiveNewCustomers = new Set(
      redeemed
        .filter((code) => code.holder?.memberProfile?.isNewCustomer)
        .map((code) => code.holderId),
    ).size;
    const attributedGmvCents = redeemed.reduce(
      (sum, code) => sum + code.attributedAmountCents,
      0,
    );
    const cooperationFeeCents = this.computeCooperationFee(
      merchant.settlementRule,
      redeemed.length,
      effectiveNewCustomers,
    );
    const roi = calculateRoi(
      dto.attributedGrossProfitCents,
      cooperationFeeCents,
    );

    const uniqueWhere = {
      merchantId_periodStart_periodEnd: {
        merchantId: dto.merchantId,
        periodStart,
        periodEnd,
      },
    };
    const existing = await this.prisma.allianceSettlement.findUnique({
      where: uniqueWhere,
    });
    if (existing) {
      if (
        existing.attributedGrossProfitCents !== dto.attributedGrossProfitCents
      ) {
        throw new ConflictException(
          '该商户结算周期已生成，利润口径不同，请先提出调整申请',
        );
      }
      return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const settlement = await tx.allianceSettlement.create({
          data: {
            merchantId: dto.merchantId,
            periodStart,
            periodEnd,
            issuedCount,
            claimedCount,
            redeemedCount: redeemed.length,
            effectiveNewCustomers,
            attributedGmvCents,
            attributedGrossProfitCents: dto.attributedGrossProfitCents,
            cooperationFeeCents,
            roi,
            status: SettlementStatus.DRAFT,
            detail: {
              codeIds: redeemed.map((code) => code.id),
              settlementRule: merchant.settlementRule,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ALLIANCE_SETTLEMENT_CREATED',
            objectType: 'AllianceSettlement',
            objectId: settlement.id,
            newValue: {
              redeemedCount: redeemed.length,
              cooperationFeeCents,
              roi,
            } as never,
          },
        });
        return settlement;
      });
    } catch (error) {
      // A second worker can pass the preflight before the first one commits.
      // Resolve the composite unique-key race outside the failed transaction;
      // never catch a constraint error inside the transaction itself.
      if (isPrismaErrorCode(error, 'P2002')) {
        const duplicate = await this.prisma.allianceSettlement.findUnique({
          where: uniqueWhere,
        });
        if (duplicate) {
          if (
            duplicate.attributedGrossProfitCents !==
            dto.attributedGrossProfitCents
          ) {
            throw new ConflictException(
              '该商户结算周期已生成，利润口径不同，请先提出调整申请',
            );
          }
          return duplicate;
        }
      }
      throw error;
    }
  }

  /**
   * Returns statements in the smallest data scope that is useful to the
   * caller.  A merchant can only see statements for merchant roles assigned
   * to the current account; finance and administrators see the full ledger.
   */
  async listSettlements(actor: AuthUser) {
    const privilegedRoles = new Set<AppRole>([
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const isMerchantOnly =
      actor.roles.includes(AppRole.MERCHANT) &&
      !actor.roles.some((role) => privilegedRoles.has(role));
    const merchantIds = isMerchantOnly
      ? ((
          await this.prisma.userRole.findMany({
            where: { userId: actor.sub, role: AppRole.MERCHANT },
            select: { merchantId: true },
          })
        )
          .map((role) => role.merchantId)
          .filter(Boolean) as string[])
      : undefined;

    return this.prisma.allianceSettlement.findMany({
      where: merchantIds ? { merchantId: { in: merchantIds } } : undefined,
      include: { merchant: { select: { id: true, name: true, code: true } } },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Finance submits a calculated draft to the merchant for acknowledgement. */
  submitSettlement(id: string, actor: AuthUser) {
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.PENDING_CONFIRMATION,
      action: 'ALLIANCE_SETTLEMENT_SUBMITTED',
    });
  }

  /** The merchant acknowledges the statement before finance can settle it. */
  confirmSettlement(id: string, actor: AuthUser) {
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.CONFIRMED,
      action: 'ALLIANCE_SETTLEMENT_CONFIRMED',
      requireMerchantScope: true,
      data: { confirmedAt: new Date() },
    });
  }

  /**
   * A dispute returns the statement to DRAFT while retaining the reason and
   * actor in the statement detail/audit trail.  Totals are never overwritten
   * by this action; finance must create a new calculated version if needed.
   */
  async disputeSettlement(
    id: string,
    dto: SettlementActionDto,
    actor: AuthUser,
  ) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('提出争议必须填写原因');
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.DRAFT,
      action: 'ALLIANCE_SETTLEMENT_DISPUTED',
      requireMerchantScope: true,
      reason,
    });
  }

  /** Finance posts the payable after merchant acknowledgement. */
  settleSettlement(id: string, actor: AuthUser) {
    return this.transitionSettlement({
      id,
      actor,
      from: SettlementStatus.CONFIRMED,
      to: SettlementStatus.SETTLED,
      action: 'ALLIANCE_SETTLEMENT_SETTLED',
      data: { settledAt: new Date() },
    });
  }

  private async transitionSettlement(input: {
    id: string;
    actor: AuthUser;
    from: SettlementStatus;
    to: SettlementStatus;
    action: string;
    data?: Record<string, unknown>;
    reason?: string;
    requireMerchantScope?: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.allianceSettlement.findUnique({
        where: { id: input.id },
      });
      if (!current) throw new NotFoundException('联盟结算单不存在');
      if (input.requireMerchantScope) {
        await this.assertMerchantAccess(
          current.merchantId,
          input.actor,
          '只能操作本商户的结算单',
        );
      }
      // A retried request is safe and returns the already-posted state.  This
      // is important for mobile clients that retry after a weak-network
      // timeout.
      if (current.status === input.to) return current;
      if (current.status !== input.from) {
        throw new ConflictException(
          `联盟结算单当前状态为 ${current.status}，不能执行${input.action}`,
        );
      }

      const detail = this.withWorkflowDetail(current.detail, {
        state: input.to,
        action: input.action,
        reason: input.reason,
        actorId: input.actor.sub,
        at: new Date().toISOString(),
      });
      const changed = await tx.allianceSettlement.updateMany({
        where: { id: input.id, status: input.from },
        data: {
          status: input.to,
          detail: detail as never,
          ...input.data,
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.allianceSettlement.findUnique({
          where: { id: input.id },
        });
        if (latest?.status === input.to) return latest;
        throw new ConflictException('联盟结算单已被其他操作更新，请刷新后重试');
      }
      const updated = await tx.allianceSettlement.findUniqueOrThrow({
        where: { id: input.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actor.sub,
          actorRole: input.actor.roles[0],
          action: input.action,
          objectType: 'AllianceSettlement',
          objectId: input.id,
          oldValue: { status: input.from } as never,
          newValue: { status: input.to, reason: input.reason } as never,
          reason: input.reason,
        },
      });
      return updated;
    });
  }

  private withWorkflowDetail(
    value: Prisma.JsonValue,
    workflow: Record<string, unknown>,
  ): Record<string, unknown> {
    const base =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const history = Array.isArray(base.workflowHistory)
      ? base.workflowHistory
      : [];
    return {
      ...base,
      workflowState: workflow.state,
      workflowHistory: [...history, workflow],
    };
  }

  private async assertMerchantAccess(
    merchantId: string,
    actor: AuthUser,
    message = '只能操作本商户的数据',
  ): Promise<void> {
    if (
      actor.roles.some((role) =>
        [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
      )
    )
      return;
    const role = await this.prisma.userRole.findFirst({
      where: { userId: actor.sub, role: AppRole.MERCHANT, merchantId },
    });
    if (!role) throw new ForbiddenException(message);
  }

  private async assertRedemptionAccess(
    merchantId: string,
    actor: AuthUser,
  ): Promise<void> {
    if (actor.roles.includes(AppRole.FRONT_DESK)) return;
    await this.assertMerchantAccess(merchantId, actor, '只能操作本商户的券码');
  }

  private assertAllianceAdministrator(actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
      )
    ) {
      throw new ForbiddenException('仅联盟管理员可以变更启停状态');
    }
  }

  private allianceAdministratorRole(actor: AuthUser): AppRole {
    return actor.roles.includes(AppRole.SUPER_ADMIN)
      ? AppRole.SUPER_ADMIN
      : AppRole.ADMIN;
  }

  private lifecycleReason(value: string): string {
    const reason = value.trim();
    if (reason.length < 2 || reason.length > 300) {
      throw new BadRequestException('状态变更原因需要2-300个字符');
    }
    return reason;
  }

  private allianceRequestId(value: string): string {
    const requestId = value.trim();
    if (requestId.length < 8 || requestId.length > 100) {
      throw new BadRequestException('联盟操作幂等键需要8-100个字符');
    }
    return requestId;
  }

  private assertAllianceCommandReplay(
    replay: {
      actorId: string | null;
      action: string;
      objectType: string;
      objectId: string | null;
      newValue: Prisma.JsonValue;
    },
    expected: {
      actor: AuthUser;
      action: string;
      objectType: string;
      objectId: string;
      commandHash: string;
    },
  ) {
    const newValue =
      replay.newValue &&
      typeof replay.newValue === 'object' &&
      !Array.isArray(replay.newValue)
        ? (replay.newValue as Record<string, unknown>)
        : {};
    if (
      replay.actorId !== expected.actor.sub ||
      replay.action !== expected.action ||
      replay.objectType !== expected.objectType ||
      replay.objectId !== expected.objectId ||
      newValue.commandHash !== expected.commandHash
    ) {
      throw new ConflictException('幂等键已用于其他联盟操作');
    }
  }

  private couponBatchReplay(
    replay: {
      actorId: string | null;
      action: string;
      objectType: string;
      objectId: string | null;
      newValue: Prisma.JsonValue;
    },
    expected: {
      actor: AuthUser;
      action: string;
      objectType: string;
      objectId: string;
      commandHash: string;
      count: number;
    },
  ) {
    this.assertAllianceCommandReplay(replay, expected);
    const newValue =
      replay.newValue &&
      typeof replay.newValue === 'object' &&
      !Array.isArray(replay.newValue)
        ? (replay.newValue as Record<string, unknown>)
        : {};
    const codes = Array.isArray(newValue.codes)
      ? newValue.codes.filter(
          (code): code is string => typeof code === 'string',
        )
      : [];
    if (newValue.count !== expected.count || codes.length !== expected.count) {
      throw new ConflictException('发行命令回放数据不完整，请联系管理员');
    }
    return { count: expected.count, codes };
  }

  private recordDuplicateRedemption(coupon: {
    id: string;
    code: string;
    status: CouponStatus;
    holderId: string | null;
  }) {
    return this.prisma.riskEvent.create({
      data: {
        ruleCode: 'COUPON_DUPLICATE_REDEEM',
        severity: 'HIGH',
        userId: coupon.holderId,
        objectType: 'CouponCode',
        objectId: coupon.id,
        summary: `券码 ${coupon.code} 在 ${coupon.status} 状态被再次核销`,
      },
    });
  }

  private computeCooperationFee(
    rule: Prisma.JsonValue,
    redeemedCount: number,
    effectiveNewCustomers: number,
  ): number {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return 0;
    const mode = typeof rule.mode === 'string' ? rule.mode : 'NONE';
    const configuredAmount =
      typeof rule.amountCents === 'number' ? rule.amountCents : rule.feeCents;
    const amount =
      typeof configuredAmount === 'number'
        ? Math.max(0, Math.round(configuredAmount))
        : 0;
    if (mode === 'FIXED') return amount;
    if (mode === 'PER_REDEMPTION') return amount * redeemedCount;
    if (mode === 'PER_NEW_CUSTOMER') return amount * effectiveNewCustomers;
    return 0;
  }

  private async resolveNewcomerValidity(
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<{ parameterId: string | null; days: number }> {
    const parameter = await tx.systemParameter.findFirst({
      where: {
        key: NEWCOMER_VALIDITY_PARAMETER,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, value: true },
    });
    const configured =
      typeof parameter?.value === 'number'
        ? parameter.value
        : Number(parameter?.value);
    const days = Number.isFinite(configured)
      ? Math.min(30, Math.max(1, Math.round(configured)))
      : DEFAULT_NEWCOMER_VALIDITY_DAYS;
    return { parameterId: parameter?.id ?? null, days };
  }
}
