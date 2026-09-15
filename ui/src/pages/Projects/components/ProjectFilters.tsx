import { Input, Select } from "../../../components/ui";
import type { ProjectFilters as ProjectFilterState } from "../projectsView";
export function ProjectFilters({
  filters,
  statuses,
  adapterStatuses,
  resultCount,
  onChange,
}: {
  filters: ProjectFilterState;
  statuses: readonly string[];
  adapterStatuses: readonly string[];
  resultCount: number;
  onChange: (filters: ProjectFilterState) => void;
}) {
  return (
    <div className="project-filters" role="search" aria-label="Project filters">
      <label className="project-filters__search">
        <span className="visually-hidden">Search projects</span>
        <Input
          type="search"
          value={filters.search}
          placeholder="Search project name or ID"
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
        />
      </label>
      <label className="project-filters__select">
        <span className="visually-hidden">Filter by project status</span>
        <Select
          value={filters.status}
          options={[
            { value: "", label: "All project statuses" },
            ...statuses.map((status) => ({ value: status, label: status })),
          ]}
          onChange={(event) =>
            onChange({ ...filters, status: event.target.value })
          }
        />
      </label>
      <label className="project-filters__select">
        <span className="visually-hidden">Filter by adapter status</span>
        <Select
          value={filters.adapterStatus}
          options={[
            { value: "", label: "All adapter statuses" },
            ...adapterStatuses.map((status) => ({
              value: status,
              label: status,
            })),
          ]}
          onChange={(event) =>
            onChange({ ...filters, adapterStatus: event.target.value })
          }
        />
      </label>
      <span className="text-caption project-filters__count" aria-live="polite">
        {resultCount} {resultCount === 1 ? "project" : "projects"}
      </span>
    </div>
  );
}
