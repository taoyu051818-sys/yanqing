export type EventStatus =
  "DRAFT" | "OPEN" | "FULL" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type MatchStatus =
  "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "CONFIRMED" | "CORRECTED";

export interface EventSummary {
  id: string;
  code?: string;
  name: string;
  status: EventStatus;
  startsAt?: string;
  minimumPeople?: number;
  capacityPeople?: number;
  totalRounds?: number;
  currentRound?: number;
  _count?: { teams?: number };
}

export interface EventTeam {
  id: string;
  name: string;
  playerAName: string;
  playerBName: string;
  playerAPhone?: string | null;
  playerBPhone?: string | null;
  captainPlays?: boolean;
  status: string;
  category?: string;
  points?: number;
  wins?: number;
  losses?: number;
  scoreDiff?: number;
  finalRank?: number | null;
  paymentDueAt?: string | null;
  waitlistedAt?: string | null;
  cancelReason?: string | null;
  cancelRequestedAt?: string | null;
  cancellationPending?: boolean;
  cancellationResolvedAt?: string | null;
  order?: { status?: string } | null;
}

export interface EventMatch {
  id: string;
  round: number;
  courtLabel?: string | null;
  teamAId: string;
  teamBId: string | null;
  startingScoreA: number;
  startingScoreB: number;
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  correctionReason?: string | null;
}

export interface EventDetail extends EventSummary {
  teams?: EventTeam[];
  matches?: EventMatch[];
  prizePool?: Record<string, unknown> | null;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  stock: number;
  enabled?: boolean;
}

export interface EventPrizeAward {
  id: string;
  awardName: string;
  finalRank: number;
  recipientNames: string[];
  quantity: number;
  status: "ISSUED" | "RECEIVED";
  receivedByName?: string | null;
  team?: { id: string; name: string; finalRank?: number };
  inventoryItem?: { id: string; sku: string; name: string };
  operator?: { displayName: string };
  signedBy?: { displayName: string } | null;
}
