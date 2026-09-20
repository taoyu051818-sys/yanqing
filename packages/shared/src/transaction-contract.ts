/** Each scope has its own monetary unit; wallet movements are not external revenue. */
export interface LedgerEntry {
  id: string;
  at: string;
  orderId: string | null;
  memberId: string;
  memberName: string;
  operatorName: string | null;
  orderNo: string | null;
  title: string | null;
  channel: string;
  amount: number;
  unit: "CNY" | "COIN" | "POINT";
  reason: string;
  status: string;
}
export interface LedgerSummary {
  channel: string;
  unit: LedgerEntry["unit"];
  count: number;
  incoming: number;
  outgoing: number;
}
export interface LedgerPage {
  items: LedgerEntry[];
  summary: LedgerSummary[];
  nextCursor: string | null;
}
export interface RefundTimelineEntry {
  id: string;
  orderId: string;
  refundNo: string;
  amountCents: number;
  status: string;
  reason: string;
  requestedAt: string;
  completedAt: string | null;
  order: { title: string; orderNo: string; member: { displayName: string } };
}
export interface RefundTimelinePage {
  items: RefundTimelineEntry[];
  total: number;
  nextCursor: string | null;
}
