import type { WorkGroupDefinition } from "../../../../config/work-items";
import type { WorkItem } from "../../../../services/api";

export type DisplayWorkGroup = WorkGroupDefinition & { items: WorkItem[] };
export type ManagementView = "work" | "analytics";
