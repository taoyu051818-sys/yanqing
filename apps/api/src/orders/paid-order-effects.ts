import { PaidOrderContext } from './paid-order-context.js';
import {
  assertGamePaymentReady,
  confirmPaidGameRegistration,
} from '../games/registration/game-payment-fulfillment.js';
import {
  assertEventPaymentReady,
  confirmPaidEventTeam,
} from '../events/registration/event-payment-fulfillment.js';
import { confirmPaidCourtBookings } from '../venues/fulfillment/venue-payment-fulfillment.js';
import { activatePaidTrainingEnrollment } from '../training/enrollments/training-payment-fulfillment.js';
import { activatePaidMembership } from '../memberships/purchases/membership-payment-fulfillment.js';
import { creditPaidRecharge } from '../memberships/purchases/recharge-payment-fulfillment.js';
import { issuePaidGoods } from '../inventory/transactions/goods-payment-fulfillment.js';
import { scheduleFirstPaymentRewards } from '../members/referrals/referral-payment-fulfillment.js';
import { redeemPaidOrderCoupon } from '../alliance/coupons/coupon-payment-fulfillment.js';

/** Ordered, synchronous-in-transaction business effects. No separate transactions or retries here. */
export async function assertPaidOrderResources(
  context: PaidOrderContext,
): Promise<void> {
  await assertGamePaymentReady(context);
  await assertEventPaymentReady(context);
}
export async function applyPaidOrderEffects(
  context: PaidOrderContext,
): Promise<void> {
  await confirmPaidCourtBookings(context);
  await activatePaidTrainingEnrollment(context);
  await confirmPaidGameRegistration(context);
  await confirmPaidEventTeam(context);
  await activatePaidMembership(context);
  await creditPaidRecharge(context);
  await issuePaidGoods(context);
  await scheduleFirstPaymentRewards(context);
  await redeemPaidOrderCoupon(context);
}
