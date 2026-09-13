-- Cast before multiplication: ordinary monthly totals can overflow int32 * 2000.
-- Keep the contract invariants for both consumption and signed reversals.
ALTER TABLE "TrainingRevenueRecognition"
  DROP CONSTRAINT "TrainingRecognition_contract_invariants",
  ADD CONSTRAINT "TrainingRecognition_contract_invariants" CHECK (
    "contractRateBps" = 2000 AND "venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0 AND
    "venueContributionCents" = ROUND("effectiveRevenueCents"::numeric * 2000 / 10000)
  );

ALTER TABLE "TrainingSettlement"
  DROP CONSTRAINT "TrainingSettlement_contract_invariants",
  ADD CONSTRAINT "TrainingSettlement_contract_invariants" CHECK (
    "contractRateBps" = 2000 AND "venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0 AND
    "venueContributionCents" = ROUND("effectiveRevenueCents"::numeric * 2000 / 10000)
  );
