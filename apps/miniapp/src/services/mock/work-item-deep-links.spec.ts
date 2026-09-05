import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveWorkItemDestination } from "../../utils/work-item-deep-link";
import { mockRequest } from "./router";
import {
  getCustomerLeads,
  getEventDetail,
  getEvents,
  getGoods,
  getHostApplications,
  getSettlements,
  getTrainingSessions,
  resetCatalogState,
} from "./state";
import { getOrders, saveOrders } from "./venue";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);

describe("mock work item deep links", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await request("POST", "/auth/dev-login", { role: "ADMIN" });
  });

  it("gives every mock queue item an allow-listed operations-page destination", async () => {
    const items = await request<any[]>("GET", "/work-items");
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      const destination = resolveWorkItemDestination(item);
      expect(destination, item.id).not.toBeNull();
      expect(destination?.path, item.id).toMatch(
        /^\/packages\/ops\/pages\/(members|finance|coach|event|host|frontdesk|inventory|governance)\/index$/,
      );
      expect(destination?.query.focus, item.id).toBeTruthy();
    }
  });

  it("uses resource identifiers that exist in the corresponding mock data", async () => {
    const items = await request<any[]>("GET", "/work-items");
    const byKind = (kind: string) => items.find((item) => item.kind === kind);

    expect(getCustomerLeads().some((item) => item.id === byKind("CUSTOMER_LEAD_SLA").objectId)).toBe(true);
    expect(getHostApplications().some((item) => item.id === byKind("HOST_APPLICATION_REVIEW").objectId)).toBe(true);
    expect(getTrainingSessions().some((item) => item.id === byKind("TRAINING_SESSION_OPERATION").metadata.sessionId)).toBe(true);
    const eventItem = byKind("EVENT_SCORE");
    expect(getEvents().some((item) => item.id === eventItem.metadata.eventId)).toBe(true);
    expect(getEventDetail(eventItem.metadata.eventId).matches.some((item: any) => item.id === eventItem.objectId)).toBe(true);
    expect(getSettlements().some((item) => item.id === byKind("ALLIANCE_SETTLEMENT").objectId)).toBe(true);
    expect(getGoods().some((item) => item.id === byKind("LOW_STOCK").objectId)).toBe(true);
    expect(getOrders().some((item) => item.id === byKind("ORDER_FULFILLMENT").objectId)).toBe(true);
  });

  it("builds refund work items from actual order and refund ids", async () => {
    saveOrders([
      {
        id: "order-refund-focus",
        orderNo: "VN-REFUND-FOCUS",
        businessType: "VENUE",
        status: "REFUND_PENDING",
        title: "退款深链验收单",
        createdAt: new Date().toISOString(),
        refunds: [{
          id: "refund-focus",
          refundNo: "RF-FOCUS",
          status: "REQUESTED",
          amountCents: 6_800,
          requestedAt: new Date().toISOString(),
        }],
      },
      ...getOrders(),
    ]);
    const items = await request<any[]>("GET", "/work-items");
    const refund = items.find((item) => item.objectId === "refund-focus");
    expect(resolveWorkItemDestination(refund)).toMatchObject({
      page: "finance",
      query: { focus: "refund", id: "refund-focus", orderId: "order-refund-focus" },
    });
  });
});
