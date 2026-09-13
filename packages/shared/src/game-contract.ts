import type { OrderStatus } from "./order-contract.js";

export type GameStatus =
  "DRAFT" | "OPEN" | "FULL" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type GameLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "MIXED";
export type GameRegistrationStatus =
  | "WAITLISTED"
  | "REGISTERED"
  | "PAID"
  | "CHECKED_IN"
  | "NO_SHOW"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";

/** Public fields only. Dates are Date in API projections and ISO strings over HTTP. */
export interface GameSummary<D = string> {
  id: string;
  title: string;
  level: GameLevel;
  status: GameStatus;
  startsAt: D;
  endsAt: D | null;
  capacity: number;
  feeCents: number;
  newcomerOnly: boolean;
  description: string | null;
  host: { displayName: string; avatarUrl: string | null } | null;
}

/** Authenticated list: the registration belongs only to the current member. */
export interface GameListItem<D = string> extends GameSummary<D> {
  _count: { registrations: number };
  myRegistration: {
    id: string;
    status: GameRegistrationStatus;
    orderStatus: OrderStatus | null;
  } | null;
}

/** Anonymous share entry contains counts, not members or order identifiers. */
export interface GameDetail<D = string> extends GameSummary<D> {
  courtNames: string[];
  occupiedCount: number;
  confirmedCount: number;
  pendingCount: number;
  waitlistCount: number;
}

export interface GameParticipants {
  participants: Array<{
    displayName: string;
    avatarUrl: string | null;
    isMe: boolean;
  }>;
  myRegistration: {
    id: string;
    status: GameRegistrationStatus;
    order: { id: string; status: OrderStatus } | null;
    waitlistPosition: number | null;
  } | null;
}
