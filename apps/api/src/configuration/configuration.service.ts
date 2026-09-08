import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppRole, ParameterType } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { OPERATING_SHARE_RATE_KEY } from '../common/finance/operating-share.js';
import type {
  CreateParameterDto,
  ParameterQueryDto,
} from './configuration.dto.js';

@Injectable()
export class ConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ParameterQueryDto) {
    const at = query.at ? new Date(query.at) : new Date();
    const rows = await this.prisma.systemParameter.findMany({
      where: {
        key: query.prefix ? { startsWith: query.prefix } : undefined,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ key: 'asc' }, { effectiveFrom: 'desc' }],
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.key)) latest.set(row.key, row);
    return [...latest.values()];
  }

  async resolve(key: string, at = new Date()) {
    const row = await this.prisma.systemParameter.findFirst({
      where: {
        key,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) throw new NotFoundException(`参数 ${key} 在指定时间没有生效版本`);
    return row;
  }

  async createVersion(dto: CreateParameterDto, actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        ([AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role),
      )
    ) {
      throw new ForbiddenException('仅管理员可创建参数版本');
    }
    const effectiveFrom = new Date(dto.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime()))
      throw new BadRequestException('生效时间无效');
    if (dto.key === 'training.contract_rate_bps' && dto.value !== 2_000) {
      throw new BadRequestException(
        '培训计入场馆合同收入比例按需求锁定为20%（2000基点）',
      );
    }
    if (dto.key === 'training.venue_fee_cents' && dto.value !== 0) {
      throw new BadRequestException('培训不得另收场地费，该参数必须为0');
    }
    if (
      dto.key === OPERATING_SHARE_RATE_KEY &&
      (dto.type !== ParameterType.INTEGER ||
        typeof dto.value !== 'number' ||
        !Number.isSafeInteger(dto.value) ||
        dto.value < 0 ||
        dto.value > 10_000)
    ) {
      throw new BadRequestException(
        '经营分成比例必须使用 INTEGER 类型，并填写 0-10000 的整数基点',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // READ COMMITTED sees the previous writer after this per-key lock.
          // The lock also serializes creation when the key has no rows yet.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.key}, 731))`;
          const existing = await tx.systemParameter.findFirst({
            where: { key: dto.key },
            orderBy: { effectiveFrom: 'desc' },
          });
          const locked = dto.locked || dto.key.startsWith('training.');
          const sameVersion = await tx.systemParameter.findUnique({
            where: { key_effectiveFrom: { key: dto.key, effectiveFrom } },
          });
          if (sameVersion) {
            const sameCommand =
              JSON.stringify(sameVersion.value) === JSON.stringify(dto.value) &&
              sameVersion.type === dto.type &&
              sameVersion.description === dto.description &&
              sameVersion.locked === locked;
            if (sameCommand) return sameVersion;
            throw new ConflictException('同一参数与生效时间已被其他命令占用');
          }
          if (existing?.locked && !actor.roles.includes(AppRole.SUPER_ADMIN)) {
            throw new ConflictException('锁定参数仅超级管理员可变更');
          }
          if (existing && effectiveFrom <= existing.effectiveFrom) {
            throw new ConflictException('新版本生效时间必须晚于上一版本');
          }

          if (existing && !existing.effectiveTo) {
            await tx.systemParameter.update({
              where: { id: existing.id },
              data: { effectiveTo: effectiveFrom },
            });
          }
          const created = await tx.systemParameter.create({
            data: {
              key: dto.key,
              value: dto.value as never,
              type: dto.type,
              description: dto.description,
              locked,
              effectiveFrom,
              createdById: actor.sub,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'PARAMETER_VERSION_CREATED',
              objectType: 'SystemParameter',
              objectId: created.id,
              oldValue: existing
                ? ({ id: existing.id, value: existing.value } as never)
                : undefined,
              newValue: {
                key: dto.key,
                value: dto.value,
                effectiveFrom: dto.effectiveFrom,
              } as never,
              reason: dto.reason.trim(),
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException('参数版本刚刚发生变化，请刷新后重试');
      }
      throw error;
    }
  }
}
