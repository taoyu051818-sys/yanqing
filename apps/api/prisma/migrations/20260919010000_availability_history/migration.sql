-- Dedicated business history; audit JSON is read once during this migration only.
BEGIN;
CREATE TABLE "CourtAvailability" (
  "id" TEXT PRIMARY KEY, "courtId" TEXT NOT NULL REFERENCES "Court"("id") ON DELETE RESTRICT,
  "validFrom" TIMESTAMP(3) NOT NULL, "validTo" TIMESTAMP(3), "enabled" BOOLEAN NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'RECORDED',
  CONSTRAINT "CourtAvailability_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom")
);
CREATE UNIQUE INDEX "CourtAvailability_courtId_validFrom_key" ON "CourtAvailability"("courtId", "validFrom");
CREATE UNIQUE INDEX "CourtAvailability_current" ON "CourtAvailability"("courtId") WHERE "validTo" IS NULL;
CREATE INDEX "CourtAvailability_validFrom_validTo_idx" ON "CourtAvailability"("validFrom", "validTo");
CREATE TABLE "TimeSlotAvailability" (
  "id" TEXT PRIMARY KEY, "timeSlotId" TEXT NOT NULL REFERENCES "TimeSlot"("id") ON DELETE RESTRICT,
  "validFrom" TIMESTAMP(3) NOT NULL, "validTo" TIMESTAMP(3), "enabled" BOOLEAN NOT NULL,
  "label" TEXT NOT NULL, "startMinutes" INTEGER NOT NULL, "endMinutes" INTEGER NOT NULL,
  "period" "SlotPeriod" NOT NULL, "source" TEXT NOT NULL DEFAULT 'RECORDED',
  CONSTRAINT "TimeSlotAvailability_interval" CHECK ("validTo" IS NULL OR "validTo" > "validFrom")
);
CREATE UNIQUE INDEX "TimeSlotAvailability_timeSlotId_validFrom_key" ON "TimeSlotAvailability"("timeSlotId", "validFrom");
CREATE UNIQUE INDEX "TimeSlotAvailability_current" ON "TimeSlotAvailability"("timeSlotId") WHERE "validTo" IS NULL;
CREATE INDEX "TimeSlotAvailability_validFrom_validTo_idx" ON "TimeSlotAvailability"("validFrom", "validTo");
-- Prevent writers racing the backfill/trigger installation.
LOCK TABLE "Court", "TimeSlot", "SystemParameter", "AuditLog" IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION pg_temp.history_time(value TEXT, fallback TIMESTAMP) RETURNS TIMESTAMP LANGUAGE plpgsql AS $$
BEGIN RETURN COALESCE(value::timestamptz AT TIME ZONE 'UTC', fallback);
EXCEPTION WHEN OTHERS THEN RETURN fallback; END $$;
WITH changes AS (
  SELECT c."id" AS "courtId", a."id", a."createdAt",
    GREATEST(c."createdAt", pg_temp.history_time(COALESCE(a."newValue"->>'deletedAt', a."newValue"->>'updatedAt'), a."createdAt")) AS at,
    (a."oldValue"->>'enabled')::boolean AS before,
    (a."newValue"->>'enabled')::boolean AS enabled
  FROM "Court" c JOIN "AuditLog" a ON a."objectId"=c."id" AND a."objectType"='Court'
  WHERE a."action" IN ('COURT_UPDATED','COURT_DELETED') AND a."result"='SUCCESS'
    AND jsonb_typeof(a."oldValue"->'enabled')='boolean' AND jsonb_typeof(a."newValue"->'enabled')='boolean'
), candidates AS (
  SELECT c."id" AS "courtId", c."createdAt" AS at,
    COALESCE((SELECT before FROM changes h WHERE h."courtId"=c."id" ORDER BY at, "createdAt", "id" LIMIT 1), c.enabled AND c."deletedAt" IS NULL) AS enabled,
    0 AS priority, c."id" AS tie, 'BASELINE'::text AS source FROM "Court" c
  UNION ALL SELECT "courtId", at, enabled, 1, "id", 'IMPORTED' FROM changes
  UNION ALL SELECT "id", GREATEST("createdAt", COALESCE("deletedAt", "updatedAt")), enabled AND "deletedAt" IS NULL, 2, "id", 'BASELINE' FROM "Court"
), distinct_states AS (
  SELECT DISTINCT ON ("courtId", at) * FROM candidates ORDER BY "courtId", at, priority DESC, tie DESC
), periods AS (
  SELECT *, LEAD(at) OVER (PARTITION BY "courtId" ORDER BY at) AS until FROM distinct_states
)
INSERT INTO "CourtAvailability" (id,"courtId","validFrom","validTo",enabled,source)
SELECT 'import-court-' || md5("courtId" || at::text), "courtId", at, until, enabled, source FROM periods;

