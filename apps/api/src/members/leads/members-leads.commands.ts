import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  assertLeadProgression,
  LEAD_TERMINAL_STATUSES,
  leadTransitionData,
} from '../../common/leads/lead-state.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  LeadStatus,
  Prisma,
  UserStatus,
} from '../../generated/prisma/client.js';
import type {
  AddLeadFollowUpDto,
  ArchiveLeadDto,
  AssignLeadDto,
  ConvertLeadDto,
  CreateLeadDto,
  LeadQueryDto,
  LeadOwnerQueryDto,
  LoseLeadDto,
} from '../members.dto.js';
import {
  LEAD_WRITE_ROLES,
  LEAD_VIEW_ROLES,
  ACTIVE_TRAINING_STATUSES,
} from '../shared/members-support.js';
import { isCoachOnly, assertAnyRole } from '../shared/members-policy.js';

export async function listLeads(
  prisma: PrismaService,
  query: LeadQueryDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_VIEW_ROLES, '无权查看客户线索');
  const coachOnly = isCoachOnly(actor);
  const conditions: Prisma.CustomerLeadWhereInput[] = [];
  if (query.status) conditions.push({ status: query.status });
  if (query.sourceChannel)
    conditions.push({ sourceChannel: query.sourceChannel });
  if (query.ownerId) conditions.push({ ownerId: query.ownerId });
  if (query.keyword) {
    conditions.push({
      OR: [
        { displayName: { contains: query.keyword, mode: 'insensitive' } },
        ...(coachOnly ? [] : [{ phone: { contains: query.keyword } }]),
        { campaign: { contains: query.keyword, mode: 'insensitive' } },
      ],
    });
  }
  if (query.overdue === 'true') {
    conditions.push({
      slaDueAt: { lt: new Date() },
      status: { notIn: LEAD_TERMINAL_STATUSES },
    });
  } else if (query.overdue === 'false') {
    conditions.push({
      OR: [
        { slaDueAt: { gte: new Date() } },
        { status: { in: LEAD_TERMINAL_STATUSES } },
      ],
    });
  }
  if (coachOnly) {
    conditions.push({
      OR: [
        { ownerId: actor.sub },
        {
          convertedMember: {
            trainingPurchases: {
              some: {
                status: { in: ACTIVE_TRAINING_STATUSES },
                class: {
                  OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
                },
              },
            },
          },
        },
      ],
    });
  }
  const where: Prisma.CustomerLeadWhereInput = conditions.length
    ? { AND: conditions }
    : {};
  const [items, total] = await prisma.$transaction([
    prisma.customerLead.findMany({
      where,
      include: {
        owner: { select: { id: true, displayName: true } },
        referrer: { select: { id: true, displayName: true } },
        convertedMember: { select: { id: true, displayName: true } },
        followUps: {
          select: {
            id: true,
            kind: true,
            content: true,
            statusBefore: true,
            statusAfter: true,
            nextFollowUpAt: true,
            createdAt: true,
            actor: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: [{ nextFollowUpAt: 'asc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.customerLead.count({ where }),
  ]);
  return {
    items: coachOnly
      ? items.map((item) => ({
          ...item,
          phone: item.phone ? '已登记（教练不可见）' : null,
        }))
      : items,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createLead(
  prisma: PrismaService,
  dto: CreateLeadDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权创建客户线索');
  const now = new Date();
  const slaDueAt = dto.slaDueAt
    ? new Date(dto.slaDueAt)
    : new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextFollowUpAt = dto.nextFollowUpAt
    ? new Date(dto.nextFollowUpAt)
    : null;
  if (slaDueAt <= now)
    throw new BadRequestException('SLA 截止时间必须晚于当前时间');
  if (dto.ownerId) await assertAssignableOwner(prisma, dto.ownerId);
  if (dto.referrerId) {
    const referrer = await prisma.user.findUnique({
      where: { id: dto.referrerId },
      select: { id: true },
    });
    if (!referrer) throw new NotFoundException('直接推荐人不存在');
  }
  if (dto.phone) {
    const duplicate = await prisma.customerLead.findFirst({
      where: { phone: dto.phone, status: { notIn: LEAD_TERMINAL_STATUSES } },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('该手机号已有未结束线索');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const lead = await tx.customerLead.create({
        data: {
          displayName: dto.displayName.trim(),
          phone: dto.phone?.trim() || null,
          sourceChannel: dto.sourceChannel,
          campaign: dto.campaign?.trim() || null,
          referrerId: dto.referrerId,
          ownerId: dto.ownerId,
          createdById: actor.sub,
          nextFollowUpAt,
          slaDueAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: auditRole(actor),
          action: 'CUSTOMER_LEAD_CREATED',
          objectType: 'CustomerLead',
          objectId: lead.id,
          newValue: {
            status: lead.status,
            sourceChannel: lead.sourceChannel,
            ownerId: lead.ownerId,
            slaDueAt: lead.slaDueAt.toISOString(),
          } as never,
        },
      });
      return lead;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('该手机号已有未结束线索');
    }
    throw error;
  }
}

export async function claimLead(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权认领客户线索');
  return prisma.$transaction(async (tx) => {
    const lead = await tx.customerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('客户线索不存在');
    if (LEAD_TERMINAL_STATUSES.includes(lead.status))
      throw new ConflictException('终态线索不能认领');
    if (lead.ownerId === actor.sub) return lead;
    if (lead.ownerId) throw new ConflictException('线索已由其他员工认领');
    const changed = await tx.customerLead.updateMany({
      where: { id, ownerId: null, status: lead.status },
      data: { ownerId: actor.sub },
    });
    if (changed.count !== 1)
      throw new ConflictException('线索已被其他员工认领');
    const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } });
    await auditLead(
      tx,
      actor,
      updated.id,
      'CUSTOMER_LEAD_CLAIMED',
      { ownerId: null },
      { ownerId: actor.sub },
    );
    return updated;
  });
}

export async function assignLead(
  prisma: PrismaService,
  id: string,
  dto: AssignLeadDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权分配客户线索');
  await assertAssignableOwner(prisma, dto.ownerId);
  return prisma.$transaction(async (tx) => {
    const lead = await tx.customerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('客户线索不存在');
    if (LEAD_TERMINAL_STATUSES.includes(lead.status))
      throw new ConflictException('终态线索不能重新分配');
    if (lead.ownerId === dto.ownerId) return lead;
    const changed = await tx.customerLead.updateMany({
      where: {
        id,
        status: lead.status,
        ownerId: lead.ownerId,
        updatedAt: lead.updatedAt,
      },
      data: { ownerId: dto.ownerId },
    });
    if (changed.count !== 1)
      throw new ConflictException('线索状态或负责人已变化，请刷新后重试');
    const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } });
    await auditLead(
      tx,
      actor,
      id,
      'CUSTOMER_LEAD_ASSIGNED',
      { ownerId: lead.ownerId },
      { ownerId: dto.ownerId },
    );
    return updated;
  });
}

export async function addLeadFollowUp(
  prisma: PrismaService,
  id: string,
  dto: AddLeadFollowUpDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权追加跟进记录');
  return prisma.$transaction(async (tx) => {
    const lead = await tx.customerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('客户线索不存在');
    if (LEAD_TERMINAL_STATUSES.includes(lead.status))
      throw new ConflictException('终态线索不能继续跟进');
    const nextStatus =
      dto.nextStatus ??
      (lead.status === LeadStatus.NEW ? LeadStatus.CONTACTING : lead.status);
    assertLeadProgression(lead.status, nextStatus);
    const nextFollowUpAt = dto.nextFollowUpAt
      ? new Date(dto.nextFollowUpAt)
      : lead.nextFollowUpAt;
    const changed = await tx.customerLead.updateMany({
      where: { id, status: lead.status },
      data: { ...leadTransitionData(lead.status, nextStatus), nextFollowUpAt },
    });
    if (changed.count !== 1)
      throw new ConflictException('线索状态已变化，请刷新后重试');
    const followUp = await tx.leadFollowUp.create({
      data: {
        leadId: id,
        actorId: actor.sub,
        kind: dto.kind.trim(),
        content: dto.content.trim(),
        statusBefore: lead.status,
        statusAfter: nextStatus,
        nextFollowUpAt,
      },
    });
    await auditLead(
      tx,
      actor,
      id,
      'CUSTOMER_LEAD_FOLLOWED_UP',
      {
        status: lead.status,
        nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
      },
      {
        status: nextStatus,
        nextFollowUpAt: nextFollowUpAt?.toISOString() ?? null,
        followUpId: followUp.id,
      },
    );
    return followUp;
  });
}

export async function convertLead(
  prisma: PrismaService,
  id: string,
  dto: ConvertLeadDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权转换客户线索');
  return prisma.$transaction(async (tx) => {
    const [lead, member] = await Promise.all([
      tx.customerLead.findUnique({ where: { id } }),
      tx.user.findUnique({
        where: { id: dto.memberId },
        select: { id: true, memberProfile: { select: { id: true } } },
      }),
    ]);
    if (!lead) throw new NotFoundException('客户线索不存在');
    if (!member?.memberProfile)
      throw new NotFoundException('转换目标不是有效会员');
    if (
      lead.status === LeadStatus.CONVERTED &&
      lead.convertedMemberId === dto.memberId
    )
      return lead;
    if (LEAD_TERMINAL_STATUSES.includes(lead.status))
      throw new ConflictException('终态线索不能转换');
    const changed = await tx.customerLead.updateMany({
      where: { id, status: lead.status },
      data: leadTransitionData(lead.status, LeadStatus.CONVERTED, {
        convertedMemberId: dto.memberId,
      }),
    });
    if (changed.count !== 1)
      throw new ConflictException('线索状态已变化，请刷新后重试');
    const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } });
    await auditLead(
      tx,
      actor,
      id,
      'CUSTOMER_LEAD_CONVERTED',
      { status: lead.status },
      { status: LeadStatus.CONVERTED, memberId: dto.memberId },
    );
    return updated;
  });
}

