import { describe, expect, it } from "vitest";

import {
  findOpsDeepLinkRecord,
  parseOpsDeepLinkQuery,
  resolveWorkItemDestination,
} from "./work-item-deep-link";

describe("work item deep links", () => {
  it.each([
    ["CUSTOMER_LEAD_SLA", "members", "lead"],
    ["ACCOUNT_ADJUSTMENT_REVIEW", "finance", "account-adjustment"],
    ["TRAINING_ATTENDANCE", "coach", "attendance"],
    ["EVENT_SCORE", "event", "score"],
    ["HOST_GAME", "host", "game"],
    ["LOW_STOCK", "inventory", "low-stock"],
    ["ORDER_FULFILLMENT", "frontdesk", "order"],
  ])("maps %s to its owning workspace", (kind, page, focus) => {
    const destination = resolveWorkItemDestination({
      id: `work-${kind}`,
      kind,
      objectType: kind === "ORDER_FULFILLMENT" ? "Order" : "Record",
      objectId: "resource-1",
      metadata: { eventId: "event-1", sessionId: "session-1" },
    });
    expect(destination).toMatchObject({ page, query: { focus, id: "resource-1" } });
    expect(destination?.url).toContain(`focus=${focus}`);
  });

  it("honours an allow-listed action and preserves its explicit query", () => {
    const destination = resolveWorkItemDestination({
      id: "training-settlement:1",
      kind: "TRAINING_SETTLEMENT",
      objectId: "settlement-1",
      action:
        "/packages/ops/pages/finance/index?focus=training-settlement&id=settlement-1",
    });
    expect(destination?.url).toBe(
      "/packages/ops/pages/finance/index?focus=training-settlement&id=settlement-1",
    );
  });

  it("converts legacy API action URLs instead of navigating to non-pages", () => {
    expect(resolveWorkItemDestination({
      id: "lead:1",
      kind: "CUSTOMER_LEAD_SLA",
      objectId: "lead-1",
      action: "/members/leads/lead-1",
    })?.url).toBe(
      "/packages/ops/pages/members/index?focus=lead&id=lead-1",
    );
  });

  it("parses, locates and rejects missing targets deterministically", () => {
    const query = parseOpsDeepLinkQuery({
      focus: "refund",
      id: "refund-2",
      orderId: "order-2",
      unsafe: "ignored",
    });
    expect(query).toEqual({ focus: "refund", id: "refund-2", orderId: "order-2" });
    expect(findOpsDeepLinkRecord([
      { id: "refund-1", orderId: "order-1" },
      { id: "refund-2", orderId: "order-2" },
    ], query)).toEqual({ id: "refund-2", orderId: "order-2" });
    expect(findOpsDeepLinkRecord([{ id: "refund-1" }], query)).toBeNull();
  });
});

it('routes merchant settlement confirmation to its permitted merchant workspace', () => {
  const destination = resolveWorkItemDestination({ id: 'task', kind: 'ALLIANCE_SETTLEMENT', objectId: 'settlement', action: '/alliance/settlements/settlement/confirm' }, ['MERCHANT'])
  expect(destination).toMatchObject({ page: 'merchant', query: { focus: 'alliance-settlement', id: 'settlement' } })
})
it.each([
  ['GAME', 'HOST', 'host', 'game'], ['EVENT', 'EVENT_MANAGER', 'event', 'team'], ['VENUE', 'FRONT_DESK', 'frontdesk', 'order'],
] as const)('routes %s fulfillment by domain and keeps its actual parent id', (businessType, role, page, focus) => {
  const destination = resolveWorkItemDestination({ id: 'task', kind: 'ORDER_FULFILLMENT', objectType: 'Order', objectId: 'order', action: `/packages/ops/pages/${page}/index?focus=fulfillment&orderId=order`, metadata: { businessType, gameId: 'game', eventId: 'event', fulfillmentObjectId: 'registration' } }, [role])
  expect(destination).toMatchObject({ page, query: { focus, orderId: 'order' } })
  if (businessType === 'GAME') expect(destination?.query.gameId).toBe('game')
  if (businessType === 'EVENT') expect(destination?.query).toMatchObject({ eventId: 'event', id: 'registration' })
  expect(resolveWorkItemDestination({ id: 'forbidden', kind: 'ORDER_FULFILLMENT', metadata: { businessType: 'VENUE' } }, ['HOST'])).toBeNull()
})
