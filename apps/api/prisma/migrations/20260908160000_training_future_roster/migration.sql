-- Repair only missing future attendance. Preserve historical attendance and
-- all financial records; running the same repair again is harmless.
INSERT INTO "TrainingAttendance" ("id", "sessionId", "enrollmentId", "createdAt", "updatedAt")
SELECT 'ta_backfill_' || md5(s."id" || ':' || e."id"), s."id", e."id", CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "TrainingEnrollment" e
JOIN "TrainingClass" c ON c."id" = e."classId" AND c."active" = true
JOIN "TrainingSession" s ON s."classId" = c."id"
WHERE e."status" IN ('ACTIVE', 'PARTIALLY_REFUNDED')
  AND e."prepaidBalanceCents" > 0
  AND e."consumedSessions" < e."totalSessions"
  AND s."status" = 'SCHEDULED'
  AND s."startsAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  AND e."startsAt" <= s."startsAt"
  AND e."expiresAt" >= s."endsAt"
  AND s."startsAt" < s."endsAt"
ON CONFLICT ("sessionId", "enrollmentId") DO NOTHING;