export async function loseLead(
  prisma: PrismaService,
  id: string,
  dto: LoseLeadDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权关闭客户线索');
  return prisma.$transaction(async (tx) => {
    const lead = await tx.customerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('客户线索不存在');
    if (lead.status === LeadStatus.LOST && lead.lostReason === dto.reason)
      return lead;
    if (LEAD_TERMINAL_STATUSES.includes(lead.status))
      throw new ConflictException('终态线索不能标记丢失');
    const changed = await tx.customerLead.updateMany({
      where: { id, status: lead.status },
      data: leadTransitionData(lead.status, LeadStatus.LOST, {
        reason: dto.reason,
      }),
    });
    if (changed.count !== 1)
      throw new ConflictException('线索状态已变化，请刷新后重试');
    const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } });
    await auditLead(
      tx,
      actor,
      id,
      'CUSTOMER_LEAD_LOST',
      { status: lead.status },
      { status: LeadStatus.LOST },
      dto.reason,
    );
    return updated;
  });
}

export async function archiveLead(
  prisma: PrismaService,
  id: string,
  dto: ArchiveLeadDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权归档客户线索');
  return prisma.$transaction(async (tx) => {
    const lead = await tx.customerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('客户线索不存在');
    if (lead.status === LeadStatus.ARCHIVED) return lead;
    if (
      !([LeadStatus.CONVERTED, LeadStatus.LOST] as LeadStatus[]).includes(
        lead.status,
      )
    )
      throw new ConflictException('只有已转换或已丢失线索可以归档');
    const updated = await tx.customerLead.update({
      where: { id },
      data: { status: LeadStatus.ARCHIVED, archivedAt: new Date() },
    });
    await auditLead(
      tx,
      actor,
      id,
      'CUSTOMER_LEAD_ARCHIVED',
      { status: lead.status },
      { status: LeadStatus.ARCHIVED },
      dto.reason,
    );
    return updated;
  });
}

