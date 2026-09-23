import { Input, Select } from "../../../components/ui";
import { translateStatus, useI18n } from "../../../i18n";

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
  const { t } = useI18n();
  return (
    <div className="tasks-toolbar">
      <div className="tasks-toolbar__search">
        <Input
          id="workflow-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("workflows.searchPlaceholder")}
          aria-label={t("workflows.search")}
        />
      </div>

      <div className="tasks-toolbar__filters">
        <Select
          id="workflow-status-filter"
          label={t("common.status")}
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? t("common.allStatuses") : translateStatus(t, status)}
            </option>
          ))}
        </Select>

        <Select
          id="workflow-project-filter"
          label={t("common.project")}
          value={projectFilter}
          onChange={(e) => onProjectFilterChange(e.target.value)}
        >
          <option value="all">{t("common.allProjects")}</option>
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
