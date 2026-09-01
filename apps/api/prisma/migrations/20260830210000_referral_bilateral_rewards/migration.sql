-- A direct-referral conversion rewards both participants. Existing pending
-- rows keep their historical referrer-only contract; newly created rows store
-- the new member's independently configurable amount in the same atomic event.
ALTER TABLE "ReferralReward"
  ADD COLUMN "newUserRewardValue" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ReferralReward"
  ADD CONSTRAINT "ReferralReward_newUserRewardValue_nonnegative"
  CHECK ("newUserRewardValue" >= 0);

ALTER TABLE "ReferralReward"
  ADD CONSTRAINT "ReferralReward_rewardValue_nonnegative"
  CHECK ("rewardValue" >= 0);