export function auditRole(actor: AuthUser) {
  return (
    actor.roles.find((role) => LEAD_WRITE_ROLES.includes(role)) ??
    actor.roles[0]
  );
}

export async function leadOwners(
  prisma: PrismaService,
  query: LeadOwnerQueryDto,
  actor: AuthUser,
) {
  assertAnyRole(actor, LEAD_WRITE_ROLES, '无权分配客户线索');
  const where: Prisma.UserWhereInput = {
    status: UserStatus.ACTIVE,
    deletedAt: null,
    OR: [
      { primaryRole: { in: LEAD_VIEW_ROLES } },
      { roles: { some: { role: { in: LEAD_VIEW_ROLES } } } },
    ],
    ...(query.keyword?.trim()
      ? { displayName: { contains: query.keyword.trim(), mode: 'insensitive' } }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        primaryRole: true,
        roles: { select: { role: true } },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return {
    items: items.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      roles: [
        ...new Set([user.primaryRole, ...user.roles.map((item) => item.role)]),
      ].filter((role) => LEAD_VIEW_ROLES.includes(role)),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function assertAssignableOwner(
  prisma: PrismaService,
  ownerId: string,
) {
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: {
      status: true,
      deletedAt: true,
      primaryRole: true,
      roles: { select: { role: true } },
    },
  });
  const assignable = LEAD_VIEW_ROLES;
  if (
    !owner ||
    owner.status !== UserStatus.ACTIVE ||
    owner.deletedAt ||
    ![owner.primaryRole, ...owner.roles.map(({ role }) => role)].some((role) =>
      assignable.includes(role),
    )
  ) {
    throw new BadRequestException('负责人不存在、已停用或角色不可分配');
  }
}

export async function auditLead(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  leadId: string,
  action: string,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  reason?: string,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: auditRole(actor),
      action,
      objectType: 'CustomerLead',
      objectId: leadId,
      oldValue: oldValue as never,
      newValue: newValue as never,
      reason,
    },
  });
}
