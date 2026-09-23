import { Input, Select } from "../../../components/ui";
import { formatStatusLabel } from "./workflowStatus";

export interface WorkflowFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  projectFilter: string;
  onProjectFilterChange: (projectId: string) => void;
  statusOptions: readonly string[];
  projectOptions: readonly string[];
}

export function WorkflowFilters({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  statusOptions,
  projectOptions,
}: WorkflowFiltersProps) {
  return (
    <div className="tasks-toolbar">
      <div className="tasks-toolbar__search">
        <Input
          id="workflow-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search workflows by name, description, or agent..."
          aria-label="Search workflows"
        />
      </div>

      <div className="tasks-toolbar__filters">
        <Select
          id="workflow-status-filter"
          label="Status"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : formatStatusLabel(status)}
            </option>
          ))}
        </Select>

        <Select
          id="workflow-project-filter"
          label="Project"
          value={projectFilter}
          onChange={(e) => onProjectFilterChange(e.target.value)}
        >
          <option value="all">All projects</option>
          {projectOptions.map((projectId) => (
            <option key={projectId} value={projectId}>
              {projectId}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

export default WorkflowFilters;
