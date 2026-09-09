import type { AppRole } from "../../types/domain";
import { mockLogin, mockUser, updateMockProfile } from "./core";
import { routeMockTeamInvites } from "./event-signup";
import { routeMockConsignmentSettlement } from "./consignment-settlement";
import { routeMockTrainingOperations } from "./training-operations";
import { ok, text, expireMockPurchases } from "./policies/common.js";
import type { MockRouteOptions } from "./routes/route-contract.js";
import {
  handleParametersGet,
  handleParametersPost,
} from "./routes/parameters.js";
import { handleAuditLogsGet } from "./routes/audit-logs.js";
import {
  handleGovernanceUsersGet,
  handleGovernanceRolesPost,
  handleGovernanceStatusPost,
} from "./routes/governance/users.js";
import {
  handlePrivacyErasureRequestsMeGet,
  handlePrivacyErasureRequestsPost,
  handleErasureCancelPost,
  handlePrivacyErasureRequestsGet,
  handleErasureBlockersGet,
  handleErasureDecisionPost,
} from "./routes/privacy.js";
import {
  handleGovernanceRiskEventsGet,
  handleRiskActionPost,
} from "./routes/governance/risks.js";
import {
  handleOperationsShiftsCurrentGet,
  handleOperationsShiftsHistoryGet,
  handleOperationsShiftsOpenPost,
  handleCloseFrontDeskShiftPost,
  handleReviewFrontDeskVariancePost,
} from "./routes/operations.js";
import {
  handleReconciliationGetGet,
  handleReconciliationClosePost,
} from "./routes/reconciliation.js";
import { handleWorkItemsAny } from "./routes/work-items.js";
import {
  handleVenuesClosuresGet,
  handleVenuesClosuresPost,
  handleCancelVenueClosurePost,
} from "./routes/venues/closures.js";
import {
  handleVenuesTimeSlotsManageGet,
  handleVenuesPriceRulesManageGet,
  handleVenuesPriceRulesPost,
  handlePriceRuleVersionPost,
  handlePriceRuleStatusPost,
} from "./routes/venues/pricing.js";
import {
  handleVenuesAvailabilityAny,
  handleVenuesBookingsPost,
} from "./routes/venues/booking.js";
import {
  handleOrdersAny,
  handleOrdersAdminAllAny,
  handleOrderDetailGet,
} from "./routes/orders/queries.js";
import { handleOptionsGet, handlePayPost } from "./routes/orders/payments.js";
import { handleCancelPendingOrderPost } from "./routes/orders/cancellation.js";
import { handleRefundPost } from "./routes/orders/refund-requests.js";
import { handleApproveRefundPost } from "./routes/orders/refund-approval.js";
import { handleRejectRefundPost } from "./routes/orders/refund-rejection.js";
import {
  handleGamesPost,
  handleGamesGet,
  handleGamesManagedGet,
  handleGameDetailGet,
  handlePublishGamePost,
} from "./routes/games/catalog.js";
import {
  handleGamesHostsApplyPost,
  handleGamesHostApplicationsGet,
  handleReviewHostPost,
  handleGamesRewardsGrantMaturedPost,
} from "./routes/games/hosts.js";
import {
  handleRegisterGamePost,
  handlePromoteGameWaitlistPost,
  handleGameCheckInPost,
} from "./routes/games/registration.js";
import {
  handleCancelGamePost,
  handleCompleteGamePost,
} from "./routes/games/lifecycle.js";
import {
  handleEventsPost,
  handleEventsGet,
  handleEventsManagedGet,
  handleManagedEventDetailGet,
  handleEventDetailGet,
  handlePublishEventPost,
} from "./routes/events/catalog.js";
import {
  handleMyEventRegistrationGet,
  handleRegisterEventPost,
  handlePromoteEventWaitlistPost,
} from "./routes/events/registration.js";
import {
  handleEventPrizesGet,
  handleEventPrizesPost,
  handleReceiveEventPrizePost,
} from "./routes/events/prizes.js";
import {
  handleCreateEventPartnerInvitePost,
  handlePreviewEventPartnerInvitePost,
} from "./routes/events/invitations.js";
import { handleCancelEventRegistrationPost } from "./routes/events/withdrawal.js";
import { handleCancelEventPost } from "./routes/events/cancellation.js";
import {
  handleFinishEventPost,
  handleNextEventRoundPost,
  handleCorrectEventPairingsPost,
  handleEventCheckInPost,
  handleScoreEventPost,
  handleCorrectEventPost,
} from "./routes/events/competition.js";
import {
  handleTrainingProductsGet,
  handleTrainingProductsPost,
  handleTrainingClassesPost,
} from "./routes/training/catalog.js";
import {
  handleTrainingStudentsGet,
  handleTrainingAdminStudentsGet,
  handleTrainingStudentsPost,
  handleTrainingStudentPatch,
} from "./routes/training/students.js";
import {
  handleTrainingEnrollmentsAny,
  handleTrainingAdminEnrollmentsAny,
  handleTrainingPurchaseAny,
} from "./routes/training/enrollments.js";
import {
  handleTrainingSessionsGet,
  handleTrainingSessionsPost,
  handleCompleteSessionPost,
} from "./routes/training/schedule.js";
import {
  handleAttendancePost,
  handleMakeupPost,
} from "./routes/training/attendance.js";
import {
  handleConsumePost,
  handleConfirmConsumePost,
} from "./routes/training/consumption.js";
import {
  handleTrainingConsumeCorrectionsGet,
  handleTrainingConsumeCorrectionsPost,
  handleTrainingCorrectionDecisionPost,
} from "./routes/training/corrections.js";
import {
  handleMembersMeAccountsTransactionsAny,
  handleMembersAccountAdjustmentsGet,
  handleAccountAdjustmentCreatePost,
  handleAccountAdjustmentReviewPost,
  handleMemberAccountTransactionsGet,
} from "./routes/members/accounts.js";
import {
  handleReferralsMeInvitesPost,
  handleReferralsMeRewardsAny,
  handleReferralsRewardsGrantMaturedPost,
} from "./routes/referrals.js";
import {
  handleMembersMeReferrerPost,
  handleMember360Get,
  handleMembersAny,
} from "./routes/members/directory.js";
import {
  handleAllianceMerchantsPost,
  handleMerchantStatusPost,
  handleAllianceMerchantsAny,
} from "./routes/alliance/merchants.js";
import {
  handleAllianceCouponTemplatesGet,
  handleAllianceCouponTemplatesPost,
  handleTemplateStatusPost,
  handleGenerateCodesPost,
} from "./routes/alliance/templates.js";
import {
  handleAllianceCouponsMeAny,
  handleClaimCouponPost,
  handleAllianceCouponsRedeemPost,
  handleCouponQrGet,
} from "./routes/alliance/coupons.js";
import {
  handleMembershipsProductsGet,
  handleMembershipsProductsManageGet,
  handleMembershipsProductsPost,
  handleMembershipProductVersionPost,
  handleMembershipProductStatusPost,
  handleMembershipsPurchasePost,
} from "./routes/memberships/products.js";
import {
  handleMembershipsRechargePlansGet,
  handleMembershipsRechargePlansManageGet,
  handleMembershipsRechargePlansPost,
  handleRechargePlanStatusPost,
  handleMembershipsRechargePost,
} from "./routes/memberships/recharge.js";
import { handleGoodsAny, handleGoodsOrdersPost } from "./routes/goods.js";
import {
  handleInventoryGet,
  handleInventoryAwardOptionsGet,
  handleInventoryLowStockGet,
  handleItemDetailGet,
} from "./routes/inventory/queries.js";
import {
  handleInventoryPost,
  handleItemMasterActionPost,
} from "./routes/inventory/catalog.js";
import {
  handleInventorySuppliersGet,
  handleInventorySuppliersPost,
  handleSupplierDetailGet,
  handleSupplierMasterActionPost,
} from "./routes/inventory/suppliers.js";
import {
  handleInventoryLocationsGet,
  handleInventoryLocationsPost,
  handleLocationDetailGet,
  handleLocationMasterActionPost,
} from "./routes/inventory/locations.js";
import {
  handleInventoryPurchaseOrdersGet,
  handleInventoryPurchaseOrdersPost,
  handlePurchaseActionPost,
} from "./routes/inventory/purchasing.js";
import {
  handleInventoryStocktakesGet,
  handleInventoryStocktakesPost,
  handleStocktakeCountPost,
  handleStocktakeActionPost,
} from "./routes/inventory/stocktaking.js";
import {
  handleInventoryOperationsGet,
  handleInventoryOperationsPost,
  handleOperationActionPost,
} from "./routes/inventory/movements.js";
import { handleInventoryPost2 } from "./routes/inventory/transactions.js";
import {
  handleMembersLeadsOwnersGet,
  handleMembersLeadsGet,
  handleMembersLeadsPost,
  handleLeadActionPost,
} from "./routes/members/leads.js";
import { handleDashboardAny } from "./routes/dashboard.js";
import {
  handleTrainingFinancialSummaryAny,
  handleTrainingSettlementsGet,
  handleTrainingSettlementsPost,
  handleTrainingSettlementActionPost,
} from "./routes/training/settlements.js";
import {
  handleAllianceSettlementsPost,
  handleAllianceSettlementsGet,
  handleSettlementActionPost,
} from "./routes/alliance/settlements.js";
import {
  handleVenueCheckInPost,
  handleVenueFulfillmentPost,
} from "./routes/venues/fulfillment.js";

