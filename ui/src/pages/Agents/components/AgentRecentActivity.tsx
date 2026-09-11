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
 * Recent execution / activity history for one agent, sourced from the audit
 * feed (`GET /api/audit?agentId=…`). The Control Plane has no dedicated agent
 * execution-history endpoint, so this is a best-effort view of real audit
 * events — never fabricated. Failure and empty are both explicit states.
 */
export function AgentRecentActivity({ agentId }: { agentId: string }) {
  const query = useAuditEvents({ agentId, limit: 10 });

  if (query.isPending) {
    return <Spinner label="Loading recent activity" />;
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Recent activity is unavailable"
        detail="The activity feed could not be loaded for this agent."
      />
    );
  }

  const events = query.data.items;
  if (events.length === 0) {
    return (
      <EmptyState
        title="No recent activity"
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
