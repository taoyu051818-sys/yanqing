export interface MockVenueMember {
  id: string;
  displayName: string;
  phone?: string;
  status?: "ACTIVE";
  level?: string;
  memberProfile?: Record<string, unknown>;
}

export const MOCK_ACTIVE_MEMBERS: MockVenueMember[] = [
  {
    id: "member-1",
    displayName: "延庆会员小林",
    phone: "13800000005",
    status: "ACTIVE",
    level: "GOLD",
    memberProfile: { level: "GOLD" },
  },
  {
    id: "member-2",
    displayName: "羽友小周",
    phone: "13800000007",
    status: "ACTIVE",
    level: "REGULAR",
    memberProfile: { level: "REGULAR" },
  },
];

export const venueClosureView = (closure: any) => ({
  id: closure.id,
  courtId: closure.courtId,
  startsAt: closure.startsAt,
  endsAt: closure.endsAt,
  reason: closure.reason,
  status: closure.status,
  cancelledAt: closure.cancelledAt || null,
  cancelReason: closure.cancelReason || null,
  court: closure.court
    ? {
        id: closure.court.id,
        code: closure.court.code,
        name: closure.court.name,
        enabled: closure.court.enabled,
      }
    : undefined,
  createdBy: closure.createdBy
    ? { displayName: closure.createdBy.displayName }
    : null,
  cancelledBy: closure.cancelledBy
    ? { displayName: closure.cancelledBy.displayName }
    : null,
  createdAt: closure.createdAt,
  updatedAt: closure.updatedAt,
});

export const startsAtDate = (date: string, minutes: number) => {
  return new Date(
    new Date(`${date}T00:00:00+08:00`).getTime() + minutes * 60_000,
  );
};