const domainRoutes = [
  handleParametersGet,
  handleParametersPost,
  handleAuditLogsGet,
  handleGovernanceUsersGet,
  handleGovernanceRolesPost,
  handleGovernanceStatusPost,
  handlePrivacyErasureRequestsMeGet,
  handlePrivacyErasureRequestsPost,
  handleErasureCancelPost,
  handlePrivacyErasureRequestsGet,
  handleErasureBlockersGet,
  handleErasureDecisionPost,
  handleGovernanceRiskEventsGet,
  handleRiskActionPost,
  handleOperationsShiftsCurrentGet,
  handleOperationsShiftsHistoryGet,
  handleOperationsShiftsOpenPost,
  handleCloseFrontDeskShiftPost,
  handleReviewFrontDeskVariancePost,
  handleReconciliationGetGet,
  handleReconciliationClosePost,
  handleWorkItemsAny,
  handleVenuesClosuresGet,
  handleVenuesClosuresPost,
  handleCancelVenueClosurePost,
  handleVenuesTimeSlotsManageGet,
  handleVenuesPriceRulesManageGet,
  handleVenuesPriceRulesPost,
  handlePriceRuleVersionPost,
  handlePriceRuleStatusPost,
  handleVenuesAvailabilityAny,
  handleVenuesBookingsPost,
  handleOrdersAny,
  handleOrdersAdminAllAny,
  handleOptionsGet,
  handleOrderDetailGet,
  handleCancelPendingOrderPost,
  handlePayPost,
  handleRefundPost,
  handleApproveRefundPost,
  handleRejectRefundPost,
  handleGamesPost,
  handleGamesGet,
  handleGamesManagedGet,
  handleGamesHostsApplyPost,
  handleGamesHostApplicationsGet,
  handleGameDetailGet,
  handleReviewHostPost,
  handlePublishGamePost,
  handleRegisterGamePost,
  handlePromoteGameWaitlistPost,
  handleGamesRewardsGrantMaturedPost,
  handleCancelGamePost,
  handleCompleteGamePost,
  handleEventsPost,
  handleEventsGet,
  handleEventsManagedGet,
  handleManagedEventDetailGet,
  handleMyEventRegistrationGet,
  handleEventDetailGet,
  handleEventPrizesGet,
  handleEventPrizesPost,
  handleReceiveEventPrizePost,
  handleCreateEventPartnerInvitePost,
  handlePreviewEventPartnerInvitePost,
  handleRegisterEventPost,
  handlePromoteEventWaitlistPost,
  handleCancelEventRegistrationPost,
  handleCancelEventPost,
  handlePublishEventPost,
  handleFinishEventPost,
  handleNextEventRoundPost,
  handleCorrectEventPairingsPost,
  handleEventCheckInPost,
  handleScoreEventPost,
  handleCorrectEventPost,
  handleTrainingProductsGet,
  handleTrainingProductsPost,
  handleTrainingClassesPost,
  handleTrainingStudentsGet,
  handleTrainingAdminStudentsGet,
  handleTrainingStudentsPost,
  handleTrainingStudentPatch,
  handleTrainingEnrollmentsAny,
  handleTrainingAdminEnrollmentsAny,
  handleTrainingSessionsGet,
  handleTrainingSessionsPost,
  handleTrainingPurchaseAny,
  handleAttendancePost,
  handleMakeupPost,
  handleConsumePost,
  handleConfirmConsumePost,
  handleTrainingConsumeCorrectionsGet,
  handleTrainingConsumeCorrectionsPost,
  handleTrainingCorrectionDecisionPost,
  handleCompleteSessionPost,
  handleMembersMeAccountsTransactionsAny,
  handleReferralsMeInvitesPost,
  handleMembersMeReferrerPost,
  handleReferralsMeRewardsAny,
  handleReferralsRewardsGrantMaturedPost,
  handleAllianceMerchantsPost,
  handleMerchantStatusPost,
  handleAllianceMerchantsAny,
  handleAllianceCouponTemplatesGet,
  handleAllianceCouponTemplatesPost,
  handleTemplateStatusPost,
  handleGenerateCodesPost,
  handleAllianceCouponsMeAny,
  handleClaimCouponPost,
  handleAllianceCouponsRedeemPost,
  handleCouponQrGet,
  handleMembershipsProductsGet,
  handleMembershipsProductsManageGet,
  handleMembershipsProductsPost,
  handleMembershipProductVersionPost,
  handleMembershipProductStatusPost,
  handleMembershipsRechargePlansGet,
  handleMembershipsRechargePlansManageGet,
  handleMembershipsRechargePlansPost,
  handleRechargePlanStatusPost,
  handleMembershipsPurchasePost,
  handleMembershipsRechargePost,
  handleGoodsAny,
  handleInventoryGet,
  handleInventoryAwardOptionsGet,
  handleInventoryLowStockGet,
  handleInventoryPost,
  handleItemDetailGet,
  handleItemMasterActionPost,
  handleInventorySuppliersGet,
  handleInventorySuppliersPost,
  handleSupplierDetailGet,
  handleSupplierMasterActionPost,
  handleInventoryLocationsGet,
  handleInventoryLocationsPost,
  handleLocationDetailGet,
  handleLocationMasterActionPost,
  handleInventoryPurchaseOrdersGet,
  handleInventoryPurchaseOrdersPost,
  handlePurchaseActionPost,
  handleInventoryStocktakesGet,
  handleInventoryStocktakesPost,
  handleStocktakeCountPost,
  handleStocktakeActionPost,
  handleInventoryOperationsGet,
  handleInventoryOperationsPost,
  handleOperationActionPost,
  handleGoodsOrdersPost,
  handleInventoryPost2,
  handleMembersAccountAdjustmentsGet,
  handleAccountAdjustmentCreatePost,
  handleAccountAdjustmentReviewPost,
  handleMemberAccountTransactionsGet,
  handleMember360Get,
  handleMembersLeadsOwnersGet,
  handleMembersLeadsGet,
  handleMembersLeadsPost,
  handleLeadActionPost,
  handleMembersAny,
  handleDashboardAny,
  handleTrainingFinancialSummaryAny,
  handleTrainingSettlementsGet,
  handleTrainingSettlementsPost,
  handleTrainingSettlementActionPost,
  handleAllianceSettlementsPost,
  handleAllianceSettlementsGet,
  handleSettlementActionPost,
  handleVenueCheckInPost,
  handleVenueFulfillmentPost,
  handleGameCheckInPost,
];

