import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DataTable,
  StatusBadge,
  Timestamp,
  Badge,
} from "../../../components/ui";
import type { Column, SortDirection } from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { useBreakpointUp } from "../../../theme/breakpoints";
import { AgentCard } from "./AgentCard";
import {
  formatSuccessRate,
  type AgentListItem,
  type AgentSort,
  type AgentSortColumn,
} from "../agentsView";

const SORT_TO_ARIA: Record<AgentSort["direction"], SortDirection> = {
  asc: "ascending",
  desc: "descending",
};

/**
 * The agent registry. Enterprise table on desktop/tablet (secondary columns
 * drop below `lg`), stacked cards on mobile — no horizontal page scroll at any
 * width. Presentational: rows in through props; row activation navigates via
 * React Router.
 */
export function AgentRegistry({
  agents,
  sort,
  onSortChange,
  loading = false,
}: {
  agents: readonly AgentListItem[];
  sort: AgentSort;
  onSortChange: (column: AgentSortColumn) => void;
  loading?: boolean;
}) {
  const navigate = useNavigate();
  const asTable = useBreakpointUp("sm");
  const wide = useBreakpointUp("lg");

  const columns = useMemo<Column<AgentListItem>[]>(() => {
    const base: Column<AgentListItem>[] = [
      {
        id: "name",
        header: "Agent",
        sortable: true,
        cell: (a) => (
          <span className="agent-row__identity">
            <Link
              to={`/agents/${encodeURIComponent(a.id)}`}
              className="link"
              onClick={(e) => e.stopPropagation()}
            >
              {a.name}
            </Link>
            <span className="text-caption">{a.role || "—"}</span>
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        cell: (a) => <StatusBadge status={a.status} />,
      },
      {
        id: "capabilities",
        header: "Capabilities",
        cell: (a) => <CapabilityCells capabilities={a.capabilities} />,
      },
      {
        id: "tasks",
        header: "Tasks",
        sortable: true,
        align: "right",
        cell: (a) => (
          <span title={`${a.completed} completed · ${a.failed} failed`}>
            {a.taskCount}
          </span>
        ),
      },
      {
        id: "success",
        header: "Success",
        align: "right",
        cell: (a) => formatSuccessRate(a.successRate),
      },
      {
        id: "health",
        header: "Health",
        cell: () => (
          <span
            className="text-muted"
            title="Not reported by the Control Plane"
          >
            Unavailable
          </span>
        ),
      },
      {
        id: "updated",
        header: "Updated",
        sortable: true,
        cell: (a) => <Timestamp value={a.lastActivityAt} relative />,
      },
    ];
    if (wide) return base;
    // Tablet: identity, status, tasks, success — drop secondary columns.
    return base.filter((c) =>
      ["name", "status", "tasks", "success"].includes(c.id),
    );
  }, [wide]);

  if (!asTable) {
    return (
      <Stack gap="md" aria-label="Agent registry">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </Stack>
    );
  }

  return (
    <DataTable
      caption="Agent registry"
      columns={columns}
      rows={agents}
      rowKey={(a) => a.id}
      loading={loading}
      emptyTitle="No agents match these filters"
      sort={{ columnId: sort.column, direction: SORT_TO_ARIA[sort.direction] }}
      onSortChange={(columnId) => onSortChange(columnId as AgentSortColumn)}
      onRowClick={(a) => navigate(`/agents/${encodeURIComponent(a.id)}`)}
    />
  );
}

function CapabilityCells({
  capabilities,
}: {
  capabilities: readonly string[];
}) {
  if (capabilities.length === 0) return <span className="text-muted">—</span>;
  const shown = capabilities.slice(0, 3);
  const rest = capabilities.length - shown.length;
  return (
    <span className="agent-caps">
      {shown.map((c) => (
        <Badge key={c} tone="neutral">
          {c}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge tone="neutral" aria-label={`${rest} more capabilities`}>
          +{rest}
        </Badge>
      ) : null}
    </span>
  );
}
