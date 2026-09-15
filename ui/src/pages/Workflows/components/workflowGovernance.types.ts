import type { WorkflowAction } from "../workflowActions";

/** A UI hint only; every command is independently authorized by the Control Plane. */
export interface WorkflowPermissionHint {
  action: WorkflowAction;
  label: string;
  state: "can_request" | "read_only";
}
