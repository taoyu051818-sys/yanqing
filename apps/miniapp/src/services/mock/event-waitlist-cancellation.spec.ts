import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import { getEventDetail, saveEventDetail } from "./state";
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
const login = (role: string) => request("POST", "/auth/dev-login", { role });

function shanghaiDate(offsetDays: number) {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

async function createOpenEvent(suffix: string) {
  await login("EVENT_MANAGER");
  const startsDate = shanghaiDate(7);
  const deadlineDate = shanghaiDate(6);
  const created = await request("POST", "/events", {
    code: `EV-${suffix}`,
    name: `赛事逆向验收-${suffix}`,
    startsAt: `${startsDate}T09:00:00+08:00`,
    registrationEndsAt: `${deadlineDate}T20:00:00+08:00`,
    capacityPeople: 24,
    minimumPeople: 24,
    totalRounds: 5,
    feeCents: 8_800,
  });
  await request("POST", `/events/${created.id}/publish`, {
    reason: "配置复核完成",
  });
  return created;
}

async function issuePartnerInvite(eventId: string) {
  const invite = await request<{ partnerInviteCode: string }>(
    "POST",
    `/events/${eventId}/partner-invites`,
  );
  return invite.partnerInviteCode;
}

describe("event mock waitlist, payment deadline and cancellation", () => {
  beforeEach(() => storage.clear());

  it("keeps a full event registration in FIFO without an order, then promotes and pays it once", async () => {
    const created = await createOpenEvent(`QUEUE-${Date.now()}`);
    const partnerInviteCode = await issuePartnerInvite(created.id);
    const detail = getEventDetail(created.id);
    detail.status = "FULL";
    detail.teams = Array.from({ length: 12 }, (_, index) => ({
      id: `seat-${index + 1}`,
      name: `已占位${index + 1}`,
      captainId: `member-${index + 10}`,
      playerAUserId: `member-${index + 10}`,
      playerBUserId: `member-${index + 30}`,
      playerAName: `甲${index + 1}`,
      playerBName: `乙${index + 1}`,
      category: "MIXED_DOUBLES",
      status: "PAID",
      createdAt: new Date(Date.now() - (20 - index) * 1_000).toISOString(),
    }));
    saveEventDetail(detail);

    await login("MEMBER");
    await expect(
      request("POST", `/events/${created.id}/partner-invites/preview`, {
        partnerInviteCode,
      }),
    ).resolves.toMatchObject({ partnerDisplayName: "赛事管理员" });
    const beforeOrders = getOrders().length;
    const command = {
      name: "候补双打队",
      partnerInviteCode,
      category: "MIXED_DOUBLES",
      sourceChannel: "MINI_PROGRAM",
      creationIdempotencyKey: "event-mock-waitlist-command-1",
    };
    const waitlisted = await request(
      "POST",
      `/events/${created.id}/register`,
      command,
    );
    const replay = await request(
      "POST",
      `/events/${created.id}/register`,
      command,
    );

    expect(waitlisted).toMatchObject({
      status: "WAITLISTED",
      waitlistPosition: 1,
      registration: {
        name: "候补双打队",
        category: "MIXED_DOUBLES",
        status: "WAITLISTED",
      },
    });
    expect(JSON.stringify(waitlisted)).not.toMatch(
      /orderId|playerAUserId|playerBUserId|captainId|creationCommandHash/,
    );
    expect(replay).toEqual(waitlisted);
    expect(getOrders()).toHaveLength(beforeOrders);
    await expect(
      request("POST", `/events/${created.id}/partner-invites/preview`, {
        partnerInviteCode,
      }),
    ).rejects.toThrow("已使用或已过期");
    await expect(
      request("POST", `/events/${created.id}/register`, {
        ...command,
        partnerInviteCode: `${partnerInviteCode}x`,
      }),
    ).rejects.toThrow("幂等键已用于");

    const latest = getEventDetail(created.id);
    const persistedWaitlisted = latest.teams.find(
      (team: any) => team.name === command.name,
    );
    expect(persistedWaitlisted?.id).toBeTruthy();
    latest.teams[0].status = "REFUNDED";
    saveEventDetail(latest);
    await login("EVENT_MANAGER");
    const promoted = await request(
      "POST",
      `/events/${created.id}/promote-waitlist`,
    );
    expect(promoted.promotions).toHaveLength(1);
    expect(promoted.promotions[0]).toMatchObject({
      registration: { status: "REGISTERED" },
      order: { status: "PENDING" },
    });
    expect(promoted.promotions[0].registration.paymentDueAt).toBeTruthy();

    await login("MEMBER");
    const mine = await request("GET", `/events/${created.id}/registration/me`);
    expect(mine).toMatchObject({
      waitlistPosition: null,
      registration: { status: "REGISTERED" },
    });
    await request("POST", `/orders/${promoted.promotions[0].order.id}/pay`, {
      channel: "WECHAT",
      idempotencyKey: "event-mock-payment-command-1",
    });
    expect(
      getEventDetail(created.id).teams.find(
        (team: any) => team.id === persistedWaitlisted!.id,
      ),
    ).toMatchObject({ status: "PAID", paymentDueAt: null });
  });

  it("cancels pending/waitlist rows and sends paid money to a separate finance refund review", async () => {
    const created = await createOpenEvent(`CANCEL-${Date.now()}`);
    const detail = getEventDetail(created.id);
    const paidOrder = {
      id: "event-paid-order",
      orderNo: "EVPAID001",
      title: `${detail.name} 报名`,
      status: "PAID",
      businessType: "EVENT",
      eventId: created.id,
      eventTeamId: "event-paid-team",
      memberId: "member-paid",
      payableCents: 8_800,
      paidCents: 8_800,
      refundedCents: 0,
      refunds: [],
      parameterSnapshot: {
        eventId: created.id,
        eventTeamId: "event-paid-team",
      },
      createdAt: new Date().toISOString(),
    };
    const pendingOrder = {
      ...paidOrder,
      id: "event-pending-order",
      orderNo: "EVPENDING001",
      eventTeamId: "event-pending-team",
      memberId: "member-pending",
      status: "PENDING",
      paidCents: 0,
      parameterSnapshot: {
        eventId: created.id,
        eventTeamId: "event-pending-team",
      },
    };
    detail.teams = [
      {
        id: "event-paid-team",
        captainId: "member-paid",
        status: "PAID",
        orderId: paidOrder.id,
        createdAt: new Date().toISOString(),
      },
      {
        id: "event-pending-team",
        captainId: "member-pending",
        status: "REGISTERED",
        orderId: pendingOrder.id,
        paymentDueAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "event-wait-team",
        captainId: "member-wait",
        status: "WAITLISTED",
        orderId: null,
        waitlistedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];
    saveEventDetail(detail);
    saveOrders([paidOrder, pendingOrder, ...getOrders()]);

    const command = {
      reason: "场馆临时停电",
      idempotencyKey: "event-mock-cancel-command-1",
    };
    const cancelled = await request(
      "POST",
      `/events/${created.id}/cancel`,
      command,
    );
    const replay = await request(
      "POST",
      `/events/${created.id}/cancel`,
      command,
    );

    expect(cancelled).toMatchObject({
      event: { status: "CANCELLED", cancelReason: "场馆临时停电" },
      cancelledPendingOrders: 1,
      cancelledWaitlist: 1,
      refundRequestCount: 1,
      refundRequestedCents: 8_800,
    });
    expect(JSON.stringify(cancelled)).not.toMatch(
      /cancelIdempotencyKey|cancelCommandHash|cancelPolicySnapshot|requestedById|orderId/,
    );
    expect(replay).toMatchObject({ idempotent: true });
    expect(
      getOrders().find((order) => order.id === pendingOrder.id)?.status,
    ).toBe("CANCELLED");
    expect(getOrders().find((order) => order.id === paidOrder.id)?.status).toBe(
      "REFUND_PENDING",
    );

    await login("FINANCE");
    const refundId = getOrders().find((order) => order.id === paidOrder.id)
      ?.refunds?.[0]?.id;
    expect(refundId).toBeTruthy();
    await request(
      "POST",
      `/orders/refunds/${refundId}/approve`,
      { reason: "财务复核同意赛事取消退款" },
    );
    expect(
      getOrders().find((order) => order.id === paidOrder.id),
    ).toMatchObject({
      status: "REFUNDED",
      refundedCents: 8_800,
    });
    expect(
      getEventDetail(created.id).teams.find(
        (team: any) => team.id === "event-paid-team",
      )?.status,
    ).toBe("REFUNDED");

    await login("MEMBER");
    await expect(
      request("POST", `/events/${created.id}/cancel`, {
        reason: "越权取消",
        idempotencyKey: "event-member-cancel-denied",
      }),
    ).rejects.toThrow("无权");
  });

  it("keeps a paid self-withdrawal seat until finance succeeds, then promotes FIFO exactly once", async () => {
    const created = await createOpenEvent(`SELF-REFUND-${Date.now()}`);
    const partnerInviteCode = await issuePartnerInvite(created.id);
    await login("MEMBER");
    const order = await request("POST", `/events/${created.id}/register`, {
      name: "伤病退出队",
      partnerInviteCode,
      category: "MIXED_DOUBLES",
      sourceChannel: "MINI_PROGRAM",
      creationIdempotencyKey: "event-self-refund-register-1",
    });
    await request("POST", `/orders/${order.id}/pay`, {
      channel: "WECHAT",
      idempotencyKey: "event-self-refund-pay-1",
    });
    const detail = getEventDetail(created.id);
    detail.status = "FULL";
    detail.teams.push({
      id: "self-refund-waiter",
      name: "FIFO候补队",
      captainId: "member-waiter",
      playerAUserId: "member-waiter",
      playerBUserId: "member-waiter-b",
      playerAName: "候补甲",
      playerBName: "候补乙",
      category: "MIXED_DOUBLES",
      status: "WAITLISTED",
      orderId: null,
      payableCents: 8_800,
      waitlistedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    saveEventDetail(detail);

    const command = {
      reason: "队员受伤无法参赛",
      idempotencyKey: "event-self-refund-cancel-1",
    };
    const cancellation = await request(
      "POST",
      `/events/${created.id}/registration/cancel`,
      command,
    );
    const replay = await request(
      "POST",
      `/events/${created.id}/registration/cancel`,
      command,
    );
    expect(cancellation).toMatchObject({
      outcome: "REFUND_REQUESTED",
      registration: { status: "PAID", cancellationPending: true },
      refund: { status: "REQUESTED", amountCents: 8_800 },
    });
    expect(replay).toMatchObject({
      idempotent: true,
      refund: { id: cancellation.refund.id },
    });

    await login("EVENT_MANAGER");
    await expect(
      request(
        "POST",
        `/events/${created.id}/teams/${cancellation.registration.id}/check-in`,
      ),
    ).rejects.toThrow("退款审批");

    await login("FINANCE");
    await request("POST", `/orders/refunds/${cancellation.refund.id}/approve`, {
      reason: "财务确认全额原路退款",
    });
    const after = getEventDetail(created.id);
    expect(
      after.teams.find((team: any) => team.id === cancellation.registration.id),
    ).toMatchObject({ status: "REFUNDED", cancellationPending: false });
    expect(
      after.teams.find((team: any) => team.id === "self-refund-waiter"),
    ).toMatchObject({ status: "REGISTERED" });
    expect(
      getOrders().filter(
        (item) =>
          item.creationIdempotencyKey ===
          "SYSTEM:EVENT_WAITLIST:self-refund-waiter",
      ),
    ).toHaveLength(1);
  });

  it("restores a paid registration when finance rejects self-withdrawal", async () => {
    const created = await createOpenEvent(`SELF-REJECT-${Date.now()}`);
    const partnerInviteCode = await issuePartnerInvite(created.id);
    await login("MEMBER");
    const order = await request("POST", `/events/${created.id}/register`, {
      name: "退款驳回队",
      partnerInviteCode,
      category: "MEN_DOUBLES",
      sourceChannel: "MINI_PROGRAM",
      creationIdempotencyKey: "event-self-reject-register-1",
    });
    await request("POST", `/orders/${order.id}/pay`, {
      channel: "WECHAT",
      idempotencyKey: "event-self-reject-pay-1",
    });
    const cancellation = await request(
      "POST",
      `/events/${created.id}/registration/cancel`,
      {
        reason: "临时申请退出赛事",
        idempotencyKey: "event-self-reject-cancel-1",
      },
    );

    await login("FINANCE");
    await request("POST", `/orders/refunds/${cancellation.refund.id}/reject`, {
      reason: "材料不足，驳回退款",
    });
    const restored = getEventDetail(created.id).teams.find(
      (team: any) => team.id === cancellation.registration.id,
    );
    expect(restored).toMatchObject({
      status: "PAID",
      cancellationPending: false,
    });
    expect(getOrders().find((item) => item.id === order.id)?.status).toBe(
      "PAID",
    );
  });
});
