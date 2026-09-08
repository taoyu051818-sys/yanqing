BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;
-- Abort on ambiguous historical configuration; never discard a paid rule snapshot.
ALTER TABLE "SystemParameter"
  ADD CONSTRAINT "SystemParameter_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "SystemParameter_no_overlap" EXCLUDE USING gist
    (key WITH =, tsrange("effectiveFrom", "effectiveTo", '[)') WITH &&);

ALTER TABLE "TrainingSettlement" ADD COLUMN "settledAt" TIMESTAMP(3);
UPDATE "TrainingSettlement" s SET "settledAt" = (
  SELECT min(l."createdAt") FROM "AuditLog" l
  WHERE l."objectType" = 'TrainingSettlement' AND l."objectId" = s.id
    AND l.action = 'TRAINING_SETTLEMENT_SETTLED' AND l.result = 'SUCCESS'
) WHERE s.status = 'SETTLED';
-- Existing alliance statements already have a settlement timestamp. Recover only
-- a missing timestamp from authoritative workflow evidence, never from updatedAt.
UPDATE "AllianceSettlement" s SET "settledAt" = (
  SELECT min(l."createdAt") FROM "AuditLog" l
  WHERE l."objectType" = 'AllianceSettlement' AND l."objectId" = s.id
    AND l.action = 'ALLIANCE_SETTLEMENT_SETTLED' AND l.result = 'SUCCESS'
) WHERE s.status = 'SETTLED' AND s."settledAt" IS NULL;
ALTER TABLE "TrainingSettlement" ADD CONSTRAINT "TrainingSettlement_posting_time"
  CHECK ((status = 'SETTLED') = ("settledAt" IS NOT NULL));
ALTER TABLE "AllianceSettlement" ADD CONSTRAINT "AllianceSettlement_posting_time"
  CHECK ((status = 'SETTLED') = ("settledAt" IS NOT NULL));
CREATE INDEX "TrainingSettlement_settledAt_idx" ON "TrainingSettlement" ("settledAt");
CREATE INDEX "AllianceSettlement_settledAt_idx" ON "AllianceSettlement" ("settledAt");

ALTER TABLE "RiskEvent" ADD COLUMN handling JSONB;
-- Recover even handling that a previous scan erased. Audits are authoritative;
-- preserve legacy evidence when no corresponding workflow audit is available.
UPDATE "RiskEvent" r SET handling = COALESCE(
  (SELECT jsonb_build_object(
    'lastAction', CASE l.action WHEN 'RISK_EVENT_REVIEWING' THEN 'REVIEW'
      WHEN 'RISK_EVENT_RESOLVED' THEN 'RESOLVE' ELSE 'DISMISS' END,
    'lastReason', l.reason, 'lastActorId', l."actorId",
    'lastActionAt', to_char(l."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   FROM "AuditLog" l WHERE l."objectType" = 'RiskEvent' AND l."objectId" = r.id
     AND l.action IN ('RISK_EVENT_REVIEWING', 'RISK_EVENT_RESOLVED', 'RISK_EVENT_DISMISSED')
     AND l.result = 'SUCCESS' AND l."oldValue"->>'status' IS DISTINCT FROM l."newValue"->>'status'
   ORDER BY l."createdAt" DESC, l.id DESC LIMIT 1),
  CASE WHEN jsonb_typeof(r.evidence) = 'object' AND r.evidence ? 'lastAction'
    THEN jsonb_build_object('lastAction', r.evidence->'lastAction', 'lastReason', r.evidence->'lastReason',
      'lastActorId', r.evidence->'lastActorId', 'lastActionAt', r.evidence->'lastActionAt') END
);
UPDATE "RiskEvent" SET evidence = evidence - ARRAY['lastAction','lastReason','lastActorId','lastActionAt']
  WHERE handling IS NOT NULL AND jsonb_typeof(evidence) = 'object';

COMMIT;
