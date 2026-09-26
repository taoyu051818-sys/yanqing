import type { TrainingProductView, TrainingSessionView } from "@yanqing/shared";
import { dateTimeRange } from "../../../../../utils/format";

export function trialSessionOptions(sessions: TrainingSessionView[]) {
  return sessions.map(session => ({
    id: session.id,
    label: `${session.class?.name || "培训班级"} · ${dateTimeRange(session.startsAt, session.endsAt)}`,
  }));
}

interface TrialSetupGap {
  title: string;
  detail: string;
  view: string;
  label: string;
  context: Record<string, string>;
  permission: "configure" | "schedule";
}
export function trialSetupGap(products: TrainingProductView[], isStudent: boolean, hasSessions: boolean): TrialSetupGap | null {
  if (hasSessions) return null;
  const suitable = products.filter(product => product.enabled !== false &&
    (isStudent ? product.audience !== "ADULT" : product.audience !== "YOUTH"));
  if (!suitable.length) return {
    title: "还没有适合该学员的在售课程", detail: "先创建或启用课程，再创建班级和安排上课时间。",
    view: "create-product", label: "去建课程", context: { audience: isStudent ? "YOUTH" : "ADULT" },
    permission: "configure" as const,
  };
  const classes = suitable.flatMap(product => product.classes.filter(item => item.active !== false));
  if (!classes.length) return {
    title: "课程还没有班级", detail: "先创建班级并指定教练，再安排试听时间。",
    view: "create-class", label: "去建班级", context: { productId: suitable[0].id },
    permission: "configure" as const,
  };
  return {
    title: "暂无可预约的上课时间", detail: "先为班级安排课次和场地，返回后继续预约。",
    view: "create-session", label: "去排课", context: { classId: classes[0].id },
    permission: "schedule" as const,
  };
}
