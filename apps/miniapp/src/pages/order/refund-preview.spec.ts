import { expect, it } from "vitest";
import type { OrderView } from "@yanqing/shared";
import { refundDestination } from "./refund-preview";
it("shows cash handling only for the successful payment method", () => {
  const order = {
    paymentChannel: "WECHAT",
    payments: [
      { channel: "OFFLINE_CASH", status: "FAILED" },
      { channel: "WECHAT", status: "SUCCEEDED" },
    ],
  } as OrderView;
  expect(refundDestination(order)).toEqual({
    cash: false,
    label: "微信原路退回",
  });
  expect(
    refundDestination({ paymentChannel: "OFFLINE_CASH" } as OrderView),
  ).toEqual({ cash: true, label: "现场退回现金" });
  expect(
    refundDestination({ paymentChannel: "CASH_PRINCIPAL" } as OrderView),
  ).toEqual({ cash: false, label: "退回本金余额" });
});
