import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  AccountAdjustmentStatus,
  EventPrizeStatus,
  EventStatus,
  HostStatus,
  LeadStatus,
  MatchStatus,
  OrderStatus,
  RefundStatus,
  SettlementStatus,
  AttendanceStatus,
  TrainingConsumeCorrectionStatus,
} from '../generated/prisma/client.js';

export type WorkItemKind =
  | 'ACCOUNT_ADJUSTMENT_REVIEW'
  | 'CUSTOMER_LEAD_SLA'
  | 'HOST_APPLICATION_REVIEW'
  | 'REFUND_REVIEW'
  | 'TRAINING_CONSUME_CORRECTION_REVIEW'
  | 'TRAINING_ATTENDANCE'
  | 'EVENT_SCORE'
  | 'EVENT_PRIZE_RECEIPT'
  | 'ALLIANCE_SETTLEMENT'
  | 'TRAINING_SETTLEMENT'
  | 'LOW_STOCK'
  | 'ORDER_FULFILLMENT';

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  objectType: string;
  objectId: string;
  status: string;
  priority: number;
  title: string;
  description: string;
  ownerRoles: AppRole[];
  createdAt: string;
  dueAt?: string;
  amountCents?: number;
  action: string;
  metadata?: Record<string, unknown>;
}

const INTERNAL_ROLES = new Set<AppRole>([
  AppRole.FRONT_DESK,
  AppRole.COACH,
  AppRole.EVENT_MANAGER,
  AppRole.HOST,
  AppRole.MERCHANT,
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]);

const hasAny = (roles: readonly AppRole[], allowed: readonly AppRole[]) =>
  roles.some((role) => allowed.includes(role));

