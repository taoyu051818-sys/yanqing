export interface CourtAvailability<D = string> {
  date: string;
  courts: Array<{ id: string; name: string; usage: string; enabled: boolean }>;
  slots: Array<{
    id: string;
    label: string;
    startMinutes: number;
    endMinutes: number;
    period?: "EARLY" | "DAYTIME" | "PRIME";
    enabled: boolean;
    price?: { priceCents: number; newcomerPriceCents?: number | null };
  }>;
  bookings: Array<{
    courtId: string;
    startsAt: D;
    endsAt: D;
    status: string;
    usage: string;
  }>;
  closures: Array<{
    courtId: string;
    startsAt: D;
    endsAt: D;
    status: "ACTIVE" | "CANCELLED";
  }>;
}
