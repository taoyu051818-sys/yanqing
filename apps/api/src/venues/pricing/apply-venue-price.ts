import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import type { ApplyVenuePriceDto } from '../venues.dto.js';
import {
  PRICE_RULE_WRITE_ROLES,
  isRetryableMasterDataConflict,
  priceRuleView,
} from '../shared/venues-support.js';
import {
  assertPriceRuleCreationReplay,
  assertPriceRuleRole,
  priceRuleAuditRole,
} from './venues-pricing.commands.js';

/** Replace one schedule in one transaction. Never expose an unpriced interval. */
export async function applyVenuePrice(
  prisma: PrismaService,
  dto: ApplyVenuePriceDto,
  actor: AuthUser,
) {
  assertPriceRuleRole(actor, PRICE_RULE_WRITE_ROLES, '仅管理员可修改场地价格');
  const effectiveFrom = new Date(dto.effectiveFrom);
  const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
  if (
    !Number.isFinite(+effectiveFrom) ||
    (effectiveTo &&
      (!Number.isFinite(+effectiveTo) || effectiveTo <= effectiveFrom))
  )
    throw new BadRequestException('结束日期必须晚于生效日期');
  if ((+effectiveFrom + 8 * 3_600_000) % 86_400_000 !== 0)
    throw new BadRequestException('价格按北京时间的营业日期生效，请选择日期');
  if (dto.newcomerPriceCents != null && dto.newcomerPriceCents > dto.priceCents)
    throw new BadRequestException('新客价不得高于普通价');
  if (dto.sourceRuleId && !dto.sourceRevision)
    throw new BadRequestException('请重新加载原价格后再修改');
  const command = {
    operation: 'APPLY_PRICE',
    sourceRuleId: dto.sourceRuleId || null,
    sourceRevision: dto.sourceRevision || null,
    name: dto.name.trim(),
    timeSlotId: dto.timeSlotId || null,
    weekdayMask: dto.weekdayMask,
    priceCents: dto.priceCents,
    newcomerPriceCents: dto.newcomerPriceCents ?? null,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo?.toISOString() ?? null,
    reason: dto.reason.trim(),
  };
  const hash = orderCreationCommandHash(command);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const replay = await tx.priceRule.findUnique({
            where: { creationIdempotencyKey: dto.idempotencyKey },
          });
          if (replay) {
            assertPriceRuleCreationReplay(replay, actor, hash);
            return priceRuleView(replay);
          }
          const source = dto.sourceRuleId
            ? await tx.priceRule.findUnique({ where: { id: dto.sourceRuleId } })
            : null;
          if (dto.sourceRuleId && !source)
            throw new NotFoundException('原价格不存在');
          if (source) {
            if (source.updatedAt.toISOString() !== dto.sourceRevision)
              throw new ConflictException(
                '价格已被其他操作修改，请返回列表刷新后重试',
              );
            // A price edit keeps the original coverage. Scope changes are new schedules.
            if (
              source.timeSlotId !== command.timeSlotId ||
              source.weekdayMask !== dto.weekdayMask
            )
              throw new BadRequestException(
                '调整价格时保留原时段和星期范围；其他范围请新增价格',
              );
            if (
              source.enabled &&
              (effectiveFrom < source.effectiveFrom ||
                (source.effectiveTo && effectiveFrom >= source.effectiveTo))
            )
              throw new BadRequestException('请选择原价格有效期内的生效日期');
            if (
              source.enabled &&
              (source.effectiveTo?.toISOString() ?? null) !==
                command.effectiveTo
            )
              throw new BadRequestException(
                '调整价格时保留原结束日期，避免漏掉可售场次',
              );
          }
          if (command.timeSlotId) {
            const slot = await tx.timeSlot.findUnique({
              where: { id: command.timeSlotId },
            });
            if (!slot?.enabled)
              throw new BadRequestException('所选计价时段已停售，请重新选择');
          }
          const period = {
            ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          };
          const candidates = await tx.priceRule.findMany({
            where: {
              enabled: true,
              ...(source ? { id: { not: source.id } } : {}),
              ...period,
              AND: {
                OR: [
                  { timeSlotId: command.timeSlotId },
                  ...(source ? [{ code: source.code }] : []),
                ],
              },
            },
          });
          const competing = candidates.find(
            (rule) =>
              (source && rule.code === source.code) ||
              (rule.timeSlotId === command.timeSlotId &&
                (rule.weekdayMask & dto.weekdayMask) !== 0),
          );
          if (competing)
            throw new ConflictException(
              `与“${competing.name}”的适用范围重叠，请从该价格进入修改`,
            );

          const code =
            source?.code ||
            `PRICE_${randomUUID().replaceAll('-', '').toUpperCase()}`;
          const latest = await tx.priceRule.aggregate({
            where: { code },
            _max: { version: true },
          });
          // Keep the old price until the switch date; half-open intervals meet exactly.
          let previousAfter: {
            enabled: boolean;
            effectiveTo: Date | null;
          } | null = null;
          if (source?.enabled) {
            previousAfter =
              effectiveFrom > source.effectiveFrom
                ? { enabled: true, effectiveTo: effectiveFrom }
                : { enabled: false, effectiveTo: source.effectiveTo };
            await tx.priceRule.update({
              where: { id: source.id },
              data: {
                ...previousAfter,
                updatedAt: new Date(
                  Math.max(Date.now(), +source.updatedAt + 1),
                ),
              },
            });
          }
          const created = await tx.priceRule.create({
            data: {
              code,
              version: (latest._max.version ?? 0) + 1,
              name: command.name,
              timeSlotId: command.timeSlotId,
              weekdayMask: dto.weekdayMask,
              priceCents: dto.priceCents,
              newcomerPriceCents: command.newcomerPriceCents,
              effectiveFrom,
              effectiveTo,
              enabled: true,
              creationIdempotencyKey: dto.idempotencyKey,
              creationCommandHash: hash,
              createdById: actor.sub,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: priceRuleAuditRole(actor),
              action: 'PRICE_CHANGE_APPLIED',
              objectType: 'PriceRule',
              objectId: created.id,
              reason: command.reason,
              oldValue: source
                ? (priceRuleView(source) as never)
                : Prisma.JsonNull,
              newValue: {
                price: priceRuleView(created),
                previousRuleId: source?.id ?? null,
                previousAfter,
              } as never,
            },
          });
          return priceRuleView(created);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableMasterDataConflict(error)) throw error;
      const replay = await prisma.priceRule.findUnique({
        where: { creationIdempotencyKey: dto.idempotencyKey },
      });
      if (replay) {
        assertPriceRuleCreationReplay(replay, actor, hash);
        return priceRuleView(replay);
      }
      if (attempt === 3)
        throw new ConflictException('价格正在被修改，请刷新后重试');
    }
  }
  throw new ConflictException('价格修改未完成，请重试');
}
