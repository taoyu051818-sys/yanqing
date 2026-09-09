import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import { mockConsignmentSettlementWorkItems } from "../consignment-settlement";
import { getOrders } from "../venue";
import {
  getAccountAdjustmentRequests,
  getCustomerLeads,
  getEnrollments,
  getGames,
  getHostApplications,
  getGoods,
  getTrainingSessions,
  getTrainingProducts,
  getTrainingConsumeCorrections,
  getTrainingSettlements,
  getDataErasureRequests,
} from "../state";
import { ok, mockRoles, hasMockRole } from "../policies/common.js";
import { trainingCorrectionView } from "../policies/training.js";
import { accountAdjustmentView } from "../policies/members.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleWorkItemsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/work-items") {
    const roles = mockRoles();
    if (roles.every((role) => role === "MEMBER"))
      return { handled: true, value: ok([]) };
    const workItemGroup = (kind: string) =>
      ({
        CUSTOMER_LEAD_SLA: "CUSTOMER",
        HOST_APPLICATION_REVIEW: "CUSTOMER",
        ACCOUNT_ADJUSTMENT_REVIEW: "REFUND",
        REFUND_REVIEW: "REFUND",
        TRAINING_CONSUME_CORRECTION_REVIEW: "TRAINING",
        TRAINING_SESSION_OPERATION: "TRAINING",
        TRAINING_ATTENDANCE: "TRAINING",
        TRAINING_SETTLEMENT: "RECONCILIATION",
        CONSIGNMENT_SETTLEMENT: "RECONCILIATION",
        EVENT_SCORE: "EVENT",
        ALLIANCE_SETTLEMENT: "RECONCILIATION",
        GAME_OPERATION: "FULFILLMENT",
        ORDER_FULFILLMENT: "FULFILLMENT",
        LOW_STOCK: "INVENTORY",
        DATA_ERASURE_REVIEW: "GOVERNANCE",
      })[kind];
    const customerItems = getCustomerLeads()
      .filter(
        (lead) =>
          !["CONVERTED", "LOST", "ARCHIVED"].includes(String(lead.status)),
      )
      .map((lead) => ({
        id: `customer-lead:${lead.id}`,
        kind: "CUSTOMER_LEAD_SLA",
        objectType: "CustomerLead",
        objectId: lead.id,
        status: lead.status,
        priority:
          new Date(String(lead.slaDueAt)).getTime() < Date.now() ? 95 : 65,
        title: `${new Date(String(lead.slaDueAt)).getTime() < Date.now() ? "线索已逾期" : "客户待跟进"} · ${lead.displayName}`,
        description: `${lead.campaign || lead.sourceChannel} · 负责人 ${lead.ownerName || "待认领"}`,
        ownerRoles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
        createdAt: lead.createdAt,
        dueAt: lead.slaDueAt,
        action: `/packages/ops/pages/members/index?focus=lead&id=${lead.id}`,
        metadata: { leadId: lead.id },
      }));
    const hostItems = getHostApplications()
      .filter((application) => application.status === "APPLIED")
      .map((application) => ({
        id: `host-application:${application.id}`,
        kind: "HOST_APPLICATION_REVIEW",
        objectType: "HostProfile",
        objectId: application.id,
        status: application.status,
        priority: 88,
        title: `主理人申请待审核 · ${(application.user as any)?.displayName || application.userId}`,
        description: "审核会员资质、到店记录与组织能力",
        ownerRoles: ["ADMIN", "SUPER_ADMIN"],
        createdAt: application.appliedAt,
        action: `/packages/ops/pages/members/index?focus=host-application&id=${application.id}&userId=${application.userId}`,
        metadata: { userId: application.userId },
      }));
    const accountAdjustmentItems = getAccountAdjustmentRequests()
      .filter(
        (request) =>
          request.status === "REQUESTED" &&
          request.requestedById !== mockUser().id,
      )
      .map((request) => {
        const view = accountAdjustmentView(request);
        const memberName = view.account?.user?.displayName || "会员";
        return {
          id: `account-adjustment:${request.id}`,
          kind: "ACCOUNT_ADJUSTMENT_REVIEW",
          objectType: "AccountAdjustmentRequest",
          objectId: request.id,
          status: request.status,
          priority: 98,
          title: `账户调整待复核 · ${memberName}`,
          description: `${view.account?.type || "账户"} ${Number(request.amount) > 0 ? "+" : ""}${request.amount} · ${request.reason}`,
          ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
          createdAt: request.createdAt,
          amountCents: request.amount,
          action: `/packages/ops/pages/finance/index?focus=account-adjustment&id=${request.id}`,
        };
      });
    const trainingCorrectionItems = getTrainingConsumeCorrections()
      .filter((correction) => correction.status === "REQUESTED")
      .map((correction) => {
        const view = trainingCorrectionView(correction);
        const learner =
          view.attendance?.enrollment?.student?.displayName ||
          view.attendance?.enrollment?.buyer?.displayName ||
          "成人学员";
        return {
          id: `training-consume-correction:${correction.id}`,
          kind: "TRAINING_CONSUME_CORRECTION_REVIEW",
          objectType: "TrainingConsumeCorrection",
          objectId: correction.id,
          status: correction.status,
          priority: 92,
          title: `消课冲正待复核 · ${learner}`,
          description: `${view.attendance?.session?.class?.name || "培训课次"} · 学员 ${learner} · 申请人 ${view.requestedBy?.displayName || correction.requestedById} · ${correction.reason}`,
          ownerRoles: ["ADMIN", "SUPER_ADMIN"],
          createdAt: correction.requestedAt,
          action: `/packages/ops/pages/coach/index?focus=consume-correction&id=${correction.id}&attendanceId=${correction.attendanceId}`,
          metadata: {
            recognitionId: correction.recognitionId,
            attendanceId: correction.attendanceId,
            requestedById: correction.requestedById,
          },
        };
      });
    const trainingSettlementItems = hasMockRole(
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    )
      ? getTrainingSettlements()
          .filter((settlement) =>
            ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"].includes(
              settlement.status,
            ),
          )
          .map((settlement) => ({
            id: `training-settlement:${settlement.id}`,
            kind: "TRAINING_SETTLEMENT",
            objectType: "TrainingSettlement",
            objectId: settlement.id,
            status: settlement.status,
            priority: 75,
            title:
              settlement.status === "DRAFT"
                ? "培训结算草稿待提交"
                : settlement.status === "PENDING_CONFIRMATION"
                  ? "培训结算待复核确认"
                  : "培训结算待入账",
            description: `有效流水 ¥${(Number(settlement.effectiveRevenueCents || 0) / 100).toFixed(2)} · 场馆20% ¥${(Number(settlement.venueContributionCents || 0) / 100).toFixed(2)}`,
            ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
            createdAt: settlement.createdAt,
            dueAt: settlement.periodEnd,
            amountCents: settlement.venueContributionCents,
            action: `/packages/ops/pages/finance/index?focus=training-settlement&id=${settlement.id}`,
          }))
      : [];
    const consignmentSettlementItems = mockConsignmentSettlementWorkItems();
    const refundItems = getOrders().flatMap((order) =>
      (order.refunds || [])
        .filter((refund: any) =>
          [
            "REQUESTED",
            "REFUND_PENDING",
            "APPROVED",
            "PROCESSING",
            "FAILED",
          ].includes(refund.status),
        )
        .map((refund: any) => ({
          id: `refund:${refund.id}`,
          kind: "REFUND_REVIEW",
          objectType: "Refund",
          objectId: refund.id,
          status: refund.status,
          priority: 100,
          title: `退款待审核 · ${refund.refundNo || order.orderNo}`,
          description: `${order.title || "订单"} · 申请金额 ¥${(Number(refund.amountCents || 0) / 100).toFixed(2)}`,
          ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
          createdAt: refund.requestedAt || order.createdAt,
          amountCents: refund.amountCents,
          action: `/packages/ops/pages/finance/index?focus=refund&id=${refund.id}&orderId=${order.id}`,
          metadata: { orderId: order.id },
        })),
    );
    const fulfillmentItems = getOrders()
      .filter(
        (order) =>
          ["VENUE", "EVENT"].includes(order.businessType) &&
          ["PAID", "CHECKED_IN", "REFUND_PENDING"].includes(order.status),
      )
      .map((order) => {
        const page =
          order.businessType === "GAME"
            ? "host"
            : order.businessType === "EVENT"
              ? "event"
              : "frontdesk";
        const ownerRoles =
          order.businessType === "GAME"
            ? ["HOST", "ADMIN", "SUPER_ADMIN"]
            : order.businessType === "EVENT"
              ? ["EVENT_MANAGER", "ADMIN", "SUPER_ADMIN"]
              : ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"];
        return {
          id: `order-fulfillment:${order.id}`,
          kind: "ORDER_FULFILLMENT",
          objectType: "Order",
          objectId: order.id,
          status: order.status,
          priority: order.status === "CHECKED_IN" ? 85 : 75,
          title: `${order.status === "CHECKED_IN" ? "已签到待完成" : "已开场待签到"} · ${order.orderNo}`,
          description: order.title || "待现场处理",
          ownerRoles,
          createdAt: order.createdAt,
          action: `/packages/ops/pages/${page}/index?focus=fulfillment&orderId=${order.id}`,
          metadata: { orderId: order.id, businessType: order.businessType },
        };
      });
    const gameOperationItems = getGames()
      .filter(
        (game) =>
          ["OPEN", "FULL", "IN_PROGRESS"].includes(game.status) &&
          new Date(game.startsAt) <= new Date() &&
          hasMockRole("HOST", "ADMIN", "SUPER_ADMIN") &&
          (hasMockRole("ADMIN", "SUPER_ADMIN") ||
            game.hostId === mockUser().id),
      )
      .map((game) => {
        const registrations = (game.registrations || []).filter((entry: any) =>
          ["PAID", "CHECKED_IN"].includes(entry.status),
        );
        const ended = new Date(game.endsAt) <= new Date();
        return {
          id: `game-operation:${game.id}`,
          kind: "GAME_OPERATION",
          objectType: "Game",
          objectId: game.id,
          status: game.status,
          priority: ended ? 90 : 84,
          title: `${ended ? "球局待完赛" : "球局现场待处理"} · ${game.title}`,
          description: `${registrations.length} 名已支付/签到 · 主理人现场队列`,
          ownerRoles: ["HOST", "ADMIN", "SUPER_ADMIN"],
          createdAt: game.startsAt,
          dueAt: ended ? game.endsAt : game.startsAt,
          action: `/packages/ops/pages/host/index?focus=game&gameId=${game.id}`,
          metadata: { gameId: game.id, hostId: game.hostId },
        };
      });
    const trainingSessionItems = getTrainingSessions()
      .filter(
        (trainingSession) =>
          ["SCHEDULED", "IN_PROGRESS"].includes(trainingSession.status) &&
          new Date(trainingSession.startsAt).getTime() <= Date.now() &&
          (!roles.includes("COACH") ||
            hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN") ||
            getTrainingProducts()
              .flatMap((product) => product.classes || [])
              .some(
                (cls: any) =>
                  cls.id === trainingSession.classId &&
                  (cls.coachId === mockUser().id ||
                    cls.assistantId === mockUser().id),
              )),
      )
      .map((trainingSession) => {
        const pendingAttendanceCount = getEnrollments().filter(
          (enrollment) =>
            enrollment.classId === trainingSession.classId &&
            (enrollment.attendances || []).some(
              (attendance: any) =>
                attendance.sessionId === trainingSession.id &&
                attendance.status === "PENDING",
            ),
        ).length;
        const ended = new Date(trainingSession.endsAt).getTime() <= Date.now();
        return {
          id: `training-session-operation:${trainingSession.id}`,
          kind: "TRAINING_SESSION_OPERATION",
          objectType: "TrainingSession",
          objectId: trainingSession.id,
          status: trainingSession.status,
          priority: ended ? 91 : 83,
          title: `${ended ? "课次待结课" : "课次待点名"} · ${trainingSession.class?.name || "培训课次"}`,
          description: `${pendingAttendanceCount} 名待登记 · 完成点名后提交消课建议`,
          ownerRoles: ["COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
          createdAt: trainingSession.startsAt,
          dueAt: ended ? trainingSession.endsAt : trainingSession.startsAt,
          action: `/packages/ops/pages/coach/index?focus=session&sessionId=${trainingSession.id}`,
          metadata: {
            sessionId: trainingSession.id,
            pendingAttendanceCount,
          },
        };
      });
    const lowStockItems = getGoods()
      .filter(
        (item) =>
          item.enabled !== false &&
          Number(item.stock) <= Number(item.safeStock),
      )
      .map((item) => ({
        id: `stock:${item.id}`,
        kind: "LOW_STOCK",
        objectType: "InventoryItem",
        objectId: item.id,
        status: "OPEN",
        priority: 60,
        title: `库存低于安全线 · ${item.name}`,
        description: `当前 ${item.stock} 件，安全线 ${item.safeStock} 件`,
        ownerRoles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
        createdAt: item.updatedAt || new Date().toISOString(),
        action: `/packages/ops/pages/inventory/index?focus=low-stock&id=${item.id}`,
        metadata: { sku: item.sku },
      }));
    const dataErasureItems = hasMockRole("ADMIN", "SUPER_ADMIN")
      ? getDataErasureRequests()
          .filter((request) => request.status === "REQUESTED")
          .map((request) => ({
            id: `data-erasure:${request.id}`,
            kind: "DATA_ERASURE_REVIEW",
            objectType: "DataErasureRequest",
            objectId: request.id,
            status: request.status,
            priority: 99,
            title: `账号注销待复核 · ${request.user?.displayName || request.userId}`,
            description: `${request.user?.status || "UNKNOWN"} · ${request.reason}`,
            ownerRoles: ["ADMIN", "SUPER_ADMIN"],
            createdAt: request.requestedAt,
            action: `/packages/ops/pages/governance/index?focus=privacy&id=${request.id}`,
          }))
      : [];
    const items = [
      ...customerItems,
      ...hostItems,
      ...dataErasureItems,
      ...accountAdjustmentItems,
      ...trainingCorrectionItems,
      ...trainingSettlementItems,
      ...consignmentSettlementItems,
      ...refundItems,
      ...gameOperationItems,
      ...fulfillmentItems,
      ...trainingSessionItems,
      {
        id: "event:mock-1",
        kind: "EVENT_SCORE",
        objectType: "EventMatch",
        objectId: "match-r2-1",
        status: "PENDING",
        priority: 70,
        title: "赛事待录比分 · 第2轮",
        description: "瑞士赛有 1 场比分待确认",
        ownerRoles: ["EVENT_MANAGER", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date().toISOString(),
        action:
          "/packages/ops/pages/event/index?focus=score&id=match-r2-1&eventId=event-golden&round=2",
        metadata: { eventId: "event-golden", round: 2 },
      },
      {
        id: "settlement:mock-1",
        kind: "ALLIANCE_SETTLEMENT",
        objectType: "AllianceSettlement",
        objectId: "settlement-mock-1",
        status: "DRAFT",
        priority: 50,
        title: "联盟结算草稿 · 山脚咖啡",
        description: "待财务提交商户确认",
        ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date().toISOString(),
        action:
          "/packages/ops/pages/finance/index?focus=alliance-settlement&id=settlement-mock-1",
      },
      ...lowStockItems,
    ];
    return {
      handled: true,
      value: ok(
        items
          .filter((item) =>
            item.ownerRoles.some((role: string) =>
              roles.includes(role as AppRole),
            ),
          )
          .map((item) => ({
            ...item,
            group: workItemGroup(item.kind),
          })),
      ),
    };
  }
  return { handled: false };
}
