import { Link } from "react-router-dom";
import type { AuditEventView } from "../../../api/contracts";
import {
  ActivityItem,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
} from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { taskAuditEventLabel, taskGovernanceEvents } from "../taskGovernance";

/** A bounded task-local context view; `/audit` remains the authoritative log. */
export function TaskAuditSummary({
  taskId,
  events,
  isPending,
  isError,
  errorIsForbidden,
  onRetry,
}: {
  taskId: string;
  events: readonly AuditEventView[];
  isPending: boolean;
  isError: boolean;
  errorIsForbidden: boolean;
  onRetry: () => void;
}) {
  const summary = taskGovernanceEvents(events, taskId);

  return (
    <Card>
      <CardBody>
        {isPending ? (
          <Stack gap="sm">
            <Skeleton height="3rem" />
            <Skeleton height="3rem" />
          </Stack>
        ) : isError ? (
          <ErrorState
            variant={errorIsForbidden ? "forbidden" : "network"}
            title={
              errorIsForbidden
                ? "Audit summary restricted"
                : "Audit summary unavailable"
            }
            detail={
              errorIsForbidden
                ? "You do not have permission to view audit information for this task."
                : "The task remains available, but its governance audit summary could not be loaded."
            }
            action={
              errorIsForbidden ? undefined : (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )
            }
          />
        ) : summary.length === 0 ? (
          <EmptyState
            title="No governance activity yet"
            detail="No task lifecycle, approval, permission, or operator command events are available in this bounded audit view."
          />
        ) : (
          <Stack gap="xs" as="ul" className="task-audit-summary">
            {summary.map((event) => (
              <li key={event.id}>
                <ActivityItem time={event.timestamp}>
                  <span className="ui-inline task-audit-summary__item">
                    <span>{taskAuditEventLabel(event.type)}</span>
                    {event.actor ? (
                      <span className="text-caption">by {event.actor}</span>
                    ) : null}
                    {event.outcome ? (
                      <StatusBadge
                        status={event.outcome}
                        label={event.outcome}
                      />
                    ) : null}
                  </span>
                </ActivityItem>
              </li>
            ))}
          </Stack>
        )}

        <div className="task-audit-summary__link">
          <Link to="/audit" className="link">
            Open Audit Log
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
