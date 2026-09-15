import type { WorkflowView } from "../../api/contracts";

export interface WorkflowFilters {
  search: string;
  status: string;
  projectId: string;
}

export const EMPTY_WORKFLOW_FILTERS: WorkflowFilters = {
  search: "",
  status: "",
  projectId: "",
};

export interface WorkflowSummaryData {
  total: number;
  running: number;
  awaitingApproval: number;
  failed: number;
  completed: number;
}

export function sortWorkflowsByUpdated(
  workflows: readonly WorkflowView[],
): WorkflowView[] {
  return [...workflows].sort((a, b) => {
    const time = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return time || a.workflowId.localeCompare(b.workflowId);
  });
}

export function filterWorkflows(
  workflows: readonly WorkflowView[],
  filters: WorkflowFilters,
): WorkflowView[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return workflows.filter((workflow) => {
    const matchesSearch =
      !search ||
      [
        workflow.name,
        workflow.description,
        workflow.workflowId,
        workflow.projectId,
      ].some((value) => value.toLocaleLowerCase().includes(search));
    return (
      matchesSearch &&
      (!filters.status || workflow.status === filters.status) &&
      (!filters.projectId || workflow.projectId === filters.projectId)
    );
  });
}

export function filtersActive(filters: WorkflowFilters): boolean {
  return Boolean(filters.search || filters.status || filters.projectId);
}

export function collectWorkflowStatuses(
  workflows: readonly WorkflowView[],
): string[] {
  return [...new Set(workflows.map((workflow) => workflow.status))].sort();
}

export function collectWorkflowProjects(
  workflows: readonly WorkflowView[],
): string[] {
  return [...new Set(workflows.map((workflow) => workflow.projectId))].sort();
}

export function summarizeWorkflows(
  workflows: readonly WorkflowView[],
): WorkflowSummaryData {
  const count = (status: string) =>
    workflows.filter((workflow) => workflow.status === status).length;
  return {
    total: workflows.length,
    running: count("running"),
    awaitingApproval: count("awaiting_approval"),
    failed: count("failed"),
    completed: count("completed"),
  };
}
