/**
 * The operator queue is intentionally a small, transport-level contract.
 * Keep optional fields so older APIs and the local mock can be consumed while
 * the server rolls out additional work-item metadata (for example group or
 * category). The page still treats the server response as the source of truth.
 */
export interface WorkItem {
  id: string;
  kind?: string;
  group?: string;
  category?: string;
  objectType?: string;
  objectId?: string;
  status?: string;
  priority?: number;
  title?: string;
  description?: string;
  ownerRoles?: string[];
  createdAt?: string;
  dueAt?: string;
  amountCents?: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationPeriod {
  id?: string;
  businessDate: string;
  status: "OPEN" | "REVIEW" | "LOCKED" | string;
  totals: Record<string, number>;
  exceptionCount: number;
  closedById?: string | null;
  closedAt?: string | null;
  detail?: Record<string, unknown>;
  blocked?: boolean;
  blockers?: Array<{ kind: string; count: number; message: string }>;
}

export interface CreateVenueBookingCommand {
  overrideReason?: string;
  memberId?: string;
  date: string;
  courtId: string;
  slotId: string;
  sourceChannel: string;
  couponCode?: string;
  creationIdempotencyKey?: string;
}

export interface VenueClosure {
  id: string;
  courtId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: "ACTIVE" | "CANCELLED";
  creationIdempotencyKey: string;
  createdById: string;
  cancelledById?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  court?: { id: string; code?: string; name: string; enabled?: boolean };
  createdBy?: { id: string; displayName: string };
  cancelledBy?: { id: string; displayName: string } | null;
}