@Injectable()
export class WorkItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, requestedLimit = 50): Promise<WorkItem[]> {
    const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 50, 1), 100);
    const roles = actor.roles.filter((role) => INTERNAL_ROLES.has(role));
    if (!roles.length) return [];

    const canReviewMoney = hasAny(roles, [
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const isMerchantOnly =
      hasAny(roles, [AppRole.MERCHANT]) &&
      !hasAny(roles, [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
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
    // Pointing attendance is an operational page action. The unified queue
    // contains only financial consume proposals, so it is visible to the
    // checker roles and never routes a coach back to approve their own work.
    const canReviewTrainingConsumes = hasAny(roles, [
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canOperateEvents = hasAny(roles, [
      AppRole.EVENT_MANAGER,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canOperateInventory = hasAny(roles, [
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canOperateOrders = hasAny(roles, [
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canOperateCustomers = hasAny(roles, [
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canReviewHosts = hasAny(roles, [AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    const canReviewTrainingCorrections = hasAny(roles, [
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canReviewAlliance = canReviewMoney || isMerchantOnly;

    const [
      refunds,
      attendances,
      matches,
      prizeReceipts,
      allianceSettlements,
      trainingSettlements,
      inventory,
      orders,
      customerLeads,
      hostApplications,
      accountAdjustments,
      trainingConsumeCorrections,
    ] = await Promise.all([
      canReviewMoney
        ? this.prisma.refund.findMany({
            where: { status: RefundStatus.REQUESTED },
            include: {
              order: { select: { orderNo: true, title: true, memberId: true } },
            },
            orderBy: { requestedAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canReviewTrainingConsumes
        ? this.prisma.trainingAttendance.findMany({
            where: {
              status: AttendanceStatus.ATTENDED,
              operatorId: { not: null },
              consumedAt: null,
              consumedSessions: 0,
            },
            include: {
              session: { include: { class: { select: { name: true } } } },
              enrollment: {
                include: { student: { select: { displayName: true } } },
              },
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canOperateEvents
        ? this.prisma.eventMatch.findMany({
            where: {
              status: { in: [MatchStatus.PENDING, MatchStatus.SUBMITTED] },
              event: {
                status: { in: [EventStatus.IN_PROGRESS, EventStatus.FULL] },
              },
            },
            include: { event: { select: { name: true, startsAt: true } } },
            orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
            take: limit,
          })
        : Promise.resolve([]),
      canOperateEvents
        ? this.prisma.eventPrizeAward.findMany({
            where: { status: EventPrizeStatus.ISSUED },
            include: {
              event: { select: { name: true } },
              team: { select: { name: true } },
              inventoryItem: { select: { name: true, sku: true } },
            },
            orderBy: { issuedAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canReviewAlliance
        ? this.prisma.allianceSettlement.findMany({
            where: isMerchantOnly
              ? {
                  merchantId: { in: merchantIds || [] },
                  status: SettlementStatus.PENDING_CONFIRMATION,
                }
              : {
                  status: {
                    in: [
                      SettlementStatus.DRAFT,
                      SettlementStatus.PENDING_CONFIRMATION,
                    ],
                  },
                },
            include: { merchant: { select: { name: true } } },
            orderBy: { periodEnd: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canReviewMoney
        ? this.prisma.trainingSettlement.findMany({
            where: {
              status: {
                in: [
                  SettlementStatus.DRAFT,
                  SettlementStatus.PENDING_CONFIRMATION,
                  SettlementStatus.CONFIRMED,
                ],
              },
            },
            orderBy: { periodEnd: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canOperateInventory
        ? this.prisma.inventoryItem.findMany({
            where: { enabled: true },
            orderBy: { stock: 'asc' },
            take: Math.min(limit * 2, 200),
          })
        : Promise.resolve([]),
      canOperateOrders
        ? this.prisma.order.findMany({
            where: {
              status: { in: [OrderStatus.PAID, OrderStatus.CHECKED_IN] },
            },
            select: {
              id: true,
              orderNo: true,
              title: true,
              status: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canOperateCustomers
        ? this.prisma.customerLead.findMany({
            where: {
              status: {
                notIn: [
                  LeadStatus.CONVERTED,
                  LeadStatus.LOST,
                  LeadStatus.ARCHIVED,
                ],
              },
            },
            include: { owner: { select: { id: true, displayName: true } } },
            orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'asc' }],
            take: limit,
          })
        : Promise.resolve([]),
      canReviewHosts
        ? this.prisma.hostProfile.findMany({
            where: { status: HostStatus.APPLIED },
            include: {
              user: {
                select: {
                  displayName: true,
                  memberProfile: { select: { level: true, visitCount: true } },
                },
              },
            },
            orderBy: { appliedAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canReviewMoney
        ? this.prisma.accountAdjustmentRequest.findMany({
            where: {
              status: AccountAdjustmentStatus.REQUESTED,
              requestedById: { not: actor.sub },
            },
            include: {
              account: { include: { user: { select: { displayName: true } } } },
              requestedBy: { select: { displayName: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
      canReviewTrainingCorrections
        ? this.prisma.trainingConsumeCorrection.findMany({
            where: { status: TrainingConsumeCorrectionStatus.REQUESTED },
            include: {
              attendance: {
                include: {
                  session: { include: { class: { select: { name: true } } } },
                  enrollment: {
                    include: {
                      student: { select: { displayName: true } },
                      buyer: { select: { displayName: true } },
                    },
                  },
                },
              },
              requestedBy: { select: { displayName: true } },
            },
            orderBy: { requestedAt: 'asc' },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    const now = Date.now();
    const items: WorkItem[] = [
      ...accountAdjustments.map((request) => ({
        id: `account-adjustment:${request.id}`,
        kind: 'ACCOUNT_ADJUSTMENT_REVIEW' as const,
        objectType: 'AccountAdjustmentRequest',
        objectId: request.id,
        status: request.status,
        priority: 98,
        title: `账户调整待复核 · ${request.account.user.displayName}`,
        description: `${request.account.type} ${request.amount > 0 ? '+' : ''}${request.amount} · ${request.reason}`,
        ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: request.createdAt.toISOString(),
        amountCents:
          request.account.type === 'CASH_PRINCIPAL' ||
          request.account.type === 'GIFT_BALANCE'
            ? request.amount
            : undefined,
        action: `/members/account-adjustments/${request.id}/approve`,
        metadata: {
          requestedBy: request.requestedBy.displayName,
          requestedById: request.requestedById,
        },
      })),
      ...trainingConsumeCorrections.map((correction) => {
        const studentName =
          correction.attendance.enrollment.student?.displayName ||
          correction.attendance.enrollment.buyer.displayName ||
          '成人学员';
        return {
          id: `training-consume-correction:${correction.id}`,
          kind: 'TRAINING_CONSUME_CORRECTION_REVIEW' as const,
          objectType: 'TrainingConsumeCorrection',
          objectId: correction.id,
          status: correction.status,
          priority: 92,
          title: `消课冲正待复核 · ${studentName}`,
          description: `${correction.attendance.session.class.name} · 学员 ${studentName} · 申请人 ${correction.requestedBy.displayName} · ${correction.reason}`,
          ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
          createdAt: correction.requestedAt.toISOString(),
          action: `/training/consume-corrections/${correction.id}/approve`,
          metadata: {
            recognitionId: correction.recognitionId,
            attendanceId: correction.attendanceId,
            requestedById: correction.requestedById,
          },
        };
      }),
      ...customerLeads.map((lead) => ({
        id: `customer-lead:${lead.id}`,
        kind: 'CUSTOMER_LEAD_SLA' as const,
        objectType: 'CustomerLead',
        objectId: lead.id,
        status: lead.status,
        priority: lead.slaDueAt.getTime() < now ? 95 : 65,
        title: `${lead.slaDueAt.getTime() < now ? '线索已逾期' : '客户待跟进'} · ${lead.displayName}`,
        description: `${lead.campaign || lead.sourceChannel} · 负责人 ${lead.owner?.displayName || '待认领'}`,
        ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: lead.createdAt.toISOString(),
        dueAt: lead.slaDueAt.toISOString(),
        action: `/members/leads/${lead.id}`,
        metadata: {
          ownerId: lead.ownerId,
          sourceChannel: lead.sourceChannel,
          campaign: lead.campaign,
          overdue: lead.slaDueAt.getTime() < now,
        },
      })),
      ...hostApplications.map((application) => ({
        id: `host-application:${application.id}`,
        kind: 'HOST_APPLICATION_REVIEW' as const,
        objectType: 'HostProfile',
        objectId: application.id,
        status: application.status,
        priority: 88,
        title: `主理人申请待审核 · ${application.user.displayName}`,
        description: `${application.user.memberProfile?.level || '普通会员'} · 到店 ${application.user.memberProfile?.visitCount || 0} 次`,
        ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: application.appliedAt.toISOString(),
        action: `/games/hosts/${application.userId}/approve`,
        metadata: { userId: application.userId },
      })),
      ...refunds.map((refund) => ({
        id: `refund:${refund.id}`,
        kind: 'REFUND_REVIEW' as const,
        objectType: 'Refund',
        objectId: refund.id,
        status: refund.status,
        priority: 100,
        title: `退款待审核 · ${refund.order.orderNo}`,
        description: `${refund.order.title}，申请金额 ¥${(refund.amountCents / 100).toFixed(2)}`,
        ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: refund.requestedAt.toISOString(),
        amountCents: refund.amountCents,
        action: `/orders/refunds/${refund.id}/approve`,
        metadata: {
          orderNo: refund.order.orderNo,
          memberId: refund.order.memberId,
        },
      })),
      ...attendances.map((attendance) => ({
        id: `training-attendance:${attendance.id}`,
        kind: 'TRAINING_ATTENDANCE' as const,
        objectType: 'TrainingAttendance',
        objectId: attendance.id,
        status: attendance.status,
        priority: 80,
        title: `消课建议待确认 · ${attendance.enrollment.student?.displayName || '成人学员'}`,
        description: `${attendance.session.class.name} · 教练已提交 · ${attendance.session.startsAt.toISOString()}`,
        ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: attendance.createdAt.toISOString(),
        dueAt: attendance.session.endsAt.toISOString(),
        action: `/training/sessions/${attendance.sessionId}/consume`,
        metadata: {
          sessionId: attendance.sessionId,
          enrollmentId: attendance.enrollmentId,
        },
      })),
      ...matches.map((match) => ({
        id: `event-score:${match.id}`,
        kind: 'EVENT_SCORE' as const,
        objectType: 'EventMatch',
        objectId: match.id,
        status: match.status,
        priority: 85,
        title: `第${match.round}轮待录比分 · ${match.event.name}`,
        description: `赛事开始于 ${match.event.startsAt.toISOString()}`,
        ownerRoles: [
          AppRole.EVENT_MANAGER,
          AppRole.FRONT_DESK,
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
        ],
        createdAt: match.createdAt.toISOString(),
        action: `/events/matches/${match.id}/score`,
        metadata: {
          eventId: match.eventId,
          round: match.round,
          courtLabel: match.courtLabel,
        },
      })),
      ...prizeReceipts.map((award) => ({
        id: `event-prize-receipt:${award.id}`,
        kind: 'EVENT_PRIZE_RECEIPT' as const,
        objectType: 'EventPrizeAward',
        objectId: award.id,
        status: award.status,
        priority: 82,
        title: `奖品待签收 · ${award.event.name}`,
        description: `${award.team.name} · ${award.awardName} · ${award.inventoryItem.name} × ${award.quantity}`,
        ownerRoles: [
          AppRole.EVENT_MANAGER,
          AppRole.FRONT_DESK,
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
        ],
        createdAt: award.issuedAt.toISOString(),
        action: `/events/${award.eventId}/prizes/${award.id}/receive`,
        metadata: {
          eventId: award.eventId,
          teamId: award.teamId,
          sku: award.inventoryItem.sku,
          recipientNames: award.recipientNames,
        },
      })),
      ...allianceSettlements.map((settlement) => ({
        id: `alliance-settlement:${settlement.id}`,
        kind: 'ALLIANCE_SETTLEMENT' as const,
        objectType: 'AllianceSettlement',
        objectId: settlement.id,
        status: settlement.status,
        priority: 70,
        title: `联盟结算待处理 · ${settlement.merchant.name}`,
        description: `周期 ${settlement.periodStart.toISOString().slice(0, 10)} 至 ${settlement.periodEnd.toISOString().slice(0, 10)}`,
        ownerRoles: isMerchantOnly
          ? [AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN]
          : [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: settlement.createdAt.toISOString(),
        dueAt: settlement.periodEnd.toISOString(),
        amountCents: settlement.cooperationFeeCents,
        action:
          settlement.status === SettlementStatus.PENDING_CONFIRMATION
            ? `/alliance/settlements/${settlement.id}/confirm`
            : `/alliance/settlements/${settlement.id}`,
        metadata: {
          merchantId: settlement.merchantId,
          effectiveNewCustomers: settlement.effectiveNewCustomers,
        },
      })),
      ...trainingSettlements.map((settlement) => ({
        id: `training-settlement:${settlement.id}`,
        kind: 'TRAINING_SETTLEMENT' as const,
        objectType: 'TrainingSettlement',
        objectId: settlement.id,
        status: settlement.status,
        priority: 75,
        title:
          settlement.status === SettlementStatus.DRAFT
            ? '培训结算草稿待提交'
            : settlement.status === SettlementStatus.PENDING_CONFIRMATION
              ? '培训结算待复核确认'
              : '培训结算待入账',
        description: `有效流水 ¥${(settlement.effectiveRevenueCents / 100).toFixed(2)} · 场馆20% ¥${(settlement.venueContributionCents / 100).toFixed(2)}`,
        ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: settlement.createdAt.toISOString(),
        dueAt: settlement.periodEnd.toISOString(),
        amountCents: settlement.venueContributionCents,
        action: `/packages/ops/pages/finance/index?focus=training-settlement&id=${settlement.id}`,
        metadata: {
          venueFeeCents: settlement.venueFeeCents,
          trainingPayableVenueCents: settlement.trainingPayableVenueCents,
        },
      })),
      ...inventory
        .filter((item) => item.stock <= item.safeStock)
        .slice(0, limit)
        .map((item) => ({
          id: `stock:${item.id}`,
          kind: 'LOW_STOCK' as const,
          objectType: 'InventoryItem',
          objectId: item.id,
          status: 'OPEN',
          priority: 60,
          title: `库存低于安全线 · ${item.name}`,
          description: `当前 ${item.stock} 件，安全线 ${item.safeStock} 件`,
          ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
          createdAt: item.updatedAt.toISOString(),
          action: `/inventory/${item.id}`,
          metadata: {
            sku: item.sku,
            stock: item.stock,
            safeStock: item.safeStock,
          },
        })),
      ...orders.map((order) => ({
        id: `order:${order.id}`,
        kind: 'ORDER_FULFILLMENT' as const,
        objectType: 'Order',
        objectId: order.id,
        status: order.status,
        priority: order.status === OrderStatus.PAID ? 50 : 40,
        title: `${order.status === OrderStatus.PAID ? '待签到/履约' : '待完成'} · ${order.orderNo}`,
        description: order.title,
        ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        createdAt: order.createdAt.toISOString(),
        action: `/orders/${order.id}`,
      })),
    ];

    return items
      .sort(
        (a, b) =>
          b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
      )
      .slice(0, limit);
  }
}
