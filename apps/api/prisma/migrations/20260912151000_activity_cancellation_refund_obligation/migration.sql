ALTER TABLE "Refund" ADD COLUMN "cancellationRequired" BOOLEAN NOT NULL DEFAULT false;

-- Preserve existing request identities while making outstanding cancellation
-- refunds mandatory. Rejected historical refunds need separate reconciliation.
UPDATE "Refund" r SET "cancellationRequired" = true
WHERE r.status IN ('REQUESTED', 'APPROVED', 'PROCESSING') AND (
  EXISTS (SELECT 1 FROM "GameRegistration" gr JOIN "Game" g ON g.id = gr."gameId"
          WHERE gr."orderId" = r."orderId" AND g.status = 'CANCELLED')
  OR EXISTS (SELECT 1 FROM "EventTeam" et JOIN "Event" e ON e.id = et."eventId"
             WHERE et."orderId" = r."orderId" AND e.status = 'CANCELLED')
);
