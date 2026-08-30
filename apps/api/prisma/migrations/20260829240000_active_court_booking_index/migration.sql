-- A cancelled booking is historical evidence, not an active reservation.
-- The original schema used a regular unique index over (court, start, end),
-- which made a cancelled slot impossible to book again.  Replace it with a
-- partial unique index that protects only active rows.  Do not remove or
-- rewrite historical bookings.
DROP INDEX IF EXISTS "CourtBooking_courtId_startsAt_endsAt_key";

CREATE UNIQUE INDEX "CourtBooking_active_slot_key"
  ON "CourtBooking"("courtId", "startsAt", "endsAt")
  WHERE "status" <> 'CANCELLED';
