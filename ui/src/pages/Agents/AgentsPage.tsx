import { useMemo, useState } from "react";
import { PageFrame } from "../../components/layout";
import { Section, Stack } from "../../components/layout";
import { Button, Pagination } from "../../components/ui";
import { RefreshCw } from "../../components/ui/icons";
import { formatRelativeTime } from "../../lib/time";
import { useAgents } from "../../features/agents";
import { AgentsSummary } from "./components/AgentsSummary";
import { AgentsToolbar } from "./components/AgentsToolbar";
import { AgentRegistry } from "./components/AgentRegistry";
import { AgentsLoadingState } from "./components/AgentsLoadingState";
import { AgentsEmptyState } from "./components/AgentsEmptyState";
import { AgentsErrorState } from "./components/AgentsErrorState";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  collectCapabilities,
  collectProjects,
  filterAgents,
  filtersActive,
  sortAgents,
  summarize,
  toAgentListItems,
  type AgentFilters,
  type AgentSort,
  type AgentSortColumn,
} from "./agentsView";
import "./agents.css";

const PAGE_SIZE = 25;

function nextSort(current: AgentSort, column: AgentSortColumn): AgentSort {
  if (current.column !== column) return { column, direction: "asc" };
  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

/**
 * Overview / command surface for the AI workforce agent registry.
 *
 * Data flows: page → `useAgents()` (TanStack Query) → agents endpoint → API
 * client → Control Plane. The page owns only UI state (filters, sort, page);
 * server state stays in the query cache. Presentation components are data-
 * agnostic.
 */
export function AgentsPage() {
  const query = useAgents();
  const { data, isPending, isError, error, isFetching, dataUpdatedAt } = query;

  const [filters, setFilters] = useState<AgentFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<AgentSort>(DEFAULT_SORT);
  const [page, setPage] = useState(1);

  const allItems = useMemo(() => (data ? toAgentListItems(data) : []), [data]);
  const summary = useMemo(() => summarize(allItems), [allItems]);
  const capabilities = useMemo(() => collectCapabilities(allItems), [allItems]);
  const projects = useMemo(() => collectProjects(allItems), [allItems]);

  const filtered = useMemo(
    () => sortAgents(filterAgents(allItems, filters), sort),
    [allItems, filters, sort],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  function updateFilters(next: AgentFilters) {
    setFilters(next);
    setPage(1);
  }

  function handleSort(column: AgentSortColumn) {
    setSort((current) => nextSort(current, column));
    setPage(1);
  }

  const lastUpdated = dataUpdatedAt
    ? formatRelativeTime(new Date(dataUpdatedAt).toISOString())
    : null;

  const refreshAction = (
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
  );

  return (
    <PageFrame
      title="Agents"
      description="AI workforce registry — monitor the agents operating across your workforce."
      actions={refreshAction}
    >
      {isPending ? (
        <AgentsLoadingState />
      ) : isError ? (
        <AgentsErrorState error={error} onRetry={() => void query.refetch()} />
      ) : allItems.length === 0 ? (
        <AgentsEmptyState filtered={false} />
      ) : (
        <Stack gap="lg">
          <Section title="Workforce summary">
            <AgentsSummary summary={summary} />
          </Section>

          <Section title="Agent registry">
            <Stack gap="md">
              <AgentsToolbar
                filters={filters}
                onChange={updateFilters}
                capabilities={capabilities}
                projects={projects}
                resultCount={filtered.length}
              />

              {filtered.length === 0 ? (
                <AgentsEmptyState
                  filtered={filtersActive(filters)}
                  onClearFilters={() => updateFilters(EMPTY_FILTERS)}
                />
              ) : (
                <>
                  <AgentRegistry
                    agents={pageRows}
                    sort={sort}
                    onSortChange={handleSort}
                  />
                  {filtered.length > PAGE_SIZE ? (
                    <Pagination
                      page={safePage}
                      pageCount={pageCount}
                      total={filtered.length}
                      pageSize={PAGE_SIZE}
                      onPrev={() => setPage((p) => Math.max(1, p - 1))}
                      onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
                    />
                  ) : null}
                </>
              )}
            </Stack>
          </Section>
        </Stack>
      )}
    </PageFrame>
  );
}
