export type JsonRecord = Record<string, any>;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const KEYS = {
  orders: "yanqing_mock_orders",
  games: "yanqing_mock_games",
  events: "yanqing_mock_events",
  eventDetails: "yanqing_mock_event_details",
  eventPartnerInvites: "yanqing_mock_event_partner_invites",
  enrollments: "yanqing_mock_enrollments",
  students: "yanqing_mock_students",
  trainingSessions: "yanqing_mock_training_sessions",
  trainingProducts: "yanqing_mock_training_products",
  trainingCreationCommands: "yanqing_mock_training_creation_commands",
  trainingTrials: "yanqing_mock_training_trials",
  youthTrainingRules: "yanqing_mock_youth_training_rules",
  merchants: "yanqing_mock_merchants",
  coupons: "yanqing_mock_coupons",
  couponTemplates: "yanqing_mock_coupon_templates",
  goods: "yanqing_mock_goods",
  inventoryTransactions: "yanqing_mock_inventory_transactions",
  inventorySuppliers: "yanqing_mock_inventory_suppliers",
  inventoryLocations: "yanqing_mock_inventory_locations",
  inventoryBalances: "yanqing_mock_inventory_balances",
  purchaseOrders: "yanqing_mock_purchase_orders",
  stocktakes: "yanqing_mock_stocktakes",
  inventoryOperations: "yanqing_mock_inventory_operations",
  settlements: "yanqing_mock_settlements",
  reconciliationPeriods: "yanqing_mock_reconciliation_periods",
  venueBookings: "yanqing_mock_venue_bookings",
  venueClosures: "yanqing_mock_venue_closures",
  customerLeads: "yanqing_mock_customer_leads",
  hostApplications: "yanqing_mock_host_applications",
  orderCreations: "yanqing_mock_order_creations",
  rechargePlans: "yanqing_mock_recharge_plans",
  membershipProducts: "yanqing_mock_membership_products",
  priceRules: "yanqing_mock_price_rules",
  memberAccounts: "yanqing_mock_member_accounts",
  memberAccountTransactions: "yanqing_mock_member_account_transactions",
  accountAdjustmentRequests: "yanqing_mock_account_adjustment_requests",
  frontDeskShifts: "yanqing_mock_front_desk_shifts",
  trainingConsumeCorrections: "yanqing_mock_training_consume_corrections",
  trainingSettlements: "yanqing_mock_training_settlements",
  consignmentPayableEntries: "yanqing_mock_consignment_payable_entries",
  consignmentSettlements: "yanqing_mock_consignment_settlements",
  governanceUsers: "yanqing_mock_governance_users",
  systemParameters: "yanqing_mock_system_parameters",
  riskEvents: "yanqing_mock_risk_events",
  auditLogs: "yanqing_mock_audit_logs",
  dataErasureRequests: "yanqing_mock_data_erasure_requests",
  referralInvites: "yanqing_mock_referral_invites",
  referralRewards: "yanqing_mock_referral_rewards",
} as const;

export function read<T>(key: string, fallback: T): T {
  const value = uni.getStorageSync(key);
  return value === undefined || value === null || value === ""
    ? clone(fallback)
    : (value as T);
}

export function write<T>(key: string, value: T): T {
  const next = clone(value);
  uni.setStorageSync(key, next);
  return next;
}

export function resetCatalogState() {
  Object.values(KEYS).forEach((key) => uni.removeStorageSync(key));
}
