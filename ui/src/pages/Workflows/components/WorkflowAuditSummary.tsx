import { Link } from "react-router-dom";
import type { AuditEventView } from "../../../api/contracts";
import { Card, CardBody, EmptyState, Timestamp } from "../../../components/ui";

function eventLabel(event: AuditEventView): string {
  return event.type.replaceAll("_", " ");
}

/** Bounded workflow-scoped audit context; the global Audit Log remains investigative. */
export function WorkflowAuditSummary({
  events,
}: {
  events: readonly AuditEventView[];
}) {
  const bounded = events.slice(0, 8);
  if (bounded.length === 0) {
    return (
      <EmptyState
        title="No workflow audit events available"
        detail="The bounded workflow audit feed has not returned governance activity."
      />
    );
  }
  return (
    <Card>
      <CardBody>
        <ol className="workflow-audit-summary">
          {bounded.map((event) => (
            <li key={event.id}>
              <strong>{eventLabel(event)}</strong>
              <div>
                <Timestamp value={event.timestamp} />
                <span>Actor: {event.actor ?? "Not exposed"}</span>
                {event.outcome ? <span>Outcome: {event.outcome}</span> : null}
                {event.correlationId ? (
                  <span>Correlation: {event.correlationId}</span>
                ) : null}
                {event.taskId ? (
                  <Link to={`/tasks/${encodeURIComponent(event.taskId)}`}>
                    Task {event.taskId}
                  </Link>
                ) : null}
                {event.agentId ? (
                  <Link to={`/agents/${encodeURIComponent(event.agentId)}`}>
                    Agent {event.agentId}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-caption">
          <Link to="/audit" className="link">
            Open Audit Log
          </Link>{" "}
          for the system-wide, searchable record.
        </p>
      </CardBody>
    </Card>
  );
}
