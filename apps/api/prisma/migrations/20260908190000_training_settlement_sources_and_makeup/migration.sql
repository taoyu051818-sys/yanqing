BEGIN;
-- Preserve historical statements and evidence; conflicting active financial
-- records must be reconciled explicitly before this migration can proceed.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "TrainingSettlement" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TrainingSettlement" ADD COLUMN "sourceSnapshot" JSONB;
DROP INDEX "TrainingSettlement_periodStart_periodEnd_key";
CREATE UNIQUE INDEX "TrainingSettlement_periodStart_periodEnd_version_key"
  ON "TrainingSettlement"("periodStart", "periodEnd", "version");
ALTER TABLE "TrainingSettlement"
  ADD CONSTRAINT "TrainingSettlement_period_check" CHECK ("periodStart" < "periodEnd" AND "version" > 0),
  ADD CONSTRAINT "TrainingSettlement_no_active_overlap"
    EXCLUDE USING gist (tsrange("periodStart", "periodEnd", '[)') WITH &&)
    WHERE ("status" <> 'VOID');

UPDATE "TrainingSettlement" s SET "sourceSnapshot" = jsonb_build_object(
  'version', 1,
  'recognitions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'effectiveRevenueCents', r."effectiveRevenueCents") ORDER BY r.id) FROM "TrainingRevenueRecognition" r WHERE r."settlementId" = s.id), '[]'::jsonb),
  'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'coachCostCents', c."coachCostCents", 'assistantCostCents', c."assistantCostCents", 'materialCostCents', c."materialCostCents", 'occupiedCourtHours', c."occupiedCourtHours") ORDER BY c.id) FROM "TrainingSession" c WHERE c.status = 'COMPLETED' AND c."startsAt" >= s."periodStart" AND c."startsAt" < s."periodEnd"), '[]'::jsonb)
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "TrainingSettlement" s WHERE s.status <> 'VOID' AND (
    s."effectiveRevenueCents" <> COALESCE((SELECT SUM(r."effectiveRevenueCents") FROM "TrainingRevenueRecognition" r WHERE r."settlementId" = s.id), 0)
    OR s."coachCostCents" <> COALESCE((SELECT SUM(c."coachCostCents") FROM "TrainingSession" c WHERE c.status = 'COMPLETED' AND c."startsAt" >= s."periodStart" AND c."startsAt" < s."periodEnd"), 0)
    OR s."assistantCostCents" <> COALESCE((SELECT SUM(c."assistantCostCents") FROM "TrainingSession" c WHERE c.status = 'COMPLETED' AND c."startsAt" >= s."periodStart" AND c."startsAt" < s."periodEnd"), 0)
    OR s."materialCostCents" <> COALESCE((SELECT SUM(c."materialCostCents") FROM "TrainingSession" c WHERE c.status = 'COMPLETED' AND c."startsAt" >= s."periodStart" AND c."startsAt" < s."periodEnd"), 0)
    OR s."occupiedCourtHours" <> COALESCE((SELECT SUM(c."occupiedCourtHours") FROM "TrainingSession" c WHERE c.status = 'COMPLETED' AND c."startsAt" >= s."periodStart" AND c."startsAt" < s."periodEnd"), 0)
  )) THEN RAISE EXCEPTION 'Training settlement totals differ from sources; reconcile before migrating'; END IF;
END $$;
-- The old association remains in sourceSnapshot even after a VOID releases it.
UPDATE "TrainingRevenueRecognition" r SET "settlementId" = NULL
  FROM "TrainingSettlement" s WHERE r."settlementId" = s.id AND s.status = 'VOID';

ALTER TABLE "TrainingAttendance" ADD COLUMN "makeupTargetId" TEXT;
UPDATE "TrainingAttendance" a SET "makeupTargetId" = (
  SELECT l."newValue" ->> 'targetAttendanceId' FROM "AuditLog" l
  WHERE l."objectId" = a.id AND l."objectType" = 'TrainingAttendance' AND l.action = 'TRAINING_MAKEUP_SCHEDULED'
  ORDER BY l."createdAt" DESC, l.id DESC LIMIT 1
) WHERE a.status = 'MADE_UP';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "TrainingAttendance" a
    LEFT JOIN "TrainingAttendance" t ON t.id = a."makeupTargetId"
    LEFT JOIN "TrainingSession" os ON os.id = a."sessionId"
    LEFT JOIN "TrainingSession" ts ON ts.id = t."sessionId"
    WHERE a.status = 'MADE_UP' AND (t.id IS NULL OR t."enrollmentId" <> a."enrollmentId" OR os."classId" <> ts."classId" OR ts."startsAt" <= os."startsAt"))
  THEN RAISE EXCEPTION 'Legacy makeup relation is missing or inconsistent; reconcile before migrating'; END IF;
END $$;
CREATE UNIQUE INDEX "TrainingAttendance_makeupTargetId_key" ON "TrainingAttendance"("makeupTargetId");
ALTER TABLE "TrainingAttendance"
  ADD CONSTRAINT "TrainingAttendance_makeupTargetId_fkey" FOREIGN KEY ("makeupTargetId") REFERENCES "TrainingAttendance"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TrainingAttendance_makeup_relation_check" CHECK (
    (status = 'MADE_UP') = ("makeupTargetId" IS NOT NULL)
    AND ("makeupTargetId" IS NULL OR "makeupTargetId" <> id)
  );

COMMIT;
