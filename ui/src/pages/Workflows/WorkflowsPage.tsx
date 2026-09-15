import { useMemo, useState } from "react";
import { PageFrame, Section, Stack } from "../../components/layout";
import { Button } from "../../components/ui";
import { RefreshCw } from "../../components/ui/icons";
import { useWorkflows } from "../../features/workflows";
import { formatRelativeTime } from "../../lib/time";
import {
  WorkflowFilters,
  WorkflowRegistry,
  WorkflowSummary,
  WorkflowsEmptyState,
  WorkflowsErrorState,
  WorkflowsLoadingState,
} from "./components";
import {
  collectWorkflowProjects,
  collectWorkflowStatuses,
  EMPTY_WORKFLOW_FILTERS,
  filterWorkflows,
  filtersActive,
  sortWorkflowsByUpdated,
  summarizeWorkflows,
  type WorkflowFilters as WorkflowFilterState,
} from "./workflowsView";
import "./WorkflowsPage.css";

/** Read-only registry; the Control Plane owns workflow execution and access. */
export function WorkflowsPage() {
  const query = useWorkflows();
  const { data, isPending, isError, error, isFetching, dataUpdatedAt } = query;
  const [filters, setFilters] = useState<WorkflowFilterState>(
    EMPTY_WORKFLOW_FILTERS,
  );

  const workflows = useMemo(() => data ?? [], [data]);
  const statuses = useMemo(
    () => collectWorkflowStatuses(workflows),
    [workflows],
  );
  const projects = useMemo(
    () => collectWorkflowProjects(workflows),
    [workflows],
  );
  const summary = useMemo(() => summarizeWorkflows(workflows), [workflows]);
  const filtered = useMemo(
    () => sortWorkflowsByUpdated(filterWorkflows(workflows, filters)),
    [filters, workflows],
  );
  const lastUpdated = dataUpdatedAt
    ? formatRelativeTime(new Date(dataUpdatedAt).toISOString())
    : null;

  return (
    <PageFrame
      title="Workflows"
      description="Monitor orchestrated work across projects, agents, and governed stages."
      actions={
        <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
          {lastUpdated && !isPending ? (
            <span className="text-caption" aria-live="polite">
              {isFetching ? "Refreshing…" : `Updated ${lastUpdated}`}
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
        <WorkflowsLoadingState />
      ) : isError ? (
        <WorkflowsErrorState
          error={error}
          onRetry={() => void query.refetch()}
        />
      ) : workflows.length === 0 ? (
        <WorkflowsEmptyState filtered={false} />
      ) : (
        <Stack gap="lg">
          <Section title="Workflow summary">
            <WorkflowSummary summary={summary} />
          </Section>
          <Section title="Workflow registry">
            <Stack gap="md">
              <WorkflowFilters
                filters={filters}
                statuses={statuses}
                projects={projects}
                resultCount={filtered.length}
                onChange={setFilters}
              />
              {filtered.length === 0 ? (
                <WorkflowsEmptyState
                  filtered={filtersActive(filters)}
                  onClearFilters={() => setFilters(EMPTY_WORKFLOW_FILTERS)}
                />
              ) : (
                <WorkflowRegistry workflows={filtered} />
              )}
            </Stack>
          </Section>
        </Stack>
      )}
    </PageFrame>
  );
}
