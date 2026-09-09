import { mockUser } from "../core";
import { getFrontDeskShifts } from "../state";
import { hasMockRole } from "./common.js";
import { mockActorIdentity } from "./members.js";

export const mockShanghaiBusinessDate = (value = new Date()) => {
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
};

export const frontDeskShiftView = (shift: any) => ({
  ...shift,
  operator: mockActorIdentity(shift.operatorId),
  openedBy: mockActorIdentity(shift.openedById),
  closedBy: shift.closedById ? mockActorIdentity(shift.closedById) : null,
  varianceReviewedBy: shift.varianceReviewedById
    ? mockActorIdentity(shift.varianceReviewedById)
    : null,
});

export const requireMockOpenFrontDeskShift = () => {
  if (hasMockRole("ADMIN", "SUPER_ADMIN")) return null;
  if (!hasMockRole("FRONT_DESK"))
    throw new Error("仅已开班前台或管理员可执行该操作");
  const businessDate = mockShanghaiBusinessDate();
  const shift = getFrontDeskShifts().find(
    (item) =>
      item.businessDateLabel === businessDate &&
      item.venueCode === "MAIN" &&
      item.operatorId === mockUser().id &&
      item.status === "OPEN",
  );
  if (!shift) throw new Error("当前前台未开班或今日班次已关闭，请先开班");
  return shift;
};
