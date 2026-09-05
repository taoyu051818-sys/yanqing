import type { WorkItem } from "../services/api";

export type OpsPage =
  | "members"
  | "finance"
  | "coach"
  | "event"
  | "host"
  | "frontdesk"
  | "inventory"
  | "governance";

export interface OpsDeepLinkQuery {
  focus?: string;
  id?: string;
  orderId?: string;
  eventId?: string;
  gameId?: string;
  sessionId?: string;
  attendanceId?: string;
  userId?: string;
  round?: string;
}

export interface WorkItemDestination {
  page: OpsPage;
  path: string;
  query: OpsDeepLinkQuery;
  url: string;
}

const pagePath = (page: OpsPage) =>
  `/packages/ops/pages/${page}/index`;

const defaultFocusByPage: Record<OpsPage, string> = {
  members: "member",
  finance: "reconciliation",
  coach: "session",
  event: "event",
  host: "game",
  frontdesk: "order",
  inventory: "stock",
  governance: "privacy",
};

const kindPlan: Record<string, { page: OpsPage; focus: string }> = {
  CUSTOMER_LEAD_SLA: { page: "members", focus: "lead" },
  HOST_APPLICATION_REVIEW: { page: "members", focus: "host-application" },
  ACCOUNT_ADJUSTMENT_REVIEW: { page: "finance", focus: "account-adjustment" },
  REFUND_REVIEW: { page: "finance", focus: "refund" },
  TRAINING_CONSUME_CORRECTION_REVIEW: {
    page: "coach",
    focus: "consume-correction",
  },
  TRAINING_SESSION_OPERATION: { page: "coach", focus: "session" },
  TRAINING_ATTENDANCE: { page: "coach", focus: "attendance" },
  TRAINING_CONSUME: { page: "coach", focus: "attendance" },
  TRAINING_TRIAL: { page: "coach", focus: "trial" },
  EVENT_SCORE: { page: "event", focus: "score" },
  EVENT_PRIZE_RECEIPT: { page: "event", focus: "prize" },
  ALLIANCE_SETTLEMENT: { page: "finance", focus: "alliance-settlement" },
  TRAINING_SETTLEMENT: { page: "finance", focus: "training-settlement" },
  CONSIGNMENT_SETTLEMENT: {
    page: "finance",
    focus: "consignment-settlement",
  },
  RECONCILIATION: { page: "finance", focus: "reconciliation" },
  LOW_STOCK: { page: "inventory", focus: "low-stock" },
  INVENTORY: { page: "inventory", focus: "stock" },
  ORDER_FULFILLMENT: { page: "frontdesk", focus: "order" },
  GAME_OPERATION: { page: "host", focus: "game" },
  HOST_GAME: { page: "host", focus: "game" },
  DATA_ERASURE_REVIEW: { page: "governance", focus: "privacy" },
};

const normalize = (value: unknown) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const text = (value: unknown) => {
  const result =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  return result || undefined;
};

const safePageAction = (action?: string) => {
  if (!action) return null;
  const [path, rawQuery = ""] = action.trim().split("?", 2);
  const matched = path.match(
    /^\/packages\/ops\/pages\/(members|finance|coach|event|host|frontdesk|inventory|governance)\/index$/,
  );
  if (!matched) return null;
  const page = matched[1] as OpsPage;
  const query: OpsDeepLinkQuery = {};
  for (const pair of rawQuery.split("&").filter(Boolean)) {
    const [rawKey, ...rawValue] = pair.split("=");
    const key = decodeURIComponent(rawKey || "");
    const value = decodeURIComponent(rawValue.join("=") || "");
    if (
      [
        "focus",
        "id",
        "orderId",
        "eventId",
        "gameId",
        "sessionId",
        "attendanceId",
        "userId",
        "round",
      ].includes(key)
    ) {
      (query as Record<string, string>)[key] = value;
    }
  }
  return { page, path, query };
};

