export const mockDataErasureRequestView = (
  request: any,
  userScope: "none" | "basic" | "admin" = "none",
) => ({
  id: request.id,
  userId: request.userId,
  status: request.status,
  reason: request.reason,
  reviewedById: request.reviewedById ?? null,
  reviewReason: request.reviewReason ?? null,
  requestedAt: request.requestedAt,
  reviewedAt: request.reviewedAt ?? null,
  completedAt: request.completedAt ?? null,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  ...(userScope !== "none" && request.user
    ? {
        user: {
          id: request.user.id,
          displayName: request.user.displayName,
          status: request.user.status,
          ...(userScope === "admin"
            ? { phone: request.user.phone ?? null }
            : {}),
        },
      }
    : {}),
  reviewedBy: request.reviewedBy
    ? {
        id: request.reviewedBy.id,
        displayName: request.reviewedBy.displayName,
      }
    : null,
});
