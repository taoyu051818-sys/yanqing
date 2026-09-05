-- The venue operating share is an effective-dated administrator parameter.
-- Recharge remains a liability/prepayment and is deliberately outside this
-- rate; each revenue-producing order snapshots the effective version.

INSERT INTO "SystemParameter" (
  "id",
  "key",
  "value",
  "type",
  "description",
  "locked",
  "effectiveFrom",
  "effectiveTo",
  "createdById",
  "createdAt"
)
VALUES (
  'system-parameter-operating-share-20260101',
  'finance.operating_share_rate_bps',
  '1500'::jsonb,
  'INTEGER',
  '按已履约净收入计提的经营分成比例',
  false,
  '2026-01-01T00:00:00+08:00'::timestamptz,
  NULL,
  NULL,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key", "effectiveFrom") DO NOTHING;

ALTER TABLE "SystemParameter"
  ADD CONSTRAINT "SystemParameter_operating_share_rate_check"
  CHECK (
    CASE
      WHEN "key" = 'finance.operating_share_rate_bps' THEN
        "type" = 'INTEGER'
        AND jsonb_typeof("value") = 'number'
        AND (("value" #>> '{}')::numeric BETWEEN 0 AND 10000)
        AND (("value" #>> '{}')::numeric = trunc(("value" #>> '{}')::numeric))
      ELSE true
    END
  );
