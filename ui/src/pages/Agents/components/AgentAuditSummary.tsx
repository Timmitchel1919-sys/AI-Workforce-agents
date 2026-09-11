import { Link } from "react-router-dom";
import {
  ActivityItem,
  Button,
  EmptyState,
  Spinner,
  StatusBadge,
} from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { describeStatus } from "../../../lib/status";
import { useAgentAuditEvents } from "../useAgentAuditEvents";

/**
 * Contextual governance activity for one agent (UI-5E) — NOT a replacement
 * for the global Audit Log. Scope is intentionally narrow: lifecycle
 * commands (enable/disable), approval requests, and permission checks that
 * carry this agent's id. For the complete, searchable, authoritative record
 * (including approval decisions, which cannot be correlated to an agent —
 * see `governance.ts`), operators go to the Audit Log.
 */
export function AgentAuditSummary({ agentId }: { agentId: string }) {
  const query = useAgentAuditEvents(agentId);

  return (
    <Stack gap="sm">
      {query.isPending ? (
        <Spinner label="Loading governance activity" />
      ) : query.isError ? (
        <EmptyState
          title="Audit activity unavailable"
          detail="The governance activity feed could not be loaded for this agent."
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
      ) : query.events.length === 0 ? (
        <EmptyState
          title="No governance activity yet"
          detail="No lifecycle, permission, or approval events have been recorded for this agent."
        />
      ) : (
        <Stack gap="xs" as="ul" className="agent-activity-list">
          {query.events.map((event) => (
            <li key={event.id}>
              <ActivityItem time={event.timestamp}>
                <span className="ui-inline" style={{ gap: "var(--space-xs)" }}>
                  <span>{describeStatus(event.type).label}</span>
                  {event.actor ? (
                    <span className="text-caption">by {event.actor}</span>
                  ) : null}
                  {event.outcome ? (
                    <StatusBadge status={event.outcome} label={event.outcome} />
                  ) : null}
                </span>
              </ActivityItem>
            </li>
          ))}
        </Stack>
      )}

      <div className="ui-inline" style={{ justifyContent: "flex-end" }}>
        <Link to="/audit" className="link">
          Open Audit Log
        </Link>
      </div>
    </Stack>
  );
}