const legacyActionPlan = (action?: string) => {
  if (!action) return null;
  const patterns: Array<{
    pattern: RegExp;
    page: OpsPage;
    focus: string;
  }> = [
    { pattern: /^\/members\/leads\/([^/]+)$/, page: "members", focus: "lead" },
    {
      pattern: /^\/games\/hosts\/([^/]+)\/approve$/,
      page: "members",
      focus: "host-application",
    },
    {
      pattern: /^\/orders\/refunds\/([^/]+)\/approve$/,
      page: "finance",
      focus: "refund",
    },
    {
      pattern: /^\/training\/consume-corrections\/([^/]+)\/approve$/,
      page: "coach",
      focus: "consume-correction",
    },
  ];
  for (const entry of patterns) {
    const match = action.match(entry.pattern);
    if (match) {
      return {
        page: entry.page,
        path: pagePath(entry.page),
        query: { focus: entry.focus, id: decodeURIComponent(match[1]) },
      };
    }
  }
  return null;
};

const metadataQuery = (item: WorkItem): OpsDeepLinkQuery => {
  const metadata = item.metadata || {};
  const query: OpsDeepLinkQuery = {};
  const keys: Array<keyof OpsDeepLinkQuery> = [
    "focus",
    "id",
    "orderId",
    "eventId",
    "gameId",
    "sessionId",
    "attendanceId",
    "userId",
    "round",
  ];
  for (const key of keys) {
    const value = text(metadata[key]);
    if (value) query[key] = value;
  }
  return query;
};

const urlFor = (path: string, query: OpsDeepLinkQuery) => {
  const params = Object.entries(query).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
  if (!params.length) return path;
  return `${path}?${params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")}`;
};

/** Resolve a queue record into an allow-listed operations-page deep link. */
export function resolveWorkItemDestination(
  item: WorkItem,
): WorkItemDestination | null {
  const direct = safePageAction(item.action) || legacyActionPlan(item.action);
  const plan = kindPlan[normalize(item.kind)];
  if (!direct && !plan) return null;

  const page = direct?.page || plan!.page;
  const path = direct?.path || pagePath(page);
  const metadata = metadataQuery(item);
  const query: OpsDeepLinkQuery = {
    focus: plan?.focus || direct?.query.focus || defaultFocusByPage[page],
    ...(text(item.objectId) ? { id: text(item.objectId) } : {}),
    ...metadata,
    ...(direct?.query || {}),
  };
  if (normalize(item.objectType) === "ORDER" && !query.orderId) {
    query.orderId = text(item.objectId);
  }
  if (page === "event" && !query.eventId) {
    query.eventId = text(metadata.eventId);
  }
  if (page === "host" && !query.gameId) {
    query.gameId = text(metadata.gameId) || text(item.objectId);
  }
  return { page, path, query, url: urlFor(path, query) };
}

export function parseOpsDeepLinkQuery(
  value?: Record<string, unknown> | null,
): OpsDeepLinkQuery {
  if (!value) return {};
  return metadataQuery({ metadata: value } as WorkItem);
}

export function deepLinkTargetIds(query: OpsDeepLinkQuery): string[] {
  return [
    query.id,
    query.orderId,
    query.eventId,
    query.gameId,
    query.sessionId,
    query.attendanceId,
    query.userId,
  ].filter((value, index, values): value is string =>
    Boolean(value) && values.indexOf(value) === index,
  );
}

export function findOpsDeepLinkRecord<T extends Record<string, any>>(
  records: readonly T[],
  query: OpsDeepLinkQuery,
  keys: string[] = ["id", "orderId", "objectId"],
): T | null {
  const targets = new Set(deepLinkTargetIds(query));
  if (!targets.size) return null;
  return records.find((record) =>
    keys.some((key) => {
      const value = record[key];
      return value !== undefined && value !== null && targets.has(String(value));
    }),
  ) || null;
}

export function opsDeepLinkDomId(prefix: string, id: unknown) {
  return `${prefix}-${String(id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
