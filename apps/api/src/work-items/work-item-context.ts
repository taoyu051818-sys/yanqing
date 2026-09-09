import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, Prisma } from '../generated/prisma/client.js';

export type WorkItemKind =
  | 'ACCOUNT_ADJUSTMENT_REVIEW'
  | 'CUSTOMER_LEAD_SLA'
  | 'HOST_APPLICATION_REVIEW'
  | 'DATA_ERASURE_REVIEW'
  | 'REFUND_REVIEW'
  | 'TRAINING_CONSUME_CORRECTION_REVIEW'
  | 'TRAINING_TRIAL_CHECK_IN'
  | 'TRAINING_TRIAL_ASSESSMENT'
  | 'TRAINING_TRIAL_DECISION'
  | 'YOUTH_TRAINING_RULE_REVIEW'
  | 'TRAINING_SESSION_OPERATION'
  | 'TRAINING_ATTENDANCE'
  | 'EVENT_SCORE'
  | 'EVENT_PRIZE_RECEIPT'
  | 'ALLIANCE_SETTLEMENT'
  | 'TRAINING_SETTLEMENT'
  | 'CONSIGNMENT_SETTLEMENT'
  | 'LOW_STOCK'
  | 'GAME_OPERATION'
  | 'ORDER_FULFILLMENT';

export type WorkItemGroup =
  | 'CUSTOMER'
  | 'REFUND'
  | 'TRAINING'
  | 'EVENT'
  | 'ALLIANCE'
  | 'INVENTORY'
  | 'FULFILLMENT'
  | 'RECONCILIATION'
  | 'GOVERNANCE';

export const WORK_ITEM_GROUP_BY_KIND: Record<WorkItemKind, WorkItemGroup> = {
  ACCOUNT_ADJUSTMENT_REVIEW: 'REFUND',
  CUSTOMER_LEAD_SLA: 'CUSTOMER',
  HOST_APPLICATION_REVIEW: 'CUSTOMER',
  DATA_ERASURE_REVIEW: 'GOVERNANCE',
  REFUND_REVIEW: 'REFUND',
  TRAINING_CONSUME_CORRECTION_REVIEW: 'TRAINING',
  TRAINING_TRIAL_CHECK_IN: 'TRAINING',
  TRAINING_TRIAL_ASSESSMENT: 'TRAINING',
  TRAINING_TRIAL_DECISION: 'TRAINING',
  YOUTH_TRAINING_RULE_REVIEW: 'GOVERNANCE',
  TRAINING_SESSION_OPERATION: 'TRAINING',
  TRAINING_ATTENDANCE: 'TRAINING',
  EVENT_SCORE: 'EVENT',
  EVENT_PRIZE_RECEIPT: 'EVENT',
  ALLIANCE_SETTLEMENT: 'RECONCILIATION',
  TRAINING_SETTLEMENT: 'RECONCILIATION',
  CONSIGNMENT_SETTLEMENT: 'RECONCILIATION',
  LOW_STOCK: 'INVENTORY',
  GAME_OPERATION: 'FULFILLMENT',
  ORDER_FULFILLMENT: 'FULFILLMENT',
};

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  /** Server-owned queue classification. Clients must not infer responsibility from title text. */
  group?: WorkItemGroup;
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

export const INTERNAL_ROLES = new Set<AppRole>([
  AppRole.FRONT_DESK,
  AppRole.COACH,
  AppRole.EVENT_MANAGER,
  AppRole.HOST,
  AppRole.MERCHANT,
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]);

export const hasAny = (
  roles: readonly AppRole[],
  allowed: readonly AppRole[],
) => roles.some((role) => allowed.includes(role));
export interface WorkItemContext {
  actor: AuthUser;
  limit: number;
  roles: AppRole[];
  merchantIds: string[] | undefined;
  orderFulfillmentScopes: Prisma.OrderWhereInput[];
  nowDate: Date;
  now: number;
  canReviewMoney: boolean;
  isMerchantOnly: boolean;
  canReviewTrainingConsumes: boolean;
  canOperateTrainingSessions: boolean;
  canOperateEvents: boolean;
  canOperateInventory: boolean;
  canOperateOrders: boolean;
  canOperateGames: boolean;
  canOperateCustomers: boolean;
  canReviewHosts: boolean;
  canReviewErasure: boolean;
  canReviewTrainingCorrections: boolean;
  canReviewAlliance: boolean;
  isOperationsAdmin: boolean;
  canCheckInTrials: boolean;
  canAssessTrials: boolean;
  canDecideTrials: boolean;
  canReviewYouthRules: boolean;
}
