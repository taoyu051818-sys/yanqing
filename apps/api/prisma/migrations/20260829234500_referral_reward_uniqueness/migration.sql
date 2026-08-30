-- Enforce the business invariant that a member can receive at most one
-- reward for each referral trigger type (for example FIRST_PAYMENT).
--
-- Do not silently delete or merge existing financial rows.  If an already
-- deployed database contains duplicates, stop the migration and require an
-- operator-led reconciliation before adding the constraint.  This preserves
-- the immutable reward/audit history and makes a bad migration impossible to
-- hide behind a destructive cleanup.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ReferralReward"
    GROUP BY "newUserId", "triggerType"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce ReferralReward uniqueness: duplicate (newUserId, triggerType) rows exist; reconcile them first';
  END IF;
END
$$;

DROP INDEX IF EXISTS "ReferralReward_newUserId_triggerType_triggerOrderId_key";

CREATE UNIQUE INDEX "ReferralReward_newUserId_triggerType_key"
  ON "ReferralReward"("newUserId", "triggerType");
