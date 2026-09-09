import { canManageGames } from '../common/auth/operation-scopes.js';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  BookingStatus,
  BusinessType,
  Prisma,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import {
  WORK_ITEM_GROUP_BY_KIND,
  WorkItem,
  INTERNAL_ROLES,
  hasAny,
} from './work-item-context.js';
import { loadRefunds, mapRefundsWorkItems } from './domains/refunds.js';
import {
  loadAttendances,
  mapAttendancesWorkItems,
} from './domains/attendances.js';
import { loadMatches, mapMatchesWorkItems } from './domains/matches.js';
import {
  loadPrizeReceipts,
  mapPrizeReceiptsWorkItems,
} from './domains/prize-receipts.js';
import {
  loadAllianceSettlements,
  mapAllianceSettlementsWorkItems,
} from './domains/alliance-settlements.js';
import {
  loadTrainingSettlements,
  mapTrainingSettlementsWorkItems,
} from './domains/training-settlements.js';
import {
  loadConsignmentSettlements,
  mapConsignmentSettlementsWorkItems,
} from './domains/consignment-settlements.js';
import { loadInventory, mapInventoryWorkItems } from './domains/inventory.js';
import { loadOrders, mapOrdersWorkItems } from './domains/orders.js';
import {
  loadCustomerLeads,
  mapCustomerLeadsWorkItems,
} from './domains/customer-leads.js';
import {
  loadHostApplications,
  mapHostApplicationsWorkItems,
} from './domains/host-applications.js';
import {
  loadDataErasureRequests,
  mapDataErasureRequestsWorkItems,
} from './domains/data-erasure-requests.js';
import {
  loadAccountAdjustments,
  mapAccountAdjustmentsWorkItems,
} from './domains/account-adjustments.js';
import {
  loadTrainingConsumeCorrections,
  mapTrainingConsumeCorrectionsWorkItems,
} from './domains/training-consume-corrections.js';
import {
  loadTrainingTrials,
  mapTrainingTrialsWorkItems,
} from './domains/training-trials.js';
import {
  loadYouthTrainingRules,
  mapYouthTrainingRulesWorkItems,
} from './domains/youth-training-rules.js';
import { loadGames, mapGamesWorkItems } from './domains/games.js';
import {
  loadTrainingSessions,
  mapTrainingSessionsWorkItems,
} from './domains/training-sessions.js';

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
    const canOperateTrainingSessions = hasAny(roles, [
      AppRole.COACH,
      AppRole.FRONT_DESK,
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
      AppRole.EVENT_MANAGER,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canOperateGames = canManageGames(roles);
    const canOperateCustomers = hasAny(roles, [
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canReviewHosts = hasAny(roles, [AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    const canReviewErasure = hasAny(roles, [
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canReviewTrainingCorrections = hasAny(roles, [
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canReviewAlliance = canReviewMoney || isMerchantOnly;
    const isOperationsAdmin = hasAny(roles, [
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canCheckInTrials = hasAny(roles, [
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canAssessTrials = hasAny(roles, [
      AppRole.COACH,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const canDecideTrials = isOperationsAdmin;
    const canReviewYouthRules = roles.includes(AppRole.SUPER_ADMIN);
    const nowDate = new Date();
    const orderFulfillmentScopes: Prisma.OrderWhereInput[] = [];
    if (isOperationsAdmin || roles.includes(AppRole.FRONT_DESK)) {
      orderFulfillmentScopes.push({
        businessType: BusinessType.VENUE,
        bookings: {
          some: {
            startsAt: { lte: nowDate },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
          },
        },
      });
    }
    if (isOperationsAdmin || roles.includes(AppRole.EVENT_MANAGER)) {
      orderFulfillmentScopes.push({
        businessType: BusinessType.EVENT,
        eventTeam: {
          is: {
            status: {
              in: [RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN],
            },
            event: { startsAt: { lte: nowDate } },
          },
        },
      });
    }

    const [
      refunds,
      attendances,
      matches,
      prizeReceipts,
      allianceSettlements,
      trainingSettlements,
      consignmentSettlements,
      inventory,
      orders,
      customerLeads,
      hostApplications,
      dataErasureRequests,
      accountAdjustments,
      trainingConsumeCorrections,
      trainingTrials,
      youthTrainingRules,
      games,
      trainingSessions,
    ] = await Promise.all([
      loadRefunds(this.prisma, { limit, canReviewMoney }),
      loadAttendances(this.prisma, { limit, canReviewTrainingConsumes }),
      loadMatches(this.prisma, { limit, canOperateEvents }),
      loadPrizeReceipts(this.prisma, { limit, canOperateEvents }),
      loadAllianceSettlements(this.prisma, {
        limit,
        merchantIds,
        isMerchantOnly,
        canReviewAlliance,
      }),
      loadTrainingSettlements(this.prisma, { limit, canReviewMoney }),
      loadConsignmentSettlements(this.prisma, { actor, limit, canReviewMoney }),
      loadInventory(this.prisma, { limit, canOperateInventory }),
      loadOrders(this.prisma, {
        limit,
        orderFulfillmentScopes,
        canOperateOrders,
      }),
      loadCustomerLeads(this.prisma, { limit, canOperateCustomers }),
      loadHostApplications(this.prisma, { limit, canReviewHosts }),
      loadDataErasureRequests(this.prisma, { limit, canReviewErasure }),
      loadAccountAdjustments(this.prisma, { actor, limit, canReviewMoney }),
      loadTrainingConsumeCorrections(this.prisma, {
        limit,
        canReviewTrainingCorrections,
      }),
      loadTrainingTrials(this.prisma, {
        actor,
        limit,
        isOperationsAdmin,
        canCheckInTrials,
        canAssessTrials,
        canDecideTrials,
      }),
      loadYouthTrainingRules(this.prisma, { limit, canReviewYouthRules }),
      loadGames(this.prisma, {
        actor,
        limit,
        roles,
        nowDate,
        canOperateGames,
        isOperationsAdmin,
      }),
      loadTrainingSessions(this.prisma, {
        actor,
        limit,
        nowDate,
        canOperateTrainingSessions,
      }),
    ]);

    const now = nowDate.getTime();
    const items: WorkItem[] = [
      ...mapTrainingSessionsWorkItems(trainingSessions, { now }),
      ...mapGamesWorkItems(games, { now }),
      ...mapTrainingTrialsWorkItems(trainingTrials, { now }),
      ...mapYouthTrainingRulesWorkItems(youthTrainingRules),
      ...mapAccountAdjustmentsWorkItems(accountAdjustments),
      ...mapTrainingConsumeCorrectionsWorkItems(trainingConsumeCorrections),
      ...mapCustomerLeadsWorkItems(customerLeads, { now }),
      ...mapHostApplicationsWorkItems(hostApplications),
      ...mapDataErasureRequestsWorkItems(dataErasureRequests),
      ...mapRefundsWorkItems(refunds),
      ...mapAttendancesWorkItems(attendances),
      ...mapMatchesWorkItems(matches),
      ...mapPrizeReceiptsWorkItems(prizeReceipts),
      ...mapAllianceSettlementsWorkItems(allianceSettlements, {
        isMerchantOnly,
      }),
      ...mapTrainingSettlementsWorkItems(trainingSettlements),
      ...mapConsignmentSettlementsWorkItems(consignmentSettlements),
      ...mapInventoryWorkItems(inventory, { limit }),
      ...mapOrdersWorkItems(orders),
    ];

    return items
      .sort(
        (a, b) =>
          b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
      )
      .slice(0, limit)
      .map((item) => ({
        ...item,
        group: WORK_ITEM_GROUP_BY_KIND[item.kind],
      }));
  }
}
export type {
  WorkItem,
  WorkItemKind,
  WorkItemGroup,
} from './work-item-context.js';
