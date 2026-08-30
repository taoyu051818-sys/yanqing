import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { validateDirectReferral } from '@yanqing/shared'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  AccountAdjustmentStatus,
  AccountTxnKind,
  AppRole,
  BusinessType,
  LeadStatus,
  OrderStatus,
  Prisma,
  SourceChannel,
  TrainingEnrollmentStatus,
  UserStatus,
} from '../generated/prisma/client.js'
import type {
  AddLeadFollowUpDto,
  AccountAdjustmentQueryDto,
  AdjustAccountDto,
  ArchiveLeadDto,
  AssignLeadDto,
  BindReferralDto,
  ConvertLeadDto,
  CreateLeadDto,
  LeadFunnelQueryDto,
  LeadQueryDto,
  LoseLeadDto,
  MemberQueryDto,
  ReviewAccountAdjustmentDto,
} from './members.dto.js'

const LEAD_TERMINAL_STATUSES: LeadStatus[] = [LeadStatus.CONVERTED, LeadStatus.LOST, LeadStatus.ARCHIVED]
const LEAD_WRITE_ROLES: AppRole[] = [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]
const LEAD_VIEW_ROLES: AppRole[] = [...LEAD_WRITE_ROLES, AppRole.COACH]
const ACTIVE_TRAINING_STATUSES: TrainingEnrollmentStatus[] = [
  TrainingEnrollmentStatus.ACTIVE,
  TrainingEnrollmentStatus.COMPLETED,
  TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
]
const FUNNEL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
]

