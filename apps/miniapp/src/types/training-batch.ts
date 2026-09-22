export type TrainingBatchAction = "attendance" | "proposal" | "confirmation";
export interface TrainingBatchResult {
  enrollmentId: string;
  status: "SUCCEEDED" | "FAILED";
  message?: string;
}
export interface TrainingBatchCommand {
  items: { enrollmentId: string; idempotencyKey: string }[];
}
