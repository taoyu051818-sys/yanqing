-- A completed game can produce at most one host reward.  Preserve all
-- existing financial rows: if a deployed database already contains duplicate
-- rewards, stop and require an operator-led reconciliation before enforcing
-- the invariant rather than deleting history in a migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "HostReward"
    GROUP BY "gameId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce HostReward uniqueness: duplicate gameId rows exist; reconcile them first';
  END IF;
END
$$;

DROP INDEX IF EXISTS "HostReward_gameId_idx";

CREATE UNIQUE INDEX "HostReward_gameId_key"
  ON "HostReward"("gameId");
