import type { OrderStatus } from "./order-contract.js";
export type TrainingAudience = "YOUTH" | "ADULT";
export interface TrainingClassSummary {
  id: string;
  name: string;
  capacity: number;
  active: boolean;
  coachId?: string | null;
  assistantId?: string | null;
}
export interface TrainingProductView {
  id: string;
  name: string;
  audience: TrainingAudience;
  totalSessions: number;
  validityDays: number;
  priceCents: number;
  enabled: boolean;
  classes: TrainingClassSummary[];
}
export interface OperationWindow {
  opensAt: string;
  closesAt: string;
  state: "NOT_OPEN" | "OPEN" | "CLOSED";
  mayHistoricallyOverride: boolean;
}
export interface TrainingAttendanceView<D = string> {
  id: string;
  sessionId: string;
  enrollmentId: string;
  status: string;
  consumedSessions: number;
  confirmedRevenueCents: number;
  growthPointsAwarded: number;
  feedback: string | null;
  checkedInAt: D | null;
  consumedAt: D | null;
  session?: {
    id: string;
    classId: string;
    startsAt: D;
    endsAt: D;
    status: string;
  };
  operatorId?: string | null;
  revenueRecognitions?: Array<{
    id: string;
    type: string;
    sequence: number;
    effectiveRevenueCents: number;
    createdAt: D;
    reversedBy: { id: string; type: string; sequence: number } | null;
  }>;
  enrollment?: {
    id: string;
    enrollmentNo: string;
    status: string;
    student: { id: string; displayName: string } | null;
    buyer: { displayName: string };
  };
}
export interface TrainingSessionView<D = string, Hours = string | number> {
  id: string;
  classId: string;
  startsAt: D;
  endsAt: D;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  courtCount: number;
  occupiedCourtHours: Hours;
  note: string | null;
  attendanceWindow: OperationWindow;
  completionWindow: OperationWindow;
  class: TrainingClassSummary & {
    product: { id: string; name: string; audience: TrainingAudience };
  };
  attendances: TrainingAttendanceView<D>[];
}
export interface TrainingEnrollmentView<D = string> {
  id: string;
  enrollmentNo: string;
  contractNo: string | null;
  productId: string;
  classId: string | null;
  studentId: string | null;
  buyerId?: string;
  orderId: string | null;
  totalSessions: number;
  consumedSessions: number;
  totalAmountCents: number;
  prepaidBalanceCents: number;
  confirmedRevenueCents: number;
  refundedCents: number;
  status:
    | "PENDING_PAYMENT"
    | "ACTIVE"
    | "COMPLETED"
    | "PARTIALLY_REFUNDED"
    | "REFUNDED"
    | "CANCELLED";
  seatReservedUntil: D | null;
  startsAt: D;
  expiresAt: D;
  product: Omit<TrainingProductView, "enabled" | "classes">;
  class: TrainingClassSummary | null;
  student: { id: string; displayName: string } | null;
  buyer?: { id: string; displayName: string };
  order: { status: OrderStatus } | null;
  attendances: TrainingAttendanceView<D>[];
  regulatoryWarnings: string[];
}
