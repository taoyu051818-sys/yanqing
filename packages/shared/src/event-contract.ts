/** Public event data deliberately excludes private participant contact details. */
export interface PublicEventView<D = string> {
  id: string;
  code: string;
  name: string;
  status: "DRAFT" | "OPEN" | "FULL" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  startsAt: D;
  registrationEndsAt: D;
  capacityPeople: number;
  minimumPeople: number;
  totalRounds: number;
  currentRound: number;
  feeCents: number;
  memberFeeCents: number | null;
  sponsor: string | null;
  occupiedTeams: number;
  remainingTeams: number;
}

export interface PublicEventDetail<D = string> extends PublicEventView<D> {
  standings: Array<{
    name: string;
    category: "MEN_DOUBLES" | "WOMEN_DOUBLES" | "MIXED_DOUBLES";
    points: number;
    wins: number;
    losses: number;
    scoreDiff: number;
    finalRank: number | null;
  }>;
}
