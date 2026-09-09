export type LoadSource =
  | "dashboard"
  | "refunds"
  | "training"
  | "trainingSettlements"
  | "merchants"
  | "settlements"
  | "consignmentSuppliers"
  | "consignmentPayables"
  | "consignmentSettlements"
  | "reconciliation"
  | "adjustments"
  | "shifts";

export type ConsignmentSettlementUiAction =
  "submit" | "confirm" | "dispute" | "return" | "settle" | "void";
