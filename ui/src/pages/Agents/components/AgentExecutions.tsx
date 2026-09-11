import { Link } from "react-router-dom";
import {
  ActivityItem,
  EmptyState,
  Spinner,
  StatusBadge,
} from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { describeStatus } from "../../../lib/status";
import { useAuditEvents } from "../../../features/audit";

/**
 * Recent executions for one agent. The Control Plane has no dedicated
 * per-agent execution-history endpoint, so this is built from the real audit
 * feed (`GET /api/audit?agentId=…&limit=10`) — never fabricated rows. "Open
 * Audit Log" links to the existing `/audit` route rather than inventing a
 * filtered execution-detail route that does not exist yet.
 */
export function AgentExecutions({ agentId }: { agentId: string }) {
  const query = useAuditEvents({ agentId, limit: 10 });

  return (
    <Stack gap="sm">
      <ExecutionsBody agentId={agentId} query={query} />
      <div className="ui-inline" style={{ justifyContent: "flex-end" }}>
        <Link to="/audit" className="link">
          Open Audit Log
        </Link>
      </div>
    </Stack>
  );
}

function ExecutionsBody({
  query,
}: {
  agentId: string;
  query: ReturnType<typeof useAuditEvents>;
}) {
  if (query.isPending) {
    return <Spinner label="Loading recent executions" />;
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Recent executions are unavailable"
        detail="The execution feed could not be loaded for this agent."
      />
    );
  }

  const events = query.data.items;
  if (events.length === 0) {
    return (
      <EmptyState
        title="No recent executions"
        detail="No audit events have been recorded for this agent yet."
      />
    );
  }

  return (
    <Stack gap="xs" as="ul" className="agent-activity-list">
      {events.map((event) => (
        <li key={event.id}>
          <ActivityItem time={event.timestamp}>
            <span className="ui-inline" style={{ gap: "var(--space-xs)" }}>
              <span>{describeStatus(event.type).label}</span>
              {event.outcome ? (
                <StatusBadge status={event.outcome} label={event.outcome} />
              ) : null}
              {event.taskId ? (
                <Link
                  to={`/tasks/${encodeURIComponent(event.taskId)}`}
                  className="link"
                >
                  {event.taskId}
                </Link>
              ) : null}
            </span>
          </ActivityItem>
        </li>
      ))}
    </Stack>
  );
}
