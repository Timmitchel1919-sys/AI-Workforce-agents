import type { Status } from "../../../components/ui/StatusBadge";
import type { WorkflowView } from "../../../features/workflows";

/** A paused workflow keeps its lifecycle status; the pause flag wins for display. */
export function workflowDisplayStatus(workflow: Pick<WorkflowView, "status" | "paused">): string {
  return workflow.paused ? "paused" : workflow.status;
}

export function mapWorkflowStatusToBadge(status: string): Status {
  switch (status) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "awaiting_approval":
      return "pending";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "offline";
    default:
      return "idle";
  }
}

export function mapStageStatusToBadge(status: string): Status {
  switch (status) {
    case "dispatched":
      return "running";
    case "ready":
    case "awaiting_approval":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "blocked":
    case "skipped":
      return "blocked";
    default:
      return "idle";
  }
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function formatDate(isoString?: string): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}
