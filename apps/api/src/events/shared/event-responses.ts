import { orderResponse } from '../../orders/order-response.js';

export const eventRegistrationResponse = (value: any) => {
  if (value?.orderNo || value?.businessType) return orderResponse(value);
  if (!value?.registration) return value;
  return {
    status: value.status ?? value.registration.status,
    waitlistPosition: value.waitlistPosition ?? null,
    registration: {
      name: value.registration.name,
      category: value.registration.category,
      status: value.registration.status,
      paymentDueAt: value.registration.paymentDueAt,
    },
  };
};

export const eventCommandResponse = (event: any) => ({
  id: event.id,
  code: event.code,
  name: event.name,
  status: event.status,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  cancelReason: event.cancelReason,
  cancelledAt: event.cancelledAt,
});

export const eventCancellationResponse = (value: any) => {
  const policy =
    value?.event?.cancelPolicySnapshot &&
    typeof value.event.cancelPolicySnapshot === 'object'
      ? value.event.cancelPolicySnapshot
      : {};
  return {
    event: eventCommandResponse(value.event),
    cancelledPendingOrders: Number(
      value.cancelledPendingOrders ?? policy.pendingOrders ?? 0,
    ),
    cancelledWaitlist: Number(
      value.cancelledWaitlist ?? policy.waitlistedTeams ?? 0,
    ),
    refundRequestCount: Number(
      value.refundRequestCount ??
        value.refundRequests?.length ??
        policy.refundRequestCount ??
        0,
    ),
    refundRequestedCents: Number(
      value.refundRequests?.reduce(
        (total: number, refund: any) => total + Number(refund.amountCents || 0),
        0,
      ) ??
        policy.refundRequestedCents ??
        0,
    ),
    idempotent: Boolean(value.idempotent),
  };
};

export const eventTeamCommandResponse = (team: any) => ({
  id: team.id,
  name: team.name,
  category: team.category,
  status: team.status,
  checkedInAt: team.checkedInAt,
  cancellationPending: Boolean(team.cancellationPending),
  order: team.order ? { status: team.order.status } : undefined,
});

/** Member withdrawal never exposes another registration promoted as a side effect. */
export const eventWithdrawalResponse = (value: any) => ({
  registration: eventTeamCommandResponse(value.registration),
  refund: value.refund
    ? {
        id: value.refund.id,
        status: value.refund.status,
        amountCents: value.refund.amountCents,
      }
    : null,
  outcome: value.outcome,
  idempotent: Boolean(value.idempotent),
});
