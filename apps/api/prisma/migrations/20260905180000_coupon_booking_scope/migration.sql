-- Existing merchant vouchers no longer discount venue bookings (product decision).
-- NEWCOMER vouchers use their dedicated experience-price policy, not face value.
ALTER TABLE "CouponTemplate" ADD COLUMN "allowVenueBooking" BOOLEAN NOT NULL DEFAULT false;
