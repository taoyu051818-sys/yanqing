/** Member coupon projection, excluding private merchant contacts and settlement data. */
export interface MemberCouponView<D = string> {
  id: string;
  code: string;
  status: string;
  expiresAt: D;
  template: {
    id: string;
    code: string;
    name: string;
    benefitDescription: string;
    faceValueCents: number;
    allowVenueBooking: boolean;
    enabled: boolean;
    validFrom: D;
    validTo: D;
    merchant: { id: string; name: string; status: string };
  };
  bookingUsage: { eligible: boolean; reason: string; label: string };
}
