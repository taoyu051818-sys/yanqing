ALTER TABLE "TrainingEnrollment"
ADD COLUMN "seatReservedUntil" TIMESTAMP(3);

-- Give in-flight legacy orders one final grace window after deployment. New
-- orders always receive their hold deadline from the application service.
UPDATE "TrainingEnrollment"
SET "seatReservedUntil" = CURRENT_TIMESTAMP + INTERVAL '15 minutes'
WHERE "status" = 'PENDING_PAYMENT';

CREATE INDEX "TrainingEnrollment_classId_status_seatReservedUntil_idx"
ON "TrainingEnrollment"("classId", "status", "seatReservedUntil");
