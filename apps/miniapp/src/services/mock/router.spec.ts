import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getEventDetail,
  getEnrollments,
  getGames,
  getMemberAccountTransactions,
  getTrainingSessions,
  getVenueBookings,
  resetCatalogState,
  saveEnrollments,
  saveEventDetail,
  saveFrontDeskShifts,
  saveGames,
  saveInventoryOperations,
  saveInventoryTransactions,
  savePurchaseOrders,
  saveStocktakes,
  saveTrainingSessions,
  saveVenueBookings,
  saveYouthTrainingRules,
} from "./state";
import { getOrders, saveOrders } from "./venue";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const login = (role: string) =>
  mockRequest<any>("POST", "/auth/dev-login", { role });
const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);

function shanghaiDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

describe("miniapp mock acceptance journeys", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("MEMBER");
  });

  it("keeps public goods and order responses free of inventory cost and rule snapshots", async () => {
    const products = await request<any[]>("GET", "/goods");
    expect(products.length).toBeGreaterThan(0);
    for (const field of [
      "purchasePriceCents",
      "supplierId",
      "defaultLocationId",
      "safeStock",
      "mode",
    ]) {
      expect(products[0]).not.toHaveProperty(field);
    }

    saveOrders([
      {
        id: "order-private-snapshot",
        orderNo: "GD-PRIVATE-1",
        memberId: "user-member",
        businessType: "GOODS",
        status: "PENDING",
        title: "寄售商品",
        payableCents: 1200,
        parameterSnapshot: { pricingRuleId: "internal-rule" },
        creationCommandHash: "private-command-hash",
        items: [
          {
            id: "line-private-1",
            name: "羽毛球",
            quantity: 1,
            unitPriceCents: 1200,
            amountCents: 1200,
            metadata: {
              supplierId: "supplier-secret",
              settlementRule: { commissionRateBps: 2500 },
            },
          },
        ],
        payments: [
          {
            id: "payment-private-1",
            status: "CREATED",
            providerPayload: { prepayId: "private-prepay" },
            idempotencyKey: "private-payment-key",
          },
        ],
      },
      ...getOrders(),
    ]);

    const orders = await request<any>("GET", "/orders");
    const response = orders.items.find(
      (item: any) => item.id === "order-private-snapshot",
    );
    expect(response).toBeDefined();
    const serialized = JSON.stringify(response);
    for (const secret of [
      "parameterSnapshot",
      "creationCommandHash",
      "metadata",
      "commissionRateBps",
      "providerPayload",
      "private-command-hash",
      "supplier-secret",
      "private-prepay",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps event list registration actions aligned with the event detail state", async () => {
    const summaries = await request<any[]>("GET", "/events");
    const operationalFixture = summaries.find(
      (event) => event.id === "event-golden",
    );
    const registrationFixture = summaries.find(
      (event) => event.id === "event-open-partner",
    );

    expect(operationalFixture).toMatchObject({ status: "IN_PROGRESS" });
    expect(getEventDetail(operationalFixture.id)).toMatchObject({
      status: "IN_PROGRESS",
    });
    expect(registrationFixture).toMatchObject({ status: "OPEN" });
    expect(getEventDetail(registrationFixture.id)).toMatchObject({
      status: "OPEN",
    });
    await expect(
      request("POST", `/events/${registrationFixture.id}/partner-invites`),
    ).resolves.toMatchObject({
      partnerDisplayName: "延庆会员小林",
      partnerInviteCode: expect.stringMatching(/^EP_/),
    });
  });

  it("enforces the member directory and customer360 privacy matrix across employee roles", async () => {
    await login("FRONT_DESK");
    const frontDeskDirectory = await request<any>("GET", "/members");
    expect(frontDeskDirectory.items[0]).toMatchObject({
      phone: "138****0005",
      privacyScope: "FRONT_DESK_LIMITED",
    });
    expect(JSON.stringify(frontDeskDirectory)).not.toContain("13800000005");
    const frontDesk360 = await request<any>("GET", "/members/member-1/360");
    expect(frontDesk360).toMatchObject({
      member: { phone: "138****0005" },
      privacyScope: "FRONT_DESK_LIMITED",
      financialsRedacted: true,
      accountTypesLimited: true,
      accounts: [],
      paymentSummary: {
        storedValueAvailableCents: 148_000,
        badmintonCoinAvailable: 500,
      },
    });
    expect(
      frontDesk360.recentOrders.every(
        (order: any) =>
          order.paidCents === undefined && order.refundedCents === undefined,
      ),
    ).toBe(true);
    expect(JSON.stringify(frontDesk360)).not.toContain('"EVENT_POINTS"');
    expect(JSON.stringify(frontDesk360)).not.toContain('"GROWTH_POINTS"');
    expect(JSON.stringify(frontDesk360)).not.toContain('"CASH_PRINCIPAL"');
    expect(JSON.stringify(frontDesk360)).not.toContain('"GIFT_BALANCE"');

    await login("FINANCE");
    const finance360 = await request<any>("GET", "/members/member-1/360");
    expect(finance360.member.phone).toBe("138****0005");
    expect(finance360.privacyScope).toBe("FINANCE");
    expect(finance360.accounts.map((account: any) => account.type)).toEqual([
      "CASH_PRINCIPAL",
      "GIFT_BALANCE",
      "BADMINTON_COIN",
      "EVENT_POINTS",
      "GROWTH_POINTS",
    ]);

    await login("ADMIN");
    const admin360 = await request<any>("GET", "/members/member-1/360");
    expect(admin360.member.phone).toBe("13800000005");
    expect(admin360.privacyScope).toBe("ADMIN");
    expect(admin360.accounts).toHaveLength(5);

    await login("COACH");
    const coach360 = await request<any>("GET", "/members/member-1/360");
    expect(coach360).toMatchObject({
      member: { phone: null },
      accounts: [],
      privacyScope: "COACH_ASSIGNED",
      financialsRedacted: true,
    });
  });

  it("runs guardian student → seat hold → payment → prepaid refund approval", async () => {
    saveYouthTrainingRules([
      {
        id: "acceptance-youth-rule",
        version: "TEST-RULE-PUBLISHED",
        status: "PUBLISHED",
        maxTotalSessions: 24,
        maxValidityDays: 200,
        maxContractAmountCents: 260_000,
        warningThresholdDays: 30,
        hardBlock: true,
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: null,
        requestedById: "user-admin",
        reviewedById: "user-super",
      },
    ]);
    const student = await request("POST", "/training/students", {
      displayName: "小羽",
      birthMonth: "2014-05-01T00:00:00.000Z",
      guardianConsentStatus: true,
    });
    expect(student).toMatchObject({
      guardianId: "user-member",
      guardianConsentStatus: true,
    });

    const order = await request("POST", "/training/purchase", {
      productId: "training-youth",
      classId: "class-youth",
      studentId: student.id,
      sourceChannel: "MINI_PROGRAM",
    });
    expect(order.status).toBe("PENDING");

    await request("POST", `/orders/${order.id}/pay`, {
      channel: "WECHAT",
      idempotencyKey: "training-payment-request-1",
    });
    const afterPayment = await request<any[]>("GET", "/training/enrollments");
    const enrollment = afterPayment.find((item) => item.orderId === order.id);
    expect(enrollment).toMatchObject({
      status: "ACTIVE",
      prepaidBalanceCents: 198_000,
      seatReservedUntil: null,
      studentId: student.id,
    });
    await expect(
      request("POST", "/training/purchase", {
        productId: "training-youth",
        classId: "class-youth",
        studentId: student.id,
      }),
    ).rejects.toThrow("已报名本班");

    const refund = await request("POST", `/orders/${order.id}/refunds`, {
      amountCents: 198_000,
      reason: "报名后未开课退费",
      idempotencyKey: "training-refund-request-1",
    });
    await login("FINANCE");
    await request("POST", `/orders/refunds/${refund.id}/approve`, {
      reason: "核对未消课余额",
    });
    const adminEnrollments = await request<any[]>(
      "GET",
      "/training/admin/enrollments",
    );
    expect(
      adminEnrollments.find((item) => item.id === enrollment.id),
    ).toMatchObject({
      status: "REFUNDED",
      prepaidBalanceCents: 0,
      refundedCents: 198_000,
    });
  });

  it("runs immutable consume sequence 1 → reversal 2 → reconsume 3 with maker/checker evidence", async () => {
    const enrollmentList = getEnrollments();
    const enrollment = enrollmentList.find((item) => item.id === "enroll-1")!;
    const attendance = enrollment.attendances[0];
    enrollment.product = { ...enrollment.product, audience: "YOUTH" };
    enrollment.confirmedRevenueCents = 48_000;
    enrollment.growthPointsBalance = 0;
    attendance.revenueRecognitions = [];
    attendance.growthPointsAwarded = 0;
    saveEnrollments(enrollmentList);
    const before = {
      used: enrollment.consumedSessions,
      prepaid: enrollment.prepaidBalanceCents,
      revenue: enrollment.confirmedRevenueCents,
    };
    const sessions = getTrainingSessions();
    const session = sessions.find((item) => item.id === "session-1")!;
    session.startsAt = new Date(Date.now() - 90 * 60_000).toISOString();
    session.endsAt = new Date(Date.now() - 10 * 60_000).toISOString();
    saveTrainingSessions(sessions);

    await login("COACH");
    await request("POST", "/training/sessions/session-1/attendance", {
      enrollmentId: enrollment.id,
      status: "ATTENDED",
      feedback: "现场点名已到场",
    });
    await request("POST", "/training/sessions/session-1/consume", {
      enrollmentId: enrollment.id,
      feedback: "学员已完成本节训练",
    });
    await login("ADMIN");
    const firstConsume = await request(
      "POST",
      "/training/sessions/session-1/consume/confirm",
      {
        enrollmentId: enrollment.id,
        reason: "点名与教练记录一致",
        idempotencyKey: "consume-confirm-sequence-1",
      },
    );
    expect(firstConsume).toMatchObject({ type: "CONSUME", sequence: 1 });
    let current = getEnrollments().find((item) => item.id === enrollment.id)!;
    let currentAttendance = current.attendances[0];
    expect(currentAttendance).toMatchObject({
      status: "ATTENDED",
      consumedSessions: 1,
      growthPointsAwarded: 1,
    });
    expect(current.growthPointsBalance).toBe(1);

    await login("COACH");
    const correctionCommand = {
      recognitionId: firstConsume.id,
      reason: "误将请假学员确认消课",
      idempotencyKey: "consume-correction-request-1",
    };
    const correction = await request(
      "POST",
      "/training/consume-corrections",
      correctionCommand,
    );
    await expect(
      request("POST", "/training/consume-corrections", correctionCommand),
    ).resolves.toMatchObject({ id: correction.id, status: "REQUESTED" });
    await expect(
      request("POST", "/training/consume-corrections", {
        ...correctionCommand,
        reason: "同键不同冲正原因",
      }),
    ).rejects.toThrow("幂等键已用于其他指令");

    await login("ADMIN");
    expect(
      (await request<any[]>("GET", "/work-items")).some(
        (item) =>
          item.kind === "TRAINING_CONSUME_CORRECTION_REVIEW" &&
          item.objectId === correction.id,
      ),
    ).toBe(true);
    const approval = {
      reason: "已核对请假凭证，确认误消",
      idempotencyKey: "consume-correction-approve-1",
    };
    const approved = await request(
      "POST",
      `/training/consume-corrections/${correction.id}/approve`,
      approval,
    );
    expect(approved).toMatchObject({
      status: "APPROVED",
      recognition: { id: firstConsume.id, sequence: 1 },
      reversalRecognition: {
        type: "REVERSAL",
        sequence: 2,
        effectiveRevenueCents: -firstConsume.effectiveRevenueCents,
      },
      attendance: {
        status: "ATTENDED",
        consumedSessions: 0,
        confirmedRevenueCents: 0,
        growthPointsAwarded: 0,
      },
    });
    await expect(
      request(
        "POST",
        `/training/consume-corrections/${correction.id}/approve`,
        approval,
      ),
    ).resolves.toMatchObject({ id: correction.id, status: "APPROVED" });
    current = getEnrollments().find((item) => item.id === enrollment.id)!;
    currentAttendance = current.attendances[0];
    expect(current).toMatchObject({
      consumedSessions: before.used,
      usedSessions: before.used,
      prepaidBalanceCents: before.prepaid,
      confirmedRevenueCents: before.revenue,
      growthPointsBalance: 0,
    });
    expect(
      currentAttendance.revenueRecognitions.map((item: any) => item.sequence),
    ).toEqual([1, 2]);

    await login("COACH");
    await request("POST", "/training/sessions/session-1/consume", {
      enrollmentId: enrollment.id,
      feedback: "冲正后重新核实到场",
    });
    await login("ADMIN");
    const reconsume = await request(
      "POST",
      "/training/sessions/session-1/consume/confirm",
      {
        enrollmentId: enrollment.id,
        reason: "重新核实点名无误",
        idempotencyKey: "consume-confirm-sequence-3",
      },
    );
    expect(reconsume).toMatchObject({ type: "CONSUME", sequence: 3 });
    current = getEnrollments().find((item) => item.id === enrollment.id)!;
    currentAttendance = current.attendances[0];
    expect(
      currentAttendance.revenueRecognitions.map((item: any) => [
        item.sequence,
        item.type,
        item.effectiveRevenueCents,
      ]),
    ).toEqual([
      [1, "CONSUME", firstConsume.effectiveRevenueCents],
      [2, "REVERSAL", -firstConsume.effectiveRevenueCents],
      [3, "CONSUME", firstConsume.effectiveRevenueCents],
    ]);
    expect(currentAttendance).toMatchObject({
      status: "ATTENDED",
      consumedSessions: 1,
      growthPointsAwarded: 1,
    });

    const adminMade = await request("POST", "/training/consume-corrections", {
      recognitionId: reconsume.id,
      reason: "管理员发现第二次误消",
      idempotencyKey: "consume-correction-request-2",
    });
    await expect(
      request("POST", `/training/consume-corrections/${adminMade.id}/reject`, {
        reason: "本人不能复核",
        idempotencyKey: "consume-correction-reject-self",
      }),
    ).rejects.toThrow("申请人与复核人不能为同一账号");
    await login("SUPER_ADMIN");
    await expect(
      request("POST", `/training/consume-corrections/${adminMade.id}/reject`, {
        reason: "复查证据不足，保留原消课",
        idempotencyKey: "consume-correction-reject-2",
      }),
    ).resolves.toMatchObject({ status: "REJECTED" });
    expect(
      getEnrollments().find((item) => item.id === enrollment.id)!.attendances[0]
        .revenueRecognitions,
    ).toHaveLength(3);
  });

  it("blocks consume after completion and blocks completion while attended work is unconsumed", async () => {
    const enrollments = getEnrollments();
    const attendance = enrollments[0].attendances[0];
    Object.assign(attendance, {
      status: "ATTENDED",
      consumedSessions: 0,
      consumedAt: null,
      operatorId: "user-coach",
    });
    saveEnrollments(enrollments);
    const sessions = getTrainingSessions();
    sessions[0].status = "COMPLETED";
    saveTrainingSessions(sessions);

    await login("COACH");
    await expect(
      request("POST", "/training/sessions/session-1/consume", {
        enrollmentId: enrollments[0].id,
        feedback: "结课后错误重试",
      }),
    ).rejects.toThrow("已结束或已取消的课次不能继续消课");
    await login("ADMIN");
    await expect(
      request("POST", "/training/sessions/session-1/consume/confirm", {
        enrollmentId: enrollments[0].id,
        reason: "结课后错误确认",
      }),
    ).rejects.toThrow("已结束或已取消的课次不能继续消课");

    const reopened = getTrainingSessions();
    reopened[0].status = "SCHEDULED";
    saveTrainingSessions(reopened);
    await expect(
      request("POST", "/training/sessions/session-1/complete"),
    ).rejects.toThrow("仍有学员未完成点名或消课");
    expect(getTrainingSessions()[0].status).toBe("SCHEDULED");
  });

  it("runs member booking/payment and a front-desk check-in without losing the court hold", async () => {
    const date = shanghaiDate(1);
    const order = await request("POST", "/venues/bookings", {
      date,
      courtId: "court-1",
      slotId: "slot-1",
      sourceChannel: "MINI_PROGRAM",
    });
    await request("POST", `/orders/${order.id}/pay`, {
      channel: "WECHAT",
      idempotencyKey: "venue-payment-request-0001",
    });

    // Keep the rewritten fixture on the current Shanghai business date even
    // when the suite runs just before midnight. A future +15 minute start can
    // cross into tomorrow while the availability assertion still queries
    // today, producing a clock-dependent failure unrelated to check-in.
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 120 * 60_000).toISOString();
    const orders = getOrders();
    const storedOrder = orders.find((item) => item.id === order.id)!;
    storedOrder.bookings[0].startsAt = startsAt;
    storedOrder.bookings[0].endsAt = endsAt;
    saveOrders(orders);
    const bookings = getVenueBookings();
    const booking = bookings.find((item) => item.orderId === order.id)!;
    booking.startsAt = startsAt;
    booking.endsAt = endsAt;
    saveVenueBookings(bookings);

    await login("FRONT_DESK");
    await request("POST", "/operations/shifts/open", {
      openingCashCents: 10_000,
    });
    const checkedIn = await request(
      "POST",
      `/venues/orders/${order.id}/check-in`,
    );
    expect(checkedIn.status).toBe("CHECKED_IN");
    const availability = await request<any>("GET", "/venues/availability", {
      date: shanghaiDate(),
    });
    expect(availability.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ courtId: "court-1", status: "CHECKED_IN" }),
      ]),
    );
  });

  it("cancels a hosted game and preserves refund origin evidence for an already pending order", async () => {
    const games = getGames();
    const game = games[0];
    Object.assign(game, {
      hostId: "user-host",
      status: "OPEN",
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      registrations: [
        {
          id: "registration-refund-pending",
          userId: "user-member",
          status: "PAID",
          orderId: "order-game-refund-pending",
        },
      ],
    });
    saveGames(games);
    saveOrders([
      {
        id: "order-game-refund-pending",
        orderNo: "GO-REFUND-PENDING",
        title: game.title,
        businessType: "GAME",
        status: "REFUND_PENDING",
        paidCents: 6_800,
        refundedCents: 0,
        refunds: [
          {
            id: "refund-existing",
            status: "REQUESTED",
            amountCents: 1_000,
            originalOrderStatus: "CHECKED_IN",
          },
        ],
      },
      ...getOrders(),
    ]);

    await login("HOST");
    const command = {
      reason: "场地临时停电",
      idempotencyKey: "game-cancel-refund-origin-001",
    };
    const result = await request("POST", `/games/${game.id}/cancel`, command);
    expect(result).toMatchObject({
      game: { status: "CANCELLED" },
      refundRequestCount: 1,
      refundRequestedCents: 5_800,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /cancelIdempotencyKey|cancelCommandHash|cancelPolicySnapshot|requestedById|orderId/,
    );
    expect(
      getOrders()
        .find((item) => item.id === "order-game-refund-pending")
        ?.refunds?.find((refund: any) => refund.amountCents === 5_800),
    ).toMatchObject({
      orderId: "order-game-refund-pending",
      amountCents: 5_800,
      originalOrderStatus: "CHECKED_IN",
      status: "REQUESTED",
    });
    await expect(
      request("POST", `/games/${game.id}/cancel`, command),
    ).resolves.toMatchObject({ game: { id: game.id }, idempotent: true });
  });

  it("forces assisted bookings to select an active customer and keeps operator ownership separate", async () => {
    const date = shanghaiDate(1);
    await login("FRONT_DESK");
    const base = {
      date,
      courtId: "court-1",
      slotId: "slot-2",
      sourceChannel: "STORE_VISIT",
      creationIdempotencyKey: "frontdesk-venue-create-1",
    };

    await expect(request("POST", "/venues/bookings", base)).rejects.toThrow(
      "必须先选择会员",
    );

    await expect(
      request("POST", "/venues/bookings", { ...base, memberId: "member-2" }),
    ).rejects.toThrow("请先开班");
    await request("POST", "/operations/shifts/open", {
      openingCashCents: 10_000,
    });

    const order = await request("POST", "/venues/bookings", {
      ...base,
      memberId: "member-2",
    });
    expect(order).toMatchObject({
      member: { displayName: "羽友小周" },
      bookings: [expect.objectContaining({ status: "HELD" })],
    });
    expect(order).not.toHaveProperty("memberId");
    expect(order).not.toHaveProperty("createdById");
    expect(order).not.toHaveProperty("parameterSnapshot");
    const persistedOrder = getOrders().find((item) => item.id === order.id)!;
    expect(persistedOrder).toMatchObject({
      memberId: "member-2",
      createdById: "user-frontdesk",
      bookings: [expect.objectContaining({ memberId: "member-2" })],
      parameterSnapshot: expect.objectContaining({
        targetMemberId: "member-2",
        createdById: "user-frontdesk",
        operatorAssisted: true,
      }),
    });
    await expect(
      request("POST", "/venues/bookings", { ...base, memberId: "member-2" }),
    ).resolves.toEqual(order);
    await expect(
      request("POST", "/venues/bookings", { ...base, memberId: "member-1" }),
    ).rejects.toThrow("其他用户或其他创建指令");

    await login("MEMBER");
    await expect(
      request("POST", "/venues/bookings", {
        ...base,
        creationIdempotencyKey: "member-cannot-delegate-1",
        memberId: "member-2",
      }),
    ).rejects.toThrow("会员只能为本人预订场地");
  });

  it("requires an open shift for assisted cash collection and blocks staff account debits", async () => {
    const selfOrder = await request("POST", "/memberships/purchase", {
      productId: "member-regular",
      creationIdempotencyKey: "cash-gate-member-order-1",
    });
    await login("FINANCE");
    await expect(
      request("POST", `/orders/${selfOrder.id}/pay`, {
        channel: "CASH_PRINCIPAL",
        idempotencyKey: "cash-gate-finance-pay-1",
      }),
    ).rejects.toThrow("员工不得代扣");

    await login("FRONT_DESK");
    await expect(
      request("POST", "/venues/bookings", {
        memberId: "member-1",
        date: shanghaiDate(1),
        courtId: "court-1",
        slotId: "slot-2",
        sourceChannel: "STORE_VISIT",
        creationIdempotencyKey: "cash-gate-booking-1",
      }),
    ).rejects.toThrow("请先开班");
    await request("POST", "/operations/shifts/open", {
      openingCashCents: 10_000,
    });
    const order = await request("POST", "/venues/bookings", {
      memberId: "member-1",
      date: shanghaiDate(1),
      courtId: "court-1",
      slotId: "slot-2",
      sourceChannel: "STORE_VISIT",
      creationIdempotencyKey: "cash-gate-booking-1",
    });
    const paymentCommand = {
      channel: "OFFLINE_CASH",
      idempotencyKey: "cash-gate-offline-payment-1",
    };
    const paid = await request(
      "POST",
      `/orders/${order.id}/pay`,
      paymentCommand,
    );
    expect(paid).toMatchObject({ status: "SUCCEEDED" });
    await expect(
      request("POST", `/orders/${order.id}/pay`, paymentCommand),
    ).resolves.toEqual(paid);
    const adminOrder = (
      await request<any>("GET", "/orders/admin/all")
    ).items.find((item: any) => item.id === order.id);
    expect(adminOrder).toMatchObject({ paymentChannel: "OFFLINE_CASH" });
    expect(adminOrder).not.toHaveProperty("paymentOperatorId");
    expect(getOrders().find((item) => item.id === order.id)).toMatchObject({
      paymentOperatorId: "user-frontdesk",
    });
  });

  it("persistently replays all member order creations and rejects key reuse for another command or user", async () => {
    const eventDetail = getEventDetail("event-golden");
    eventDetail.status = "OPEN";
    eventDetail.registrationEndsAt = new Date(
      Date.now() + 2 * 86_400_000,
    ).toISOString();
    eventDetail.teams = [];
    saveEventDetail(eventDetail);
    await login("EVENT_MANAGER");
    const partnerInvite = await request<any>(
      "POST",
      "/events/event-golden/partner-invites",
    );
    await login("MEMBER");
    const before = await request<any>("GET", "/orders");
    const date = shanghaiDate(1);
    const scenarios = [
      {
        url: "/memberships/purchase",
        data: {
          productId: "member-regular",
          creationIdempotencyKey: "mock-create-membership-1",
        },
      },
      {
        url: "/memberships/recharge",
        data: {
          planId: "recharge-plan-mock-100",
          creationIdempotencyKey: "mock-create-recharge-1",
        },
      },
      {
        url: "/venues/bookings",
        data: {
          date,
          courtId: "court-1",
          slotId: "slot-1",
          sourceChannel: "MINI_PROGRAM",
          creationIdempotencyKey: "mock-create-booking-1",
        },
      },
      {
        url: "/training/purchase",
        data: {
          productId: "training-adult",
          sourceChannel: "MINI_PROGRAM",
          creationIdempotencyKey: "mock-create-training-1",
        },
      },
      {
        url: "/goods/orders",
        data: {
          items: [{ itemId: "goods-ball", quantity: 2 }],
          creationIdempotencyKey: "mock-create-goods-1",
        },
      },
      {
        url: "/games/game-weekend/register",
        data: {
          sourceChannel: "MINI_PROGRAM",
          creationIdempotencyKey: "mock-create-game-1",
        },
      },
      {
        url: "/events/event-golden/register",
        data: {
          name: "金羽测试队",
          partnerInviteCode: partnerInvite.partnerInviteCode,
          category: "MIXED_DOUBLES",
          sourceChannel: "MINI_PROGRAM",
          creationIdempotencyKey: "mock-create-event-1",
        },
      },
    ];

    for (const scenario of scenarios) {
      const first = await request("POST", scenario.url, scenario.data);
      const replay = await request("POST", scenario.url, {
        ...scenario.data,
      });
      expect(replay).toEqual(first);
    }

    const after = await request<any>("GET", "/orders");
    expect(after.total - before.total).toBe(scenarios.length);
    expect(
      after.items.filter((item: any) =>
        ["MEMBERSHIP", "RECHARGE", "GOODS"].includes(item.businessType),
      ),
    ).toHaveLength(3);

    await expect(
      request("POST", "/memberships/purchase", {
        productId: "member-gold",
        creationIdempotencyKey: "mock-create-membership-1",
      }),
    ).rejects.toThrow("其他用户或其他创建指令");

    await login("ADMIN");
    await expect(
      request("POST", "/memberships/purchase", scenarios[0].data),
    ).rejects.toThrow("其他用户或其他创建指令");
  });

  it("runs purchase maker/checker and idempotent partial receiving", async () => {
    await login("ADMIN");
    const [item] = await request<any[]>("GET", "/inventory");
    const [supplier] = await request<any[]>("GET", "/inventory/suppliers");
    const [location] = await request<any[]>("GET", "/inventory/locations");
    const stockBefore = item.stock;
    const order = await request("POST", "/inventory/purchase-orders", {
      supplierId: supplier.id,
      lines: [
        {
          itemId: item.id,
          locationId: location.id,
          orderedQuantity: 5,
          unitCostCents: item.purchasePriceCents,
          batchCode: "DEFAULT",
        },
      ],
    });
    await request("POST", `/inventory/purchase-orders/${order.id}/submit`);

    await login("SUPER_ADMIN");
    const approved = await request(
      "POST",
      `/inventory/purchase-orders/${order.id}/approve`,
    );
    expect(approved.status).toBe("APPROVED");

    await login("ADMIN");
    const command = {
      lines: [{ lineId: order.lines[0].id, quantity: 2 }],
      idempotencyKey: "purchase-receipt-request-1",
    };
    const receipt = await request(
      "POST",
      `/inventory/purchase-orders/${order.id}/receive`,
      command,
    );
    expect(receipt).not.toHaveProperty("idempotencyKey");
    expect(receipt).not.toHaveProperty("operatorId");
    await expect(
      request(
        "POST",
        `/inventory/purchase-orders/${order.id}/receive`,
        command,
      ),
    ).resolves.toEqual(receipt);
    const [updatedItem] = await request<any[]>("GET", "/inventory");
    expect(updatedItem.stock).toBe(stockBefore + 2);
    const [updatedOrder] = await request<any[]>(
      "GET",
      "/inventory/purchase-orders",
    );
    expect(updatedOrder).toMatchObject({ status: "PARTIAL_RECEIVED" });
    expect(JSON.stringify(updatedOrder.receipts)).not.toMatch(
      /idempotencyKey|operatorId/,
    );
  });

  it("keeps inventory command evidence out of administrator responses", async () => {
    await login("ADMIN");
    const [item] = await request<any[]>("GET", "/inventory");
    const now = new Date().toISOString();
    saveInventoryTransactions([
      {
        id: "inventory-private-transaction",
        itemId: item.id,
        type: "SALE_OUT",
        quantity: -1,
        stockBefore: 5,
        stockAfter: 4,
        reason: "前台零售",
        idempotencyKey: "inventory-private-key",
        metadata: { upstreamSecret: "private" },
        operatorId: "user-admin",
        createdAt: now,
      },
    ]);
    savePurchaseOrders([
      {
        id: "purchase-private",
        orderNo: "PO-PRIVATE",
        status: "PARTIAL_RECEIVED",
        supplierId: "supplier-owned",
        lines: [{ id: "line-private", itemId: item.id }],
        receipts: [
          {
            id: "receipt-private",
            purchaseOrderId: "purchase-private",
            idempotencyKey: "receipt-private-key",
            operatorId: "user-admin",
          },
        ],
      },
    ]);
    saveStocktakes([
      {
        id: "stocktake-private",
        stocktakeNo: "ST-PRIVATE",
        status: "POSTED",
        locationId: "location-main",
        lines: [],
        postIdempotencyKey: "stocktake-private-key",
      },
    ]);
    saveInventoryOperations([
      {
        id: "operation-private",
        documentNo: "TR-PRIVATE",
        status: "POSTED",
        itemId: item.id,
        sourceLocationId: "location-main",
        postIdempotencyKey: "operation-private-key",
        sourceTransactionId: "transaction-private-source",
        targetTransactionId: "transaction-private-target",
      },
    ]);

    const responses = await Promise.all([
      request("GET", "/inventory"),
      request("GET", "/inventory/purchase-orders"),
      request("GET", "/inventory/stocktakes"),
      request("GET", "/inventory/operations"),
    ]);
    expect(JSON.stringify(responses)).not.toMatch(
      /idempotencyKey|postIdempotencyKey|operatorId|metadata|sourceTransactionId|targetTransactionId|upstreamSecret/,
    );
  });

  it("keeps account adjustments pending until a different operator posts exactly one ledger entry", async () => {
    await login("FINANCE");
    const before = await request<any>("GET", "/members/member-1/360");
    const cashBefore = before.accounts.find(
      (account: any) => account.type === "CASH_PRINCIPAL",
    ).balance;
    const command = {
      accountType: "CASH_PRINCIPAL",
      amount: 1_250,
      reason: "线下收款差额补录",
      idempotencyKey: "account-adjustment-request-1",
    };

    const requested = await request(
      "POST",
      "/members/member-1/accounts/adjust",
      command,
    );
    expect(requested).toMatchObject({
      status: "REQUESTED",
      isOwnRequest: true,
      amount: 1_250,
    });
    expect(requested).not.toHaveProperty("requestedById");
    expect(requested).not.toHaveProperty("requestIdempotencyKey");
    expect(requested).not.toHaveProperty("commandHash");
    await expect(
      request("POST", "/members/member-1/accounts/adjust", command),
    ).resolves.toMatchObject({ id: requested.id, status: "REQUESTED" });
    await expect(
      request("POST", "/members/member-1/accounts/adjust", {
        ...command,
        amount: 1_251,
      }),
    ).rejects.toThrow("幂等键已用于不同的账户调整申请");

    const stillPending = await request<any>("GET", "/members/member-1/360");
    expect(
      stillPending.accounts.find(
        (account: any) => account.type === "CASH_PRINCIPAL",
      ).balance,
    ).toBe(cashBefore);
    await expect(
      request("POST", `/members/account-adjustments/${requested.id}/reject`, {
        reason: "自己不能复核",
      }),
    ).rejects.toThrow("申请人与复核人不能是同一账号");
    expect(
      (await request<any[]>("GET", "/work-items")).some(
        (item) => item.objectId === requested.id,
      ),
    ).toBe(false);

    await login("ADMIN");
    expect(
      (await request<any[]>("GET", "/work-items")).some(
        (item) =>
          item.kind === "ACCOUNT_ADJUSTMENT_REVIEW" &&
          item.objectId === requested.id,
      ),
    ).toBe(true);
    const posted = await request(
      "POST",
      `/members/account-adjustments/${requested.id}/approve`,
      { reason: "原始收款凭证核验无误" },
    );
    expect(posted).toMatchObject({
      status: "POSTED",
      transaction: {
        amount: 1_250,
        balanceBefore: cashBefore,
        balanceAfter: cashBefore + 1_250,
      },
    });
    expect(posted).not.toHaveProperty("reviewedById");
    expect(posted).not.toHaveProperty("transactionId");
    expect(posted.transaction).not.toHaveProperty("operatorId");
    expect(posted.transaction).not.toHaveProperty("idempotencyKey");
    expect(posted.transaction).not.toHaveProperty("metadata");
    const replay = await request(
      "POST",
      `/members/account-adjustments/${requested.id}/approve`,
      { reason: "重复点击仍应幂等" },
    );
    expect(replay).toMatchObject({
      id: requested.id,
      status: "POSTED",
    });

    const after = await request<any>("GET", "/members/member-1/360");
    expect(
      after.accounts.find((account: any) => account.type === "CASH_PRINCIPAL")
        .balance,
    ).toBe(cashBefore + 1_250);
    expect(
      getMemberAccountTransactions().filter(
        (transaction) => transaction.metadata?.requestId === requested.id,
      ),
    ).toHaveLength(1);

    await login("FINANCE");
    const toReject = await request(
      "POST",
      "/members/member-1/accounts/adjust",
      {
        accountType: "CASH_PRINCIPAL",
        amount: -250,
        reason: "待复核差额撤销",
        idempotencyKey: "account-adjustment-request-2",
      },
    );
    await login("ADMIN");
    await expect(
      request("POST", `/members/account-adjustments/${toReject.id}/reject`, {
        reason: "缺少有效原始凭证",
      }),
    ).resolves.toMatchObject({ status: "REJECTED" });
    const afterRejection = await request<any>("GET", "/members/member-1/360");
    expect(
      afterRejection.accounts.find(
        (account: any) => account.type === "CASH_PRINCIPAL",
      ).balance,
    ).toBe(cashBefore + 1_250);
    const rejectedRequests = await request<any[]>(
      "GET",
      "/members/account-adjustments",
      { status: "REJECTED" },
    );
    expect(rejectedRequests.map((item) => item.id)).toContain(toReject.id);
    expect(JSON.stringify(rejectedRequests)).not.toMatch(
      /requestIdempotencyKey|commandHash|requestedById|reviewedById|transactionId|operatorId|metadata/,
    );
    await login("MEMBER");
    const ledger = await request<any[]>(
      "GET",
      "/members/me/accounts/transactions",
    );
    expect(JSON.stringify(ledger)).not.toMatch(
      /idempotencyKey|commandHash|operatorId|metadata|accountId|orderId/,
    );
    expect(getMemberAccountTransactions()).toHaveLength(1);
  });

  it("persists a front-desk shift, scopes history and closes with an auditable handover snapshot", async () => {
    await expect(
      request("POST", "/operations/shifts/open", {
        openingCashCents: 10_000,
      }),
    ).rejects.toThrow("当前角色无权");

    await login("FRONT_DESK");
    const opened = await request("POST", "/operations/shifts/open", {
      openingCashCents: 10_000,
    });
    expect(opened).toMatchObject({
      status: "OPEN",
      operatorId: "user-frontdesk",
      openingCashCents: 10_000,
    });
    await expect(
      request("POST", "/operations/shifts/open", {
        openingCashCents: 10_000,
      }),
    ).resolves.toMatchObject({ id: opened.id, status: "OPEN" });
    await expect(
      request("POST", "/operations/shifts/open", {
        openingCashCents: 9_000,
      }),
    ).rejects.toThrow("不同备用金");

    await request("POST", "/venues/bookings", {
      memberId: "member-1",
      date: shanghaiDate(1),
      courtId: "court-1",
      slotId: "slot-2",
      sourceChannel: "STORE_VISIT",
      creationIdempotencyKey: "shift-assisted-booking-1",
    });
    expect(await request("GET", "/operations/shifts/current")).toMatchObject({
      id: opened.id,
      status: "OPEN",
    });

    await login("ADMIN");
    expect(
      (
        await request<any[]>("GET", "/operations/shifts/history", {
          operatorId: "user-frontdesk",
        })
      ).map((shift) => shift.id),
    ).toContain(opened.id);
    const closeCommand = {
      closingCashCents: 10_500,
      handoverNote: "现金已点清，待处理订单交下一班",
      reason: "前台临时离岗，管理员代关",
    };
    await expect(
      request("POST", `/operations/shifts/${opened.id}/close`, {
        ...closeCommand,
        reason: undefined,
      }),
    ).rejects.toThrow("管理员代关班次必须填写原因");
    const closed = await request(
      "POST",
      `/operations/shifts/${opened.id}/close`,
      closeCommand,
    );
    expect(closed).toMatchObject({
      status: "CLOSED",
      closingCashCents: 10_500,
      expectedCashCents: 10_000,
      cashVarianceCents: 500,
      closedById: "user-admin",
      pendingSnapshot: {
        pendingOrders: { count: 1 },
      },
      auditTrail: [
        { action: "FRONT_DESK_SHIFT_OPENED" },
        { action: "FRONT_DESK_SHIFT_CLOSED" },
      ],
    });
    await expect(
      request("POST", `/operations/shifts/${opened.id}/close`, closeCommand),
    ).resolves.toMatchObject({ id: opened.id, status: "CLOSED" });
    await expect(
      request("POST", `/operations/shifts/${opened.id}/close`, {
        ...closeCommand,
        closingCashCents: 10_501,
      }),
    ).rejects.toThrow("另一组关班数据");

    await expect(
      request("POST", `/operations/shifts/${opened.id}/review-variance`, {
        reason: "管理员参与关班，不能自行复核",
      }),
    ).rejects.toThrow("不能复核自己的现金差异");
    await login("FINANCE");
    expect(
      (
        await request<any[]>("GET", "/operations/shifts/history", {
          status: "CLOSED",
        })
      ).map((shift) => shift.id),
    ).toContain(opened.id);
    const reviewCommand = { reason: "盘点凭证确认多收现金五元" };
    await expect(
      request(
        "POST",
        `/operations/shifts/${opened.id}/review-variance`,
        reviewCommand,
      ),
    ).resolves.toMatchObject({
      id: opened.id,
      varianceReviewedById: "user-finance",
      varianceReviewReason: reviewCommand.reason,
    });
    await expect(
      request(
        "POST",
        `/operations/shifts/${opened.id}/review-variance`,
        reviewCommand,
      ),
    ).resolves.toMatchObject({ id: opened.id });

    await login("FRONT_DESK");
    expect(await request("GET", "/operations/shifts/current")).toMatchObject({
      id: opened.id,
      status: "CLOSED",
    });
    await expect(
      request("POST", "/operations/shifts/open", {
        openingCashCents: 10_000,
      }),
    ).rejects.toThrow("已经关闭");
  });

  it("persists the training settlement maker/checker state machine and honors locked periods", async () => {
    await expect(request("GET", "/training/settlements")).rejects.toThrow(
      "当前角色无权",
    );
    await login("FINANCE");
    const [draft] = await request<any[]>("GET", "/training/settlements", {
      status: "DRAFT",
    });
    expect(draft).toMatchObject({
      status: "DRAFT",
      isOwnCreator: true,
      createdBy: { displayName: "金羽财务" },
    });
    expect(JSON.stringify(draft.workflowHistory)).not.toMatch(
      /actorId|actorName|oldValue|newValue|commandHash/,
    );
    expect(draft).not.toHaveProperty("processedIdempotencyKeys");
    expect(draft).not.toHaveProperty("createdById");
    expect(draft).not.toHaveProperty("confirmedById");
    expect(draft.createdBy).not.toHaveProperty("id");
    expect(
      (await request<any[]>("GET", "/work-items")).some(
        (item) =>
          item.kind === "TRAINING_SETTLEMENT" && item.objectId === draft.id,
      ),
    ).toBe(true);

    const submitted = await request(
      "POST",
      `/training/settlements/${draft.id}/submit`,
      {
        reason: "消课明细已核对",
        idempotencyKey: "training-settlement-submit-1",
      },
    );
    expect(submitted).toMatchObject({ status: "PENDING_CONFIRMATION" });
    await expect(
      request("POST", `/training/settlements/${draft.id}/confirm`, {
        reason: "自己不能复核",
        idempotencyKey: "training-settlement-confirm-self",
      }),
    ).rejects.toThrow("制单人不能确认");

    await login("ADMIN");
    const confirmed = await request(
      "POST",
      `/training/settlements/${draft.id}/confirm`,
      {
        reason: "合同与成本凭证一致",
        idempotencyKey: "training-settlement-confirm-1",
      },
    );
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      isOwnCreator: false,
    });
    expect(confirmed).not.toHaveProperty("confirmedById");
    await expect(
      request("POST", `/training/settlements/${draft.id}/confirm`, {
        reason: "合同与成本凭证一致",
        idempotencyKey: "training-settlement-confirm-1",
      }),
    ).resolves.toMatchObject({ id: draft.id, status: "CONFIRMED" });
    const settled = await request(
      "POST",
      `/training/settlements/${draft.id}/settle`,
      {
        reason: "入账凭证已归档",
        idempotencyKey: "training-settlement-settle-1",
      },
    );
    expect(settled).toMatchObject({ status: "SETTLED" });
    const settlementAfterSettle = (
      await request<any[]>("GET", "/training/settlements")
    ).find((item) => item.id === draft.id);
    expect(
      settlementAfterSettle.workflowHistory.map((item: any) => item.action),
    ).toEqual([
      "TRAINING_SETTLEMENT_CREATED",
      "TRAINING_SETTLEMENT_SUBMITTED",
      "TRAINING_SETTLEMENT_CONFIRMED",
      "TRAINING_SETTLEMENT_SETTLED",
    ]);

    const lockedDate = shanghaiDate(-2);
    await request("POST", `/reconciliation/periods/${lockedDate}/close`, {
      reason: "历史营业日核对完成",
    });
    await expect(
      request("POST", "/training/settlements", {
        periodStart: new Date(`${lockedDate}T00:00:00+08:00`).toISOString(),
        periodEnd: new Date(`${shanghaiDate(-1)}T00:00:00+08:00`).toISOString(),
        acquisitionCostCents: 0,
        marketingCostCents: 0,
      }),
    ).rejects.toThrow("已锁定营业日");
  });

  it("enforces role boundaries and only locks an ended Shanghai business day", async () => {
    await expect(
      request("POST", "/inventory/goods-ball/transactions", {
        type: "SALE_OUT",
        quantity: -1,
        reason: "无权出库",
        idempotencyKey: "member-stock-request-1",
      }),
    ).rejects.toThrow("当前角色无权");

    await login("FINANCE");
    await expect(
      request("POST", `/reconciliation/periods/${shanghaiDate()}/close`, {
        reason: "错误地提前关账",
      }),
    ).rejects.toThrow("营业日结束后才可关账");
    const blockedDate = shanghaiDate(-1);
    saveFrontDeskShifts([
      {
        id: "shift-unreviewed-variance",
        businessDate: new Date(`${blockedDate}T00:00:00+08:00`).toISOString(),
        businessDateLabel: blockedDate,
        venueCode: "MAIN",
        operatorId: "user-frontdesk",
        openedById: "user-frontdesk",
        closedById: "user-admin",
        status: "CLOSED",
        openedAt: new Date(`${blockedDate}T01:00:00+08:00`).toISOString(),
        closedAt: new Date(`${blockedDate}T10:00:00+08:00`).toISOString(),
        openingCashCents: 10_000,
        closingCashCents: 10_500,
        expectedCashCents: 10_000,
        cashVarianceCents: 500,
        varianceReviewedById: null,
        varianceReviewedAt: null,
        varianceReviewReason: null,
      },
    ]);
    const review = await request(
      "POST",
      `/reconciliation/periods/${blockedDate}/close`,
      {
        reason: "昨日流水核对完成",
      },
    );
    expect(review).toMatchObject({
      status: "REVIEW",
      blocked: true,
      blockers: [
        expect.objectContaining({ kind: "UNREVIEWED_CASH_VARIANCES" }),
      ],
    });
    await request(
      "POST",
      "/operations/shifts/shift-unreviewed-variance/review-variance",
      { reason: "盘点凭证已核对并记录差异" },
    );
    const closed = await request(
      "POST",
      `/reconciliation/periods/${blockedDate}/close`,
      { reason: "差异已复核，完成关账" },
    );
    expect(closed).toMatchObject({ status: "LOCKED", exceptionCount: 0 });
  });
});
