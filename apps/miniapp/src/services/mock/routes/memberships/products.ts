import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { getMembershipProducts, saveMembershipProducts } from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import {
  mockVersionedMasterView,
  requireMasterReason,
  mockCommercialRange,
  mockCommercialRangesOverlap,
  mockCurrentlyEffective,
  mockOperatingShareSnapshot,
  saveMockMasterAudit,
} from "../../policies/master-data.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleMembershipsProductsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/products" && method === "GET") {
    const now = Date.now();
    return {
      handled: true,
      value: ok(
        getMembershipProducts()
          .filter((product) => mockCurrentlyEffective(product, now))
          .sort(
            (left, right) =>
              Number(left.priceCents) - Number(right.priceCents) ||
              String(left.code).localeCompare(String(right.code)) ||
              Number(right.version) - Number(left.version),
          )
          .map((product) => {
            const { transitions: _transitions, ...view } =
              mockVersionedMasterView(product);
            return view;
          }),
      ),
    };
  }
  return { handled: false };
}

export async function handleMembershipsProductsManageGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/products/manage" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        getMembershipProducts()
          .sort(
            (left, right) =>
              String(left.code).localeCompare(String(right.code)) ||
              Number(right.version) - Number(left.version),
          )
          .map(mockVersionedMasterView),
      ),
    };
  }
  return { handled: false };
}

export async function handleMembershipsProductsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/products" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const products = getMembershipProducts();
    const code = text(data.code);
    const name = text(data.name);
    const level = text(data.level);
    const priceCents = integer(data.priceCents);
    const durationDays = integer(data.durationDays);
    const benefits = data.benefits;
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "会员产品创建幂等键",
    );
    const { effectiveFrom, effectiveTo } = mockCommercialRange(
      data,
      "会员产品",
    );
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))
      throw new Error("会员产品编码格式无效");
    if (name.length < 2 || name.length > 80)
      throw new Error("会员产品名称长度必须为2-80个字符");
    if (!["EXPERIENCE", "REGULAR", "GOLD", "BLACK"].includes(level))
      throw new Error("会员等级无效");
    if (
      !Number.isInteger(priceCents) ||
      priceCents < 0 ||
      priceCents > 10_000_000
    )
      throw new Error("会员产品价格无效");
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 3_650
    )
      throw new Error("会员产品有效天数必须为1-3650天");
    if (!benefits || typeof benefits !== "object" || Array.isArray(benefits))
      throw new Error("会员权益必须为结构化对象");
    const commandHash = creationCommandHash({
      sourceProductId: null,
      code,
      name,
      level,
      priceCents,
      durationDays,
      benefits,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      reason,
    });
    const replay = products.find(
      (product) => product.creationIdempotencyKey === idempotencyKey,
    );
    if (replay) {
      if (
        replay.createdById !== mockUser().id ||
        replay.creationCommandHash !== commandHash
      )
        throw new Error("会员产品创建幂等键已用于其他命令或操作人");
      return { handled: true, value: ok(mockVersionedMasterView(replay)) };
    }
    if (products.some((product) => product.code === code))
      throw new Error("会员产品编码已存在，请从已有版本创建新版本");
    const now = new Date().toISOString();
    const created = {
      id: newId("membership-product"),
      code,
      version: 1,
      name,
      level,
      priceCents,
      durationDays,
      benefits,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      enabled: false,
      creationIdempotencyKey: idempotencyKey,
      creationCommandHash: commandHash,
      createdById: mockUser().id,
      createdBy: { id: mockUser().id, displayName: mockUser().displayName },
      transitions: [],
      createdAt: now,
      updatedAt: now,
    };
    saveMembershipProducts([created, ...products]);
    saveMockMasterAudit({
      action: "MEMBERSHIP_PRODUCT_VERSION_CREATED",
      objectType: "MembershipProduct",
      objectId: created.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: null,
      newValue: {
        code,
        version: 1,
        name,
        level,
        priceCents,
        durationDays,
        benefits,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
        enabled: false,
      },
      reason,
    });
    return { handled: true, value: ok(mockVersionedMasterView(created)) };
  }
  return { handled: false };
}

export async function handleMembershipProductVersionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const membershipProductVersionMatch = url.match(
    /^\/memberships\/products\/([^/]+)\/versions$/,
  );
  if (membershipProductVersionMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const products = getMembershipProducts();
    const source = products.find(
      (product) => product.id === membershipProductVersionMatch[1],
    );
    if (!source) throw new Error("会员产品源版本不存在");
    const name = text(data.name);
    const level = text(data.level);
    const priceCents = integer(data.priceCents);
    const durationDays = integer(data.durationDays);
    const benefits = data.benefits;
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "会员产品版本创建幂等键",
    );
    const { effectiveFrom, effectiveTo } = mockCommercialRange(
      data,
      "会员产品",
    );
    if (name.length < 2 || name.length > 80)
      throw new Error("会员产品名称长度必须为2-80个字符");
    if (!["EXPERIENCE", "REGULAR", "GOLD", "BLACK"].includes(level))
      throw new Error("会员等级无效");
    if (
      !Number.isInteger(priceCents) ||
      priceCents < 0 ||
      priceCents > 10_000_000
    )
      throw new Error("会员产品价格无效");
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 3_650
    )
      throw new Error("会员产品有效天数必须为1-3650天");
    if (!benefits || typeof benefits !== "object" || Array.isArray(benefits))
      throw new Error("会员权益必须为结构化对象");
    const commandHash = creationCommandHash({
      sourceProductId: source.id,
      code: source.code,
      name,
      level,
      priceCents,
      durationDays,
      benefits,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      reason,
    });
    const replay = products.find(
      (product) => product.creationIdempotencyKey === idempotencyKey,
    );
    if (replay) {
      if (
        replay.createdById !== mockUser().id ||
        replay.creationCommandHash !== commandHash
      )
        throw new Error("会员产品创建幂等键已用于其他命令或操作人");
      return { handled: true, value: ok(mockVersionedMasterView(replay)) };
    }
    const version =
      Math.max(
        ...products
          .filter((product) => product.code === source.code)
          .map((product) => Number(product.version)),
      ) + 1;
    const now = new Date().toISOString();
    const created = {
      id: newId("membership-product"),
      code: source.code,
      version,
      name,
      level,
      priceCents,
      durationDays,
      benefits,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      enabled: false,
      creationIdempotencyKey: idempotencyKey,
      creationCommandHash: commandHash,
      createdById: mockUser().id,
      createdBy: { id: mockUser().id, displayName: mockUser().displayName },
      transitions: [],
      createdAt: now,
      updatedAt: now,
    };
    saveMembershipProducts([created, ...products]);
    saveMockMasterAudit({
      action: "MEMBERSHIP_PRODUCT_VERSION_CREATED",
      objectType: "MembershipProduct",
      objectId: created.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: null,
      newValue: {
        sourceProductId: source.id,
        code: source.code,
        version,
        name,
        level,
        priceCents,
        durationDays,
        benefits,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
        enabled: false,
      },
      reason,
    });
    return { handled: true, value: ok(mockVersionedMasterView(created)) };
  }
  return { handled: false };
}

