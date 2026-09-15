import { Link } from "react-router-dom";
import type { AuditEventView } from "../../../api/contracts";
import { Card, CardBody, EmptyState, Timestamp } from "../../../components/ui";

function label(event: AuditEventView): string {
  return event.type.replaceAll("_", " ");
}

export function WorkflowRuntimeEvents({
  events,
}: {
  events: readonly AuditEventView[];
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No runtime events available"
        detail="The bounded workflow audit feed has not returned runtime events."
      />
    );
  }
  return (
    <Card>
      <CardBody>
        <ol className="workflow-runtime-events">
          {events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{label(event)}</strong>
                {event.outcome ? (
                  <span className="text-caption">Outcome: {event.outcome}</span>
                ) : null}
              </div>
              <div className="workflow-runtime-events__meta">
                <Timestamp value={event.timestamp} />
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
      </CardBody>
    </Card>
  );
}