-- Recover historical hours from immutable parameter versions and the first
-- settings audit's prior hours. Unknown earlier configuration is marked BASELINE.
WITH configs AS (
  SELECT p."effectiveFrom" AS at, p."id", p.value
  FROM "SystemParameter" p WHERE p.key='venue.public-settings'
    AND jsonb_typeof(p.value->'opensAtHour')='number' AND jsonb_typeof(p.value->'closesAtHour')='number'
), original AS (
  SELECT a."oldValue" AS value FROM "AuditLog" a
  WHERE a.action='VENUE_SETTINGS_UPDATED' AND a.result='SUCCESS'
    AND jsonb_typeof(a."oldValue"->'opensAtHour')='number' AND jsonb_typeof(a."oldValue"->'closesAtHour')='number'
  ORDER BY a."createdAt", a.id LIMIT 1
), candidates AS (
  SELECT t.id AS "timeSlotId", t."createdAt" AS at, 0 AS priority, t.id AS tie,
    COALESCE((SELECT t."startMinutes">=(c.value->>'opensAtHour')::numeric*60 AND t."endMinutes"<=(c.value->>'closesAtHour')::numeric*60 FROM configs c WHERE c.at<=t."createdAt" ORDER BY c.at DESC LIMIT 1),
      (SELECT t."startMinutes">=(o.value->>'opensAtHour')::numeric*60 AND t."endMinutes"<=(o.value->>'closesAtHour')::numeric*60 FROM original o), t.enabled) AS enabled,
    'BASELINE'::text AS source FROM "TimeSlot" t
  UNION ALL
  SELECT t.id, c.at, 1, c.id,
    t."startMinutes">=(c.value->>'opensAtHour')::numeric*60 AND t."endMinutes"<=(c.value->>'closesAtHour')::numeric*60,
    'IMPORTED' FROM "TimeSlot" t JOIN configs c ON c.at>t."createdAt"
  UNION ALL SELECT id, GREATEST("createdAt","updatedAt"), 2, id, enabled, 'BASELINE' FROM "TimeSlot"
), distinct_states AS (
  SELECT DISTINCT ON ("timeSlotId",at) * FROM candidates ORDER BY "timeSlotId",at,priority DESC,tie DESC
), periods AS (
  SELECT *, LEAD(at) OVER(PARTITION BY "timeSlotId" ORDER BY at) AS until FROM distinct_states
)
INSERT INTO "TimeSlotAvailability" (id,"timeSlotId","validFrom","validTo",enabled,label,"startMinutes","endMinutes",period,source)
SELECT 'import-slot-' || md5(p."timeSlotId" || p.at::text), p."timeSlotId", p.at, p.until, p.enabled, t.label, t."startMinutes",t."endMinutes",t.period,p.source
FROM periods p JOIN "TimeSlot" t ON t.id=p."timeSlotId";

-- Triggers guarantee history and current state commit/rollback together for
-- every writer, including seed scripts and direct SQL maintenance.
CREATE FUNCTION record_court_availability() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE at TIMESTAMP(3); previous TIMESTAMP(3);
BEGIN
  IF TG_OP='UPDATE' AND NEW.enabled IS NOT DISTINCT FROM OLD.enabled AND NEW."deletedAt" IS NOT DISTINCT FROM OLD."deletedAt" THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN at:=NEW."createdAt";
  ELSE
    SELECT "validFrom" INTO previous FROM "CourtAvailability" WHERE "courtId"=NEW.id AND "validTo" IS NULL;
    at:=GREATEST(CASE WHEN NEW."updatedAt" IS DISTINCT FROM OLD."updatedAt" THEN NEW."updatedAt" ELSE clock_timestamp() AT TIME ZONE 'UTC' END, previous + INTERVAL '1 millisecond');
    UPDATE "CourtAvailability" SET "validTo"=at WHERE "courtId"=NEW.id AND "validTo" IS NULL;
  END IF;
  INSERT INTO "CourtAvailability" (id,"courtId","validFrom",enabled)
  VALUES ('court-' || md5(NEW.id || at::text),NEW.id,at,NEW.enabled AND NEW."deletedAt" IS NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER court_availability_history AFTER INSERT OR UPDATE OF enabled,"deletedAt" ON "Court" FOR EACH ROW EXECUTE FUNCTION record_court_availability();
CREATE FUNCTION record_slot_availability() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE at TIMESTAMP(3); previous TIMESTAMP(3);
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.enabled,NEW.label,NEW."startMinutes",NEW."endMinutes",NEW.period) IS NOT DISTINCT FROM ROW(OLD.enabled,OLD.label,OLD."startMinutes",OLD."endMinutes",OLD.period) THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN at:=NEW."createdAt";
  ELSE
    SELECT "validFrom" INTO previous FROM "TimeSlotAvailability" WHERE "timeSlotId"=NEW.id AND "validTo" IS NULL;
    at:=GREATEST(CASE WHEN NEW."updatedAt" IS DISTINCT FROM OLD."updatedAt" THEN NEW."updatedAt" ELSE clock_timestamp() AT TIME ZONE 'UTC' END, previous + INTERVAL '1 millisecond');
    UPDATE "TimeSlotAvailability" SET "validTo"=at WHERE "timeSlotId"=NEW.id AND "validTo" IS NULL;
  END IF;
  INSERT INTO "TimeSlotAvailability" (id,"timeSlotId","validFrom",enabled,label,"startMinutes","endMinutes",period)
  VALUES ('slot-' || md5(NEW.id || at::text),NEW.id,at,NEW.enabled,NEW.label,NEW."startMinutes",NEW."endMinutes",NEW.period);
  RETURN NEW;
END $$;
CREATE TRIGGER slot_availability_history AFTER INSERT OR UPDATE OF enabled,label,"startMinutes","endMinutes",period ON "TimeSlot" FOR EACH ROW EXECUTE FUNCTION record_slot_availability();
COMMIT;
