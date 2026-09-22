import { Input, Select } from "../../../components/ui";

export interface TaskFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
}

export function TaskFilters({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  statusOptions,
  priorityOptions,
}: TaskFiltersProps) {
  return (
    <div className="tasks-toolbar">
      <div className="tasks-toolbar__search">
        <label htmlFor="task-search" className="sr-only">Search tasks</label>
        <Input
          id="task-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search tasks by title, agent, or project..."
          aria-label="Search tasks"
        />
      </div>

      <div className="tasks-toolbar__filters">
        <Select
          id="status-filter"
          label="Status"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </Select>

        <Select
          id="priority-filter"
          label="Priority"
          value={priorityFilter}
          onChange={(e) => onPriorityFilterChange(e.target.value)}
        >
          {priorityOptions.map((priority) => (
            <option key={priority} value={priority}>
              {priority === "all" ? "All priorities" : priority.charAt(0).toUpperCase() + priority.slice(1)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

export default TaskFilters;

