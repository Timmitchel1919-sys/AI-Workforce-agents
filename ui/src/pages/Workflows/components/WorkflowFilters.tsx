import { Input, Select } from "../../../components/ui";
import type { WorkflowFilters as WorkflowFilterState } from "../workflowsView";

export function WorkflowFilters({
  filters,
  statuses,
  projects,
  resultCount,
  onChange,
}: {
  filters: WorkflowFilterState;
  statuses: readonly string[];
  projects: readonly string[];
  resultCount: number;
  onChange: (filters: WorkflowFilterState) => void;
}) {
  return (
    <div
      className="workflow-filters"
      role="search"
      aria-label="Workflow filters"
    >
      <label className="workflow-filters__search">
        <span className="visually-hidden">Search workflows</span>
        <Input
          type="search"
          value={filters.search}
          placeholder="Search name, ID, description, or project"
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
        />
      </label>
      <label className="workflow-filters__select">
        <span className="visually-hidden">Filter by status</span>
        <Select
          value={filters.status}
          options={[
            { value: "", label: "All statuses" },
            ...statuses.map((status) => ({
              value: status,
              label: status.replaceAll("_", " "),
            })),
          ]}
          onChange={(event) =>
            onChange({ ...filters, status: event.target.value })
          }
        />
      </label>
      <label className="workflow-filters__select">
        <span className="visually-hidden">Filter by project</span>
        <Select
          value={filters.projectId}
          options={[
            { value: "", label: "All projects" },
            ...projects.map((projectId) => ({
              value: projectId,
              label: projectId,
            })),
          ]}
          onChange={(event) =>
            onChange({ ...filters, projectId: event.target.value })
          }
        />
      </label>
      <span className="text-caption workflow-filters__count" aria-live="polite">
        {resultCount} {resultCount === 1 ? "workflow" : "workflows"}
      </span>
    </div>
  );
}
