-- Maker/checker is now a role-dependent application policy: ADMIN and
-- SUPER_ADMIN can act on their own document; FINANCE retains separation.
-- A row CHECK cannot express that authorization. Keep amount, snapshot,
-- state/evidence, uniqueness and foreign-key constraints intact.
ALTER TABLE "ConsignmentSettlement"
  DROP CONSTRAINT "ConsignmentSettlement_maker_checker_check";
ALTER TABLE "YouthTrainingRule"
  DROP CONSTRAINT "YouthTrainingRule_maker_checker_check";