type FunnelBucket = {
  sourceChannel: SourceChannel
  campaign: string | null
  leads: number
  contacted: number
  trialReserved: number
  attended: number
  converted: number
  lost: number
  registeredMembers: number
  firstVisits: number
  payingMemberIds: Set<string>
  paidOrders: number
  netGmvCents: number
  trainingMemberIds: Set<string>
  trainingNetGmvCents: number
}

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: MemberQueryDto, actor?: AuthUser) {
    const coachOnly = Boolean(actor?.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) => [AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never)))
    const activeTrainingStatuses: TrainingEnrollmentStatus[] = [
      TrainingEnrollmentStatus.ACTIVE,
      TrainingEnrollmentStatus.COMPLETED,
      TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
    ]
    const conditions: Prisma.UserWhereInput[] = [
      { memberProfile: query.level ? { level: query.level } : { isNot: null } },
    ]
    if (query.keyword) {
      conditions.push({
        OR: [
          { displayName: { contains: query.keyword, mode: 'insensitive' } },
          // A coach may search by name only.  Keeping phone out of the coach
          // predicate prevents an otherwise hidden PII field from becoming a
          // side-channel for discovering unrelated members.
          ...(coachOnly ? [] : [{ phone: { contains: query.keyword } }]),
        ],
      })
    }
    if (coachOnly && actor) {
      conditions.push({
        OR: [
          {
            trainingPurchases: {
              some: {
                status: { in: activeTrainingStatuses },
                class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
              },
            },
          },
          {
            guardianStudents: {
              some: {
                enrollments: {
                  some: {
                    status: { in: activeTrainingStatuses },
                    class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
                  },
                },
              },
            },
          },
        ],
      })
    }
    const where: Prisma.UserWhereInput = conditions.length === 1 ? conditions[0] : { AND: conditions }

    const coachSelect: Prisma.UserSelect = {
      id: true,
      displayName: true,
      avatarUrl: true,
      memberProfile: { select: { level: true, tags: true, lastVisitAt: true } },
      trainingPurchases: {
        where: {
          status: { in: activeTrainingStatuses },
          class: { OR: [{ coachId: actor?.sub ?? '' }, { assistantId: actor?.sub ?? '' }] },
        },
        select: {
          id: true,
          enrollmentNo: true,
          status: true,
          totalSessions: true,
          consumedSessions: true,
          class: { select: { id: true, name: true } },
          student: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' as const },
      },
      guardianStudents: {
        select: {
          id: true,
          displayName: true,
          guardianConsentStatus: true,
          enrollments: {
            where: {
              status: { in: activeTrainingStatuses },
              class: { OR: [{ coachId: actor?.sub ?? '' }, { assistantId: actor?.sub ?? '' }] },
            },
            select: {
              id: true,
              enrollmentNo: true,
              status: true,
              totalSessions: true,
              consumedSessions: true,
              class: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' as const },
          },
        },
      },
    }

    const [items, total] = await this.prisma.$transaction([
      coachOnly
        ? this.prisma.user.findMany({
            where,
            select: coachSelect,
            orderBy: { createdAt: 'desc' },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          })
        : this.prisma.user.findMany({
            where,
            include: { memberProfile: true, accounts: { orderBy: { type: 'asc' } } },
            orderBy: { createdAt: 'desc' },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
      this.prisma.user.count({ where }),
    ])
    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  async listLeads(query: LeadQueryDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_VIEW_ROLES, '无权查看客户线索')
    const coachOnly = this.isCoachOnly(actor)
    const conditions: Prisma.CustomerLeadWhereInput[] = []
    if (query.status) conditions.push({ status: query.status })
    if (query.sourceChannel) conditions.push({ sourceChannel: query.sourceChannel })
    if (query.ownerId) conditions.push({ ownerId: query.ownerId })
    if (query.keyword) {
      conditions.push({
        OR: [
          { displayName: { contains: query.keyword, mode: 'insensitive' } },
          ...(coachOnly ? [] : [{ phone: { contains: query.keyword } }]),
          { campaign: { contains: query.keyword, mode: 'insensitive' } },
        ],
      })
    }
    if (query.overdue === 'true') {
      conditions.push({ slaDueAt: { lt: new Date() }, status: { notIn: LEAD_TERMINAL_STATUSES } })
    } else if (query.overdue === 'false') {
      conditions.push({ OR: [{ slaDueAt: { gte: new Date() } }, { status: { in: LEAD_TERMINAL_STATUSES } }] })
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
                  class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
                },
              },
            },
          },
        ],
      })
    }
    const where: Prisma.CustomerLeadWhereInput = conditions.length ? { AND: conditions } : {}
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerLead.findMany({
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
      this.prisma.customerLead.count({ where }),
    ])
    return {
      items: coachOnly ? items.map((item) => ({ ...item, phone: item.phone ? '已登记（教练不可见）' : null })) : items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  async leadFunnel(query: LeadFunnelQueryDto) {
    const periodEnd = query.to ? new Date(query.to) : new Date()
    const periodStart = query.from
      ? new Date(query.from)
      : new Date(periodEnd.getTime() - 30 * 86_400_000)
    if (
      !Number.isFinite(periodStart.getTime()) ||
      !Number.isFinite(periodEnd.getTime()) ||
      periodEnd <= periodStart
    ) {
      throw new BadRequestException('渠道漏斗统计周期无效')
    }
    if (periodEnd.getTime() - periodStart.getTime() > 366 * 86_400_000) {
      throw new BadRequestException('渠道漏斗单次统计范围不能超过366天')
    }

    const [members, orders] = await Promise.all([
      this.prisma.memberProfile.findMany({
        where: {
          OR: [
            { createdAt: { gte: periodStart, lt: periodEnd } },
            { firstVisitAt: { gte: periodStart, lt: periodEnd } },
          ],
        },
        select: {
          userId: true,
          sourceChannel: true,
          createdAt: true,
          firstVisitAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: {
          status: { in: FUNNEL_ORDER_STATUSES },
          paidAt: { gte: periodStart, lt: periodEnd },
        },
        select: {
          memberId: true,
          sourceChannel: true,
          businessType: true,
          paidCents: true,
          refundedCents: true,
        },
      }),
    ])
    const attributedMemberIds = [...new Set(orders.map((order) => order.memberId))]
    const leads = await this.prisma.customerLead.findMany({
      where: {
        OR: [
          { createdAt: { gte: periodStart, lt: periodEnd } },
          ...(attributedMemberIds.length
            ? [{ convertedMemberId: { in: attributedMemberIds } }]
            : []),
        ],
      },
      select: {
        sourceChannel: true,
        campaign: true,
        status: true,
        convertedMemberId: true,
        createdAt: true,
        convertedAt: true,
        followUps: { select: { statusAfter: true } },
      },
      orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }],
    })

    const buckets = new Map<string, FunnelBucket>()
    const bucket = (sourceChannel: SourceChannel, campaign: string | null = null) => {
      const key = `${sourceChannel}\u0000${campaign ?? ''}`
      const existing = buckets.get(key)
      if (existing) return existing
      const created: FunnelBucket = {
        sourceChannel,
        campaign,
        leads: 0,
        contacted: 0,
        trialReserved: 0,
        attended: 0,
        converted: 0,
        lost: 0,
        registeredMembers: 0,
        firstVisits: 0,
        payingMemberIds: new Set(),
        paidOrders: 0,
        netGmvCents: 0,
        trainingMemberIds: new Set(),
        trainingNetGmvCents: 0,
      }
      buckets.set(key, created)
      return created
    }
    const inPeriod = (value: Date | null) => Boolean(
      value && value >= periodStart && value < periodEnd,
    )
    const convertedAttribution = new Map<string, { sourceChannel: SourceChannel; campaign: string | null }>()
    for (const lead of leads) {
      if (lead.convertedMemberId && !convertedAttribution.has(lead.convertedMemberId)) {
        convertedAttribution.set(lead.convertedMemberId, {
          sourceChannel: lead.sourceChannel,
          campaign: lead.campaign,
        })
      }
      if (!inPeriod(lead.createdAt)) continue
      const leadTargets = [bucket(lead.sourceChannel)]
      if (lead.campaign) leadTargets.push(bucket(lead.sourceChannel, lead.campaign))
      const observedStatuses = new Set<LeadStatus>([
        lead.status,
        ...lead.followUps.map((item) => item.statusAfter),
      ])
      if (lead.status === LeadStatus.CONVERTED) {
        observedStatuses.add(LeadStatus.CONTACTING)
        observedStatuses.add(LeadStatus.TRIAL_RESERVED)
        observedStatuses.add(LeadStatus.ATTENDED)
      } else if (lead.status === LeadStatus.ATTENDED) {
        observedStatuses.add(LeadStatus.CONTACTING)
        observedStatuses.add(LeadStatus.TRIAL_RESERVED)
      } else if (lead.status === LeadStatus.TRIAL_RESERVED) {
        observedStatuses.add(LeadStatus.CONTACTING)
      }
      for (const target of leadTargets) {
        target.leads += 1
        if (observedStatuses.has(LeadStatus.CONTACTING)) target.contacted += 1
        if (observedStatuses.has(LeadStatus.TRIAL_RESERVED)) target.trialReserved += 1
        if (observedStatuses.has(LeadStatus.ATTENDED)) target.attended += 1
        if (lead.status === LeadStatus.CONVERTED) target.converted += 1
        if (lead.status === LeadStatus.LOST) target.lost += 1
      }
    }
    for (const member of members) {
      const attribution = convertedAttribution.get(member.userId) ?? {
        sourceChannel: member.sourceChannel,
        campaign: null,
      }
      const targets = [bucket(attribution.sourceChannel)]
      if (attribution.campaign) targets.push(bucket(attribution.sourceChannel, attribution.campaign))
      for (const target of targets) {
        if (inPeriod(member.createdAt)) target.registeredMembers += 1
        if (inPeriod(member.firstVisitAt)) target.firstVisits += 1
      }
    }
    for (const order of orders) {
      const attribution = convertedAttribution.get(order.memberId) ?? {
        sourceChannel: order.sourceChannel,
        campaign: null,
      }
      const netAmount = Math.max(0, order.paidCents - order.refundedCents)
      const targets = [bucket(attribution.sourceChannel)]
      if (attribution.campaign) targets.push(bucket(attribution.sourceChannel, attribution.campaign))
      for (const target of targets) {
        target.payingMemberIds.add(order.memberId)
        target.paidOrders += 1
        target.netGmvCents += netAmount
        if (order.businessType === BusinessType.TRAINING) {
          target.trainingMemberIds.add(order.memberId)
          target.trainingNetGmvCents += netAmount
        }
      }
    }

    const view = (item: FunnelBucket) => ({
      sourceChannel: item.sourceChannel,
      ...(item.campaign === null ? {} : { campaign: item.campaign || '未标记活动' }),
      leads: item.leads,
      contacted: item.contacted,
      trialReserved: item.trialReserved,
      attended: item.attended,
      converted: item.converted,
      lost: item.lost,
      registeredMembers: item.registeredMembers,
      firstVisits: item.firstVisits,
      payingCustomers: item.payingMemberIds.size,
      paidOrders: item.paidOrders,
      netGmvCents: item.netGmvCents,
      trainingCustomers: item.trainingMemberIds.size,
      trainingNetGmvCents: item.trainingNetGmvCents,
      leadToVisitRate: item.leads ? Math.round((item.firstVisits / item.leads) * 10_000) / 100 : 0,
      leadToPaidRate: item.leads ? Math.round((item.payingMemberIds.size / item.leads) * 10_000) / 100 : 0,
      leadToTrainingRate: item.leads ? Math.round((item.trainingMemberIds.size / item.leads) * 10_000) / 100 : 0,
    })
    const values = [...buckets.values()]
    return {
      period: { start: periodStart, end: periodEnd },
      privacy: 'AGGREGATED_NO_PII',
      sources: values
        .filter((item) => item.campaign === null)
        .map(view)
        .sort((left, right) => right.netGmvCents - left.netGmvCents),
      campaigns: values
        .filter((item) => item.campaign !== null)
        .map(view)
        .sort((left, right) => right.netGmvCents - left.netGmvCents),
    }
  }

  async createLead(dto: CreateLeadDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权创建客户线索')
    const now = new Date()
    const slaDueAt = dto.slaDueAt ? new Date(dto.slaDueAt) : new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null
    if (slaDueAt <= now) throw new BadRequestException('SLA 截止时间必须晚于当前时间')
    if (dto.ownerId) await this.assertAssignableOwner(dto.ownerId)
    if (dto.referrerId) {
      const referrer = await this.prisma.user.findUnique({ where: { id: dto.referrerId }, select: { id: true } })
      if (!referrer) throw new NotFoundException('直接推荐人不存在')
    }
    if (dto.phone) {
      const duplicate = await this.prisma.customerLead.findFirst({
        where: { phone: dto.phone, status: { notIn: LEAD_TERMINAL_STATUSES } },
        select: { id: true },
      })
      if (duplicate) throw new ConflictException('该手机号已有未结束线索')
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: this.auditRole(actor),
            action: 'CUSTOMER_LEAD_CREATED',
            objectType: 'CustomerLead',
            objectId: lead.id,
            newValue: { status: lead.status, sourceChannel: lead.sourceChannel, ownerId: lead.ownerId, slaDueAt: lead.slaDueAt.toISOString() } as never,
          },
        })
        return lead
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该手机号已有未结束线索')
      }
      throw error
    }
  }

  async claimLead(id: string, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权认领客户线索')
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.customerLead.findUnique({ where: { id } })
      if (!lead) throw new NotFoundException('客户线索不存在')
      if (LEAD_TERMINAL_STATUSES.includes(lead.status)) throw new ConflictException('终态线索不能认领')
      if (lead.ownerId === actor.sub) return lead
      if (lead.ownerId) throw new ConflictException('线索已由其他员工认领')
      const changed = await tx.customerLead.updateMany({ where: { id, ownerId: null, status: lead.status }, data: { ownerId: actor.sub } })
      if (changed.count !== 1) throw new ConflictException('线索已被其他员工认领')
      const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } })
      await this.auditLead(tx, actor, updated.id, 'CUSTOMER_LEAD_CLAIMED', { ownerId: null }, { ownerId: actor.sub })
      return updated
    })
  }

  async assignLead(id: string, dto: AssignLeadDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权分配客户线索')
    await this.assertAssignableOwner(dto.ownerId)
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.customerLead.findUnique({ where: { id } })
      if (!lead) throw new NotFoundException('客户线索不存在')
      if (LEAD_TERMINAL_STATUSES.includes(lead.status)) throw new ConflictException('终态线索不能重新分配')
      if (lead.ownerId === dto.ownerId) return lead
      const updated = await tx.customerLead.update({ where: { id }, data: { ownerId: dto.ownerId } })
      await this.auditLead(tx, actor, id, 'CUSTOMER_LEAD_ASSIGNED', { ownerId: lead.ownerId }, { ownerId: dto.ownerId })
      return updated
    })
  }

  async addLeadFollowUp(id: string, dto: AddLeadFollowUpDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权追加跟进记录')
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.customerLead.findUnique({ where: { id } })
      if (!lead) throw new NotFoundException('客户线索不存在')
      if (LEAD_TERMINAL_STATUSES.includes(lead.status)) throw new ConflictException('终态线索不能继续跟进')
      const nextStatus = dto.nextStatus ?? (lead.status === LeadStatus.NEW ? LeadStatus.CONTACTING : lead.status)
      this.assertFollowUpTransition(lead.status, nextStatus)
      const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : lead.nextFollowUpAt
      const changed = await tx.customerLead.updateMany({
        where: { id, status: lead.status },
        data: { status: nextStatus, nextFollowUpAt },
      })
      if (changed.count !== 1) throw new ConflictException('线索状态已变化，请刷新后重试')
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
      })
      await this.auditLead(tx, actor, id, 'CUSTOMER_LEAD_FOLLOWED_UP',
        { status: lead.status, nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null },
        { status: nextStatus, nextFollowUpAt: nextFollowUpAt?.toISOString() ?? null, followUpId: followUp.id },
      )
      return followUp
    })
  }

  async convertLead(id: string, dto: ConvertLeadDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权转换客户线索')
    return this.prisma.$transaction(async (tx) => {
      const [lead, member] = await Promise.all([
        tx.customerLead.findUnique({ where: { id } }),
        tx.user.findUnique({ where: { id: dto.memberId }, select: { id: true, memberProfile: { select: { id: true } } } }),
      ])
      if (!lead) throw new NotFoundException('客户线索不存在')
      if (!member?.memberProfile) throw new NotFoundException('转换目标不是有效会员')
      if (lead.status === LeadStatus.CONVERTED && lead.convertedMemberId === dto.memberId) return lead
      if (LEAD_TERMINAL_STATUSES.includes(lead.status)) throw new ConflictException('终态线索不能转换')
      const convertedAt = new Date()
      const changed = await tx.customerLead.updateMany({
        where: { id, status: lead.status },
        data: { status: LeadStatus.CONVERTED, convertedMemberId: dto.memberId, convertedAt, nextFollowUpAt: null },
      })
      if (changed.count !== 1) throw new ConflictException('线索状态已变化，请刷新后重试')
      const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } })
      await this.auditLead(tx, actor, id, 'CUSTOMER_LEAD_CONVERTED', { status: lead.status }, { status: LeadStatus.CONVERTED, memberId: dto.memberId })
      return updated
    })
  }

  async loseLead(id: string, dto: LoseLeadDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权关闭客户线索')
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.customerLead.findUnique({ where: { id } })
      if (!lead) throw new NotFoundException('客户线索不存在')
      if (lead.status === LeadStatus.LOST && lead.lostReason === dto.reason) return lead
      if (LEAD_TERMINAL_STATUSES.includes(lead.status)) throw new ConflictException('终态线索不能标记丢失')
      const changed = await tx.customerLead.updateMany({
        where: { id, status: lead.status },
        data: { status: LeadStatus.LOST, lostReason: dto.reason.trim(), lostAt: new Date(), nextFollowUpAt: null },
      })
      if (changed.count !== 1) throw new ConflictException('线索状态已变化，请刷新后重试')
      const updated = await tx.customerLead.findUniqueOrThrow({ where: { id } })
      await this.auditLead(tx, actor, id, 'CUSTOMER_LEAD_LOST', { status: lead.status }, { status: LeadStatus.LOST }, dto.reason)
      return updated
    })
  }

  async archiveLead(id: string, dto: ArchiveLeadDto, actor: AuthUser) {
    this.assertAnyRole(actor, LEAD_WRITE_ROLES, '无权归档客户线索')
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.customerLead.findUnique({ where: { id } })
      if (!lead) throw new NotFoundException('客户线索不存在')
      if (lead.status === LeadStatus.ARCHIVED) return lead
      if (!([LeadStatus.CONVERTED, LeadStatus.LOST] as LeadStatus[]).includes(lead.status)) throw new ConflictException('只有已转换或已丢失线索可以归档')
      const updated = await tx.customerLead.update({ where: { id }, data: { status: LeadStatus.ARCHIVED, archivedAt: new Date() } })
      await this.auditLead(tx, actor, id, 'CUSTOMER_LEAD_ARCHIVED', { status: lead.status }, { status: LeadStatus.ARCHIVED }, dto.reason)
      return updated
    })
  }

  async customer360(userId: string, actor: AuthUser) {
    const coachOnly = this.isCoachOnly(actor)
    if (coachOnly) {
      const assigned = await this.prisma.trainingEnrollment.findFirst({
        where: {
          status: { in: ACTIVE_TRAINING_STATUSES },
          class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
          OR: [{ buyerId: userId }, { student: { guardianId: userId } }],
        },
        select: { id: true },
      })
      if (!assigned) throw new NotFoundException('会员不在当前教练负责的班级中')
      const member = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          memberProfile: { select: { level: true, tags: true, lastVisitAt: true, visitCount: true } },
          trainingPurchases: {
            where: { status: { in: ACTIVE_TRAINING_STATUSES }, class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] } },
            select: {
              id: true, enrollmentNo: true, status: true, totalSessions: true, consumedSessions: true, expiresAt: true,
              product: { select: { id: true, name: true } }, class: { select: { id: true, name: true } },
              student: { select: { id: true, displayName: true } },
            },
            orderBy: { createdAt: 'desc' }, take: 10,
          },
        },
      })
      if (!member) throw new NotFoundException('会员不存在')
      return {
        member: { id: member.id, displayName: member.displayName, avatarUrl: member.avatarUrl, phone: null, memberProfile: member.memberProfile },
        accounts: [], recentOrders: [], recentTraining: member.trainingPurchases,
        recentGames: [], recentEvents: [], recentCoupons: [], financialsRedacted: true,
      }
    }

    this.assertAnyRole(actor, [AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN], '无权查看会员全景')
    const member = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, displayName: true, avatarUrl: true, phone: true, status: true, createdAt: true,
        memberProfile: true,
        referrer: { select: { id: true, displayName: true } },
        accounts: { select: { id: true, type: true, balance: true, frozenBalance: true, updatedAt: true }, orderBy: { type: 'asc' } },
        memberOrders: {
          select: { id: true, orderNo: true, businessType: true, status: true, title: true, payableCents: true, paidCents: true, refundedCents: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 10,
        },
        trainingPurchases: {
          select: {
            id: true, enrollmentNo: true, status: true, totalSessions: true, consumedSessions: true,
            prepaidBalanceCents: true, confirmedRevenueCents: true, refundedCents: true, expiresAt: true,
            product: { select: { id: true, name: true } }, class: { select: { id: true, name: true } },
            student: { select: { id: true, displayName: true } },
          }, orderBy: { createdAt: 'desc' }, take: 10,
        },
        gameRegistrations: {
          select: { id: true, status: true, checkedInAt: true, createdAt: true, game: { select: { id: true, code: true, title: true, startsAt: true, status: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        },
        eventCaptains: {
          select: { id: true, name: true, status: true, finalRank: true, eventPointsAwarded: true, createdAt: true, event: { select: { id: true, code: true, name: true, startsAt: true, status: true } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        },
        couponHoldings: {
          select: { id: true, code: true, status: true, claimedAt: true, redeemedAt: true, expiresAt: true, template: { select: { id: true, name: true, benefitDescription: true, merchant: { select: { id: true, name: true } } } } },
          orderBy: { createdAt: 'desc' }, take: 10,
        },
      },
    })
    if (!member) throw new NotFoundException('会员不存在')
    const { accounts, memberOrders, trainingPurchases, gameRegistrations, eventCaptains, couponHoldings, ...basic } = member
    return {
      member: basic,
      accounts,
      recentOrders: memberOrders,
      recentTraining: trainingPurchases,
      recentGames: gameRegistrations,
      recentEvents: eventCaptains,
      recentCoupons: couponHoldings,
      financialsRedacted: false,
    }
  }

  async profile(userId: string, actor: AuthUser) {
    const privileged = actor.roles.some((role) =>
      ([AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role),
    )

    // Coaches are deliberately scoped to their own classes. The old route
    // accepted any member id, which exposed unrelated phone/account data to a
    // coach who guessed an id. Check the assignment before loading the
    // profile, and return only the teaching context needed for the class.
    if (!privileged && actor.roles.includes(AppRole.COACH)) {
      const assigned = await this.prisma.trainingEnrollment.findFirst({
        where: {
          status: {
            in: [
              TrainingEnrollmentStatus.ACTIVE,
              TrainingEnrollmentStatus.COMPLETED,
              TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
            ],
          },
          class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
          OR: [
            { buyerId: userId },
            { student: { guardianId: userId } },
          ],
        },
        select: { id: true },
      })
      if (!assigned) throw new NotFoundException('会员不在当前教练负责的班级中')

      return this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          memberProfile: {
            select: { level: true, tags: true, lastVisitAt: true },
          },
          trainingPurchases: {
            where: {
              status: {
                in: [
                  TrainingEnrollmentStatus.ACTIVE,
                  TrainingEnrollmentStatus.COMPLETED,
                  TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
                ],
              },
              class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
            },
            select: {
              id: true,
              enrollmentNo: true,
              status: true,
              totalSessions: true,
              consumedSessions: true,
              class: { select: { id: true, name: true } },
              student: { select: { id: true, displayName: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          guardianStudents: {
            select: {
              id: true,
              displayName: true,
              guardianConsentStatus: true,
              enrollments: {
                where: {
                  status: {
                    in: [
                      TrainingEnrollmentStatus.ACTIVE,
                      TrainingEnrollmentStatus.COMPLETED,
                      TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
                    ],
                  },
                  class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
                },
                select: {
                  id: true,
                  enrollmentNo: true,
                  status: true,
                  totalSessions: true,
                  consumedSessions: true,
                  class: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      })
    }

    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberProfile: true,
        accounts: { orderBy: { type: 'asc' } },
        guardianStudents: true,
        referrer: { select: { id: true, displayName: true } },
      },
    })
  }

  accountTransactions(userId: string) {
    return this.prisma.accountTransaction.findMany({
      where: { account: { userId } },
      include: { account: { select: { type: true } }, operator: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  accountAdjustmentRequests(query: AccountAdjustmentQueryDto, actor: AuthUser) {
    this.assertAnyRole(actor, [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN], '无权查看账户调整申请')
    return this.prisma.accountAdjustmentRequest.findMany({
      where: query.status ? { status: query.status } : undefined,
      include: {
        account: { include: { user: { select: { id: true, displayName: true, phone: true } } } },
        requestedBy: { select: { id: true, displayName: true } },
        reviewedBy: { select: { id: true, displayName: true } },
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  async adjustAccount(userId: string, dto: AdjustAccountDto, actor: AuthUser) {
    this.assertAnyRole(actor, [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN], '无权提交账户调整申请')
    if (dto.amount === 0) throw new BadRequestException('调整金额不能为 0')
    const reason = dto.reason.trim()
    if (reason.length < 2) throw new BadRequestException('调整原因至少需要2个字符')
    const requestKey = dto.idempotencyKey.trim()
    if (requestKey.length < 8 || requestKey.length > 100) {
      throw new BadRequestException('幂等键长度必须为8-100个字符')
    }
    const account = await this.prisma.account.findUnique({
      where: { userId_type: { userId, type: dto.accountType } },
    })
    if (!account) throw new NotFoundException('账户不存在')
    const commandHash = createHash('sha256')
      .update(JSON.stringify({ version: 1, userId, accountType: dto.accountType, amount: dto.amount, reason }))
      .digest('hex')
    const replay = async () => {
      const existing = await this.prisma.accountAdjustmentRequest.findUnique({
        where: { requestIdempotencyKey: requestKey },
      })
      if (!existing) return null
      if (existing.requestedById !== actor.sub || existing.accountId !== account.id || existing.commandHash !== commandHash) {
        throw new ConflictException('幂等键已用于不同的账户调整申请')
      }
      return existing
    }
    const duplicate = await replay()
    if (duplicate) return duplicate

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const duplicateInTransaction = await tx.accountAdjustmentRequest.findUnique({
            where: { requestIdempotencyKey: requestKey },
          })
          if (duplicateInTransaction) {
            if (duplicateInTransaction.requestedById !== actor.sub || duplicateInTransaction.accountId !== account.id || duplicateInTransaction.commandHash !== commandHash) {
              throw new ConflictException('幂等键已用于不同的账户调整申请')
            }
            return duplicateInTransaction
          }
          const request = await tx.accountAdjustmentRequest.create({
            data: {
              accountId: account.id,
              amount: dto.amount,
              reason,
              requestedById: actor.sub,
              requestIdempotencyKey: requestKey,
              commandHash,
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'ACCOUNT_ADJUSTMENT_REQUESTED',
              objectType: 'AccountAdjustmentRequest',
              objectId: request.id,
              newValue: { accountId: account.id, accountType: account.type, amount: dto.amount } as never,
              reason,
            },
          })
          return request
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : null
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        JSON.stringify(target).includes('requestIdempotencyKey')
      ) {
        const concurrent = await replay()
        if (concurrent) return concurrent
      }
      throw error
    }
  }

  async approveAccountAdjustment(requestId: string, dto: ReviewAccountAdjustmentDto, actor: AuthUser) {
    this.assertAnyRole(actor, [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN], '无权复核账户调整申请')
    const reviewReason = dto.reason.trim()
    if (reviewReason.length < 2) throw new BadRequestException('复核原因至少需要2个字符')
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.accountAdjustmentRequest.findUnique({
          where: { id: requestId },
          include: { account: true, transaction: true },
        })
        if (!request) throw new NotFoundException('账户调整申请不存在')
        if (request.status === AccountAdjustmentStatus.POSTED) return request
        if (request.status === AccountAdjustmentStatus.REJECTED) {
          throw new ConflictException('已驳回的账户调整不能入账')
        }
        if (request.requestedById === actor.sub) {
          throw new ForbiddenException('账户调整申请人与复核人不能是同一账号')
        }
        const balanceAfter = request.account.balance + request.amount
        if (balanceAfter < 0) throw new BadRequestException('账户余额不足')
        const changed = await tx.account.updateMany({
          where: { id: request.account.id, version: request.account.version },
          data: { balance: balanceAfter, version: { increment: 1 } },
        })
        if (changed.count !== 1) throw new ConflictException('账户已被其他操作更新，请重试')
        const transaction = await tx.accountTransaction.create({
          data: {
            accountId: request.account.id,
            kind: request.amount > 0 ? AccountTxnKind.CREDIT : AccountTxnKind.DEBIT,
            amount: request.amount,
            balanceBefore: request.account.balance,
            balanceAfter,
            reasonCode: 'MANUAL_ADJUSTMENT',
            reason: request.reason,
            operatorId: actor.sub,
            idempotencyKey: `ACCOUNT_ADJUSTMENT:${request.id}`,
            metadata: { requestId: request.id, reviewReason },
          },
        })
        const posted = await tx.accountAdjustmentRequest.update({
          where: { id: request.id },
          data: {
            status: AccountAdjustmentStatus.POSTED,
            reviewedById: actor.sub,
            reviewedAt: new Date(),
            reviewReason,
            transactionId: transaction.id,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ACCOUNT_ADJUSTMENT_POSTED',
            objectType: 'AccountAdjustmentRequest',
            objectId: request.id,
            oldValue: { status: request.status, balance: request.account.balance } as never,
            newValue: { status: posted.status, balance: balanceAfter, delta: request.amount, transactionId: transaction.id } as never,
            reason: reviewReason,
          },
        })
        return { ...posted, transaction }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async rejectAccountAdjustment(requestId: string, dto: ReviewAccountAdjustmentDto, actor: AuthUser) {
    this.assertAnyRole(actor, [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN], '无权复核账户调整申请')
    const reviewReason = dto.reason.trim()
    if (reviewReason.length < 2) throw new BadRequestException('驳回原因至少需要2个字符')
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.accountAdjustmentRequest.findUnique({ where: { id: requestId } })
      if (!request) throw new NotFoundException('账户调整申请不存在')
      if (request.status === AccountAdjustmentStatus.REJECTED) return request
      if (request.status === AccountAdjustmentStatus.POSTED) {
        throw new ConflictException('已入账的账户调整不能驳回；请提交反向调整申请')
      }
      if (request.requestedById === actor.sub) {
        throw new ForbiddenException('账户调整申请人与复核人不能是同一账号')
      }
      const rejected = await tx.accountAdjustmentRequest.update({
        where: { id: request.id },
        data: {
          status: AccountAdjustmentStatus.REJECTED,
          reviewedById: actor.sub,
          reviewedAt: new Date(),
          reviewReason,
        },
      })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'ACCOUNT_ADJUSTMENT_REJECTED',
          objectType: 'AccountAdjustmentRequest',
          objectId: request.id,
          oldValue: { status: request.status } as never,
          newValue: { status: rejected.status } as never,
          reason: reviewReason,
        }
      })
      return rejected
    })
  }

  async bindReferral(dto: BindReferralDto, actor: AuthUser) {
    const userId = actor.sub
    // Binding is an immutable, single-write relationship.  Perform the
    // validation and conditional update in one serializable transaction so
    // two first-login requests cannot race and silently choose different
    // direct referrers.  Repeating the same binding remains idempotent.
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [user, referrer] = await Promise.all([
            tx.user.findUnique({
              where: { id: userId },
              select: {
                id: true,
                referrerId: true,
                status: true,
                deletedAt: true,
                memberProfile: { select: { id: true } },
              },
            }),
            tx.user.findUnique({
              where: { id: dto.referrerId },
              select: {
                id: true,
                referrerId: true,
                status: true,
                deletedAt: true,
                memberProfile: { select: { id: true } },
              },
            }),
          ])
          if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt || !user.memberProfile) {
            throw new NotFoundException('会员不存在或已停用')
          }
          if (!referrer || referrer.status !== UserStatus.ACTIVE || referrer.deletedAt || !referrer.memberProfile) {
            throw new NotFoundException('推荐人不存在或已停用')
          }
          try {
            validateDirectReferral({
              userId,
              requestedReferrerId: dto.referrerId,
              existingReferrerId: user.referrerId,
            })
          } catch (error) {
            throw new BadRequestException(error instanceof Error ? error.message : '推荐关系无效')
          }
          await this.assertReferralAcyclic(tx, userId, referrer)

          const changed = await tx.user.updateMany({
            where: { id: userId, referrerId: null, status: UserStatus.ACTIVE, deletedAt: null },
            data: { referrerId: dto.referrerId },
          })
          if (changed.count === 1) {
            await tx.auditLog.create({
              data: {
                actorId: userId,
                actorRole: actor.roles.find((role) => role === AppRole.MEMBER) ?? actor.roles[0],
                action: 'DIRECT_REFERRAL_BOUND',
                objectType: 'User',
                objectId: userId,
                oldValue: { referrerId: null } as never,
                newValue: { referrerId: dto.referrerId } as never,
                reason: '会员本人确认一层直接推荐关系',
              },
            })
            return { id: userId, referrerId: dto.referrerId }
          }

          // A concurrent request may have won the conditional write.  Return
          // success only when it chose the same referrer; a different choice is
          // an immutable-binding conflict and must be visible to the caller.
          const latest = await tx.user.findUnique({ where: { id: userId }, select: { id: true, referrerId: true } })
          if (latest?.referrerId === dto.referrerId) return latest
          throw new ConflictException('直接推荐人已绑定，不能更换')
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (!this.isPrismaErrorCode(error, 'P2034')) throw error
      const latest = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, referrerId: true },
      })
      if (latest?.referrerId === dto.referrerId) return latest
      throw new ConflictException('推荐关系刚刚发生变化，请刷新后重试')
    }
  }

  private isCoachOnly(actor: AuthUser) {
    return actor.roles.includes(AppRole.COACH) &&
      !actor.roles.some((role) => ([AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role))
  }

  private assertAnyRole(actor: AuthUser, allowed: readonly AppRole[], message: string) {
    if (!actor.roles.some((role) => allowed.includes(role))) throw new ForbiddenException(message)
  }

  private auditRole(actor: AuthUser) {
    return actor.roles.find((role) => LEAD_WRITE_ROLES.includes(role)) ?? actor.roles[0]
  }

  private async assertAssignableOwner(ownerId: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { status: true, deletedAt: true, primaryRole: true, roles: { select: { role: true } } },
    })
    const assignable: AppRole[] = [AppRole.FRONT_DESK, AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN]
    if (!owner || owner.status !== UserStatus.ACTIVE || owner.deletedAt ||
      ![owner.primaryRole, ...owner.roles.map(({ role }) => role)].some((role) => assignable.includes(role))) {
      throw new BadRequestException('负责人不存在、已停用或角色不可分配')
    }
  }

  private assertFollowUpTransition(before: LeadStatus, after: LeadStatus) {
    const rank: Partial<Record<LeadStatus, number>> = {
      [LeadStatus.NEW]: 0,
      [LeadStatus.CONTACTING]: 1,
      [LeadStatus.TRIAL_RESERVED]: 2,
      [LeadStatus.ATTENDED]: 3,
    }
    if (rank[after] === undefined || rank[before] === undefined || rank[after]! < rank[before]!) {
      throw new ConflictException('跟进状态不能回退或直接进入终态')
    }
  }

  private async auditLead(
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
        actorRole: this.auditRole(actor),
        action,
        objectType: 'CustomerLead',
        objectId: leadId,
        oldValue: oldValue as never,
        newValue: newValue as never,
        reason,
      },
    })
  }

  private async assertReferralAcyclic(
    tx: Prisma.TransactionClient,
    userId: string,
    initialReferrer: { id: string; referrerId: string | null },
  ) {
    const visited = new Set<string>()
    let current: { id: string; referrerId: string | null } | null = initialReferrer
    while (current) {
      if (current.id === userId || visited.has(current.id)) {
        throw new BadRequestException('推荐关系不能形成闭环')
      }
      visited.add(current.id)
      if (!current.referrerId) return
      current = await tx.user.findUnique({
        where: { id: current.referrerId },
        select: { id: true, referrerId: true },
      })
    }
  }

  private isPrismaErrorCode(error: unknown, code: string) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
  }
}
