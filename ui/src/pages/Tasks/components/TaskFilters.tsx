import { Input, Select } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export interface TaskFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  statusOptions: readonly string[];
  priorityOptions: readonly string[];
  formatStatus?: (value: string) => string;
  formatPriority?: (value: string) => string;
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
  formatStatus = (value) => value,
  formatPriority = (value) => value,
}: TaskFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="tasks-toolbar">
      <div className="tasks-toolbar__search">
        <label htmlFor="task-search" className="sr-only">{t("tasks.search")}</label>
        <Input
          id="task-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("tasks.searchPlaceholder")}
          aria-label={t("tasks.search")}
        />
      </div>

      <div className="tasks-toolbar__filters">
        <Select
          id="status-filter"
          label={t("common.status")}
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {formatStatus(status)}
            </option>
          ))}
        </Select>

        <Select
          id="priority-filter"
          label={t("common.priority")}
          value={priorityFilter}
          onChange={(e) => onPriorityFilterChange(e.target.value)}
        >
          {priorityOptions.map((priority) => (
            <option key={priority} value={priority}>
              {formatPriority(priority)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

export default TaskFilters;

