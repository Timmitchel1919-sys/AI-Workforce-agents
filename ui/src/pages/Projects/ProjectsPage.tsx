import { useMemo, useState } from "react";
import { PageFrame, Section, Stack } from "../../components/layout";
import { Button } from "../../components/ui";
import { RefreshCw } from "../../components/ui/icons";
import { useProjects } from "../../features/projects";
import { formatRelativeTime } from "../../lib/time";
import {
  ProjectFilters,
  ProjectRegistry,
  ProjectSummary,
  ProjectsEmptyState,
  ProjectsErrorState,
  ProjectsLoadingState,
} from "./components";
import {
  collectAdapterStatuses,
  collectProjectStatuses,
  EMPTY_PROJECT_FILTERS,
  filterProjects,
  filtersActive,
  sortProjects,
  summarizeProjects,
  type ProjectFilters as ProjectFilterState,
} from "./projectsView";
import "./ProjectsPage.css";

/** Read-only project registry; lifecycle and infrastructure stay behind the Control Plane. */
export function ProjectsPage() {
  const query = useProjects();
  const { data, isPending, isError, error, isFetching, dataUpdatedAt } = query;
  const [filters, setFilters] = useState<ProjectFilterState>(
    EMPTY_PROJECT_FILTERS,
  );
  const projects = useMemo(() => data ?? [], [data]);
  const statuses = useMemo(() => collectProjectStatuses(projects), [projects]);
  const adapterStatuses = useMemo(
    () => collectAdapterStatuses(projects),
    [projects],
  );
  const summary = useMemo(() => summarizeProjects(projects), [projects]);
  const filtered = useMemo(
    () => sortProjects(filterProjects(projects, filters)),
    [filters, projects],
  );
  const lastUpdated = dataUpdatedAt
    ? formatRelativeTime(new Date(dataUpdatedAt).toISOString())
    : null;
  return (
    <PageFrame
      title="Projects"
      description="Manage software projects orchestrated through the AI Workforce Control Plane."
      actions={
        <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
          {lastUpdated && !isPending ? (
            <span className="text-caption" aria-live="polite">
              {isFetching ? "Refreshingâ€¦" : `Updated ${lastUpdated}`}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            iconLeft={RefreshCw}
            onClick={() => void query.refetch()}
            loading={isFetching}
            disabled={isPending}
          >
            Refresh
          </Button>
        </div>
      }
    >
      {isPending ? (
        <ProjectsLoadingState />
      ) : isError ? (
        <ProjectsErrorState
          error={error}
          onRetry={() => void query.refetch()}
        />
      ) : projects.length === 0 ? (
        <ProjectsEmptyState filtered={false} />
      ) : (
        <Stack gap="lg">
          <Section title="Project summary">
            <ProjectSummary summary={summary} />
          </Section>
          <Section title="Project registry">
            <Stack gap="md">
              <ProjectFilters
                filters={filters}
                statuses={statuses}
                adapterStatuses={adapterStatuses}
                resultCount={filtered.length}
                onChange={setFilters}
              />
              {filtered.length === 0 ? (
                <ProjectsEmptyState
                  filtered={filtersActive(filters)}
                  onClearFilters={() => setFilters(EMPTY_PROJECT_FILTERS)}
                />
              ) : (
                <ProjectRegistry projects={filtered} />
              )}
            </Stack>
          </Section>
        </Stack>
      )}
    </PageFrame>
  );
}
