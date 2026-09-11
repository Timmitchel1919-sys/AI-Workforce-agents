import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  Select,
  Skeleton,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import type { Column } from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { RefreshCw } from "../../../components/ui/icons";
import { useBreakpointUp } from "../../../theme/breakpoints";
import { isApiError } from "../../../api";
import { formatDurationMs } from "../../../lib/duration";
import { useAgentExecutions } from "../useAgentExecutions";
import {
  EMPTY_EXECUTION_FILTERS,
  executionFiltersActive,
  filterExecutions,
  summarizeExecutions,
  type AgentExecutionView,
  type ExecutionFilters,
  type ExecutionStatusFilter,
} from "../executions";
import { AgentActivitySummary } from "./AgentActivitySummary";
import { AgentExecutionDrawer } from "./AgentExecutionDrawer";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: ExecutionStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "unknown", label: "Unknown" },
];

/**
 * Recent executions for one agent — the chronological activity surface for
 * the Agent Detail page (UI-5D). Built entirely on the real audit trail via
 * `useAgentExecutions` (no fabricated rows, no fake telemetry). Table on
 * wider viewports, cards on mobile; server-paginated (cursor, via the
 * existing `/api/audit` pagination) with a client-side search/status filter
 * over the currently loaded page.
 */
export function AgentExecutions({
  agentId,
  currentTaskId,
}: {
  agentId: string;
  currentTaskId?: string;
}) {
  const wide = useBreakpointUp("sm");
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const page = cursorStack.length;
  const cursor = cursorStack[cursorStack.length - 1];

  const query = useAgentExecutions(agentId, {
    limit: PAGE_SIZE,
    cursor,
    currentTaskId,
  });

  const [filters, setFilters] = useState<ExecutionFilters>(
    EMPTY_EXECUTION_FILTERS,
  );
  const [selected, setSelected] = useState<AgentExecutionView | null>(null);

  const filtered = useMemo(
    () => filterExecutions(query.executions, filters),
    [query.executions, filters],
  );
  const summary = useMemo(
    () => summarizeExecutions(query.executions),
    [query.executions],
  );

  function goNext() {
    if (query.nextCursor) setCursorStack((s) => [...s, query.nextCursor!]);
  }
  function goPrev() {
    setCursorStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }
  function updateFilters(next: ExecutionFilters) {
    setFilters(next);
  }

  if (query.isPending) {
    return (
      <Stack gap="md">
        <Skeleton width="14rem" height="1.5rem" />
        <Skeleton height="2.5rem" />
        <Stack gap="sm">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height="2.5rem" />
          ))}
        </Stack>
      </Stack>
    );
  }

  if (query.isError) {
    const forbidden =
      isApiError(query.error) && query.error.category === "forbidden";
    if (forbidden) {
      return (
        <ErrorState
          variant="forbidden"
          title="Access restricted"
          detail="You do not have permission to view this agent's activity."
        />
      );
    }
    return (
      <ErrorState
        variant="network"
        title="Unable to load agent activity"
        detail="The Control Center could not retrieve recent executions for this agent."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const hasAnyExecutions = query.executions.length > 0;

  return (
    <Stack gap="md">
      <div
        className="ui-inline"
        style={{ justifyContent: "space-between", gap: "var(--space-sm)" }}
      >
        <AgentActivitySummary summary={summary} />
        <Button
          variant="outline"
          size="sm"
          iconLeft={RefreshCw}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>

      {hasAnyExecutions ? (
        <div
          className="ui-inline"
          style={{ gap: "var(--space-md)", alignItems: "flex-end" }}
        >
          <Field label="Search executions" htmlFor="exec-search">
            <Input
              id="exec-search"
              type="search"
              placeholder="Task ID, execution ID, or error"
              value={filters.search}
              onChange={(e) =>
                updateFilters({ ...filters, search: e.target.value })
              }
            />
          </Field>
          <Field label="Status" htmlFor="exec-status">
            <Select
              id="exec-status"
              options={STATUS_OPTIONS}
              value={filters.status}
              onChange={(e) =>
                updateFilters({
                  ...filters,
                  status: e.target.value as ExecutionStatusFilter,
                })
              }
            />
          </Field>
        </div>
      ) : null}

      {!hasAnyExecutions ? (
        <EmptyState
          title="No executions yet"
          detail="This agent has not executed a task in the loaded activity window."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No executions match your filters"
          detail="Try a different search term or status."
          action={
            executionFiltersActive(filters) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateFilters(EMPTY_EXECUTION_FILTERS)}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : wide ? (
        <ExecutionTable executions={filtered} onSelect={setSelected} />
      ) : (
        <Stack gap="sm">
          {filtered.map((e) => (
            <ExecutionCard key={e.id} execution={e} onSelect={setSelected} />
          ))}
        </Stack>
      )}

      {hasAnyExecutions && (query.nextCursor || page > 1) ? (
        <Pagination
          page={page}
          // Cursor pagination has no known total — pageCount only encodes
          // whether a next page is currently known to exist, so Next
          // disables correctly instead of appearing clickable as a no-op.
          pageCount={query.nextCursor ? page + 1 : page}
          onPrev={goPrev}
          onNext={goNext}
        />
      ) : null}

      <AgentExecutionDrawer
        execution={selected}
        onClose={() => setSelected(null)}
      />
    </Stack>
  );
}

function ExecutionTable({
  executions,
  onSelect,
}: {
  executions: readonly AgentExecutionView[];
  onSelect: (e: AgentExecutionView) => void;
}) {
  const columns: Column<AgentExecutionView>[] = [
    {
      id: "id",
      header: "Execution",
      cell: (e) => (
        <button
          type="button"
          className="link text-data"
          aria-label={`View execution ${e.id}`}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            font: "inherit",
            cursor: "pointer",
          }}
          onClick={(ev) => {
            ev.stopPropagation();
            onSelect(e);
          }}
        >
          {e.id.slice(0, 8)}
        </button>
      ),
    },
    {
      id: "task",
      header: "Task",
      cell: (e) =>
        e.taskId ? (
          <Link
            to={`/tasks/${encodeURIComponent(e.taskId)}`}
            className="link"
            onClick={(ev) => ev.stopPropagation()}
          >
            {e.taskId}
          </Link>
        ) : (
          <span className="text-muted">Not available</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (e) => <StatusBadge status={e.status} />,
    },
    {
      id: "started",
      header: "Started",
      cell: (e) => <Timestamp value={e.startedAt} relative />,
    },
    {
      id: "duration",
      header: "Duration",
      align: "right",
      cell: (e) => formatDurationMs(e.durationMs),
    },
  ];

  return (
    <DataTable
      caption="Recent executions"
      columns={columns}
      rows={executions}
      rowKey={(e) => e.id}
      onRowClick={onSelect}
    />
  );
}

function ExecutionCard({
  execution,
  onSelect,
}: {
  execution: AgentExecutionView;
  onSelect: (e: AgentExecutionView) => void;
}) {
  return (
    <Card>
      <CardBody>
        <button
          type="button"
          className="ui-btn ui-btn--ghost ui-btn--sm"
          aria-label={`View execution ${execution.id}`}
          style={{ width: "100%", justifyContent: "space-between" }}
          onClick={() => onSelect(execution)}
        >
          <span className="ui-inline" style={{ gap: "var(--space-sm)" }}>
            <StatusBadge status={execution.status} />
            {execution.taskId ? (
              <Badge tone="neutral">{execution.taskId}</Badge>
            ) : null}
          </span>
          <Timestamp value={execution.startedAt} relative />
        </button>
        <p className="text-caption" style={{ marginTop: "var(--space-xs)" }}>
          Duration: {formatDurationMs(execution.durationMs)}
        </p>
      </CardBody>
    </Card>
  );
}