export async function handleMembershipProductStatusPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const membershipProductStatusMatch = url.match(
    /^\/memberships\/products\/([^/]+)\/status$/,
  );
  if (membershipProductStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    if (typeof data.enabled !== "boolean")
      throw new Error("会员产品状态必须为布尔值");
    const productId = membershipProductStatusMatch[1];
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "会员产品状态幂等键",
    );
    const commandHash = creationCommandHash({
      productId,
      enabled: data.enabled,
      reason,
    });
    const products = getMembershipProducts();
    const replay = products
      .flatMap((product) =>
        (product.transitions || []).map((transition: any) => ({
          product,
          transition,
        })),
      )
      .find(({ transition }) => transition.idempotencyKey === idempotencyKey);
    if (replay) {
      if (
        replay.product.id !== productId ||
        replay.transition.actorId !== mockUser().id ||
        replay.transition.commandHash !== commandHash
      )
        throw new Error("会员产品状态幂等键已用于其他命令或操作人");
      return {
        handled: true,
        value: ok({
          ...mockVersionedMasterView(replay.product),
          enabled: replay.transition.newEnabled,
          transition: mockVersionedMasterView({
            transitions: [replay.transition],
          }).transitions[0],
          idempotent: true,
        }),
      };
    }
    const product = products.find((item) => item.id === productId);
    if (!product) throw new Error("会员产品不存在");
    if (product.enabled === data.enabled)
      throw new Error(data.enabled ? "会员产品已启用" : "会员产品已停用");
    if (
      data.enabled &&
      products.some(
        (candidate) =>
          candidate.id !== product.id &&
          candidate.code === product.code &&
          candidate.enabled === true &&
          mockCommercialRangesOverlap(candidate, product),
      )
    )
      throw new Error("同编码已启用版本的有效期与当前版本重叠");
    const transition = {
      id: newId("membership-product-transition"),
      membershipProductId: product.id,
      oldEnabled: product.enabled,
      newEnabled: data.enabled,
      reason,
      actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      idempotencyKey,
      commandHash,
      createdAt: new Date().toISOString(),
    };
    product.enabled = data.enabled;
    product.transitions = [transition, ...(product.transitions || [])];
    product.updatedAt = transition.createdAt;
    saveMembershipProducts(products);
    saveMockMasterAudit({
      action: "MEMBERSHIP_PRODUCT_STATUS_SET",
      objectType: "MembershipProduct",
      objectId: product.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: { enabled: transition.oldEnabled },
      newValue: { enabled: transition.newEnabled, version: product.version },
      reason,
    });
    return {
      handled: true,
      value: ok({
        ...mockVersionedMasterView(product),
        transition: mockVersionedMasterView({ transitions: [transition] })
          .transitions[0],
        idempotent: false,
      }),
    };
  }
  return { handled: false };
}

export async function handleMembershipsPurchasePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/purchase" && method === "POST") {
    const productId = text(data.productId);
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "MEMBERSHIP_PURCHASE",
      productId,
    });
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const product = getMembershipProducts().find(
      (item) => item.id === productId && mockCurrentlyEffective(item),
    );
    if (!product) throw new Error("会员产品不存在、未生效或已停用");
    const now = new Date();
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("MB"),
      title: product.name,
      status: "PENDING",
      businessType: "MEMBERSHIP",
      listAmountCents: product.priceCents,
      payableCents: product.priceCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt: now.toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: {
        productId: product.id,
        productCode: product.code,
        productVersion: product.version,
        productName: product.name,
        level: product.level,
        priceCents: product.priceCents,
        durationDays: product.durationDays,
        benefits: product.benefits,
        effectiveFrom: product.effectiveFrom,
        effectiveTo: product.effectiveTo,
        operatingShare: mockOperatingShareSnapshot("MEMBERSHIP", now),
      },
      membership: {
        status: "FROZEN",
        startsAt: now.toISOString(),
        endsAt: new Date(
          now.getTime() + product.durationDays * 86_400_000,
        ).toISOString(),
      },
    };
    saveOrders([order, ...getOrders()]);
    return { handled: true, value: finishMockOrderCreation(creation, order) };
  }
  return { handled: false };
}