export async function mockRequest<T>(
  method: string,
  url: string,
  data: any = {},
  options: MockRouteOptions = {},
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  options.beforeHandle?.();
  expireMockPurchases();
  if (url === "/auth/wechat-login")
    return ok(mockLogin("MEMBER", options.persistLoginToken));
  if (url === "/auth/dev-login")
    return ok(
      mockLogin((data.role || "MEMBER") as AppRole, options.persistLoginToken),
    );
  if (url === "/auth/me") return ok(mockUser());
  if (url === "/auth/profile" && method === "PATCH") {
    const displayName = text(data.displayName);
    if (!displayName || displayName.length > 40)
      throw new Error("微信昵称需为1-40个字符");
    return ok(updateMockProfile(displayName));
  }
  const trainingOperation = routeMockTrainingOperations(method, url, data);
  const teamInviteOperation = routeMockTeamInvites(method, url, data);
  if (teamInviteOperation.handled) return ok(teamInviteOperation.value);
  if (trainingOperation.handled) return ok(trainingOperation.value);
  const consignmentOperation = routeMockConsignmentSettlement(
    method,
    url,
    data,
  );
  if (consignmentOperation.handled) return ok(consignmentOperation.value);
  for (const route of domainRoutes) {
    const result = await route(method, url, data, options);
    if (result.handled) return result.value as T;
  }
  throw new Error(`模拟接口尚未实现：${method} ${url}`);
}
