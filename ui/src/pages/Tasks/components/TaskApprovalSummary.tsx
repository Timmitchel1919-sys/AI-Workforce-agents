import { Link } from "react-router-dom";
import type { ApprovalView, TaskView } from "../../../api/contracts";
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Identifier,
  KeyValue,
  RiskBadge,
  Skeleton,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";

/** Presentational approval summary for the task's real approval relationship. */
export function TaskApprovalSummary({
  task,
  approval,
  isPending,
  isError,
  errorIsForbidden,
  onRetry,
}: {
  task: TaskView;
  approval: ApprovalView | null;
  isPending: boolean;
  isError: boolean;
  errorIsForbidden: boolean;
  onRetry: () => void;
}) {
  if (isPending) {
    return (
      <Card>
        <CardBody>
          <Skeleton height="8rem" />
        </CardBody>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardBody>
          <ErrorState
            variant={errorIsForbidden ? "forbidden" : "network"}
            title={
              errorIsForbidden
                ? "Approval information restricted"
                : "Approval information unavailable"
            }
            detail={
              errorIsForbidden
                ? "You do not have permission to view approval information for this task."
                : "The task remains available, but its approval information could not be loaded."
            }
            action={
              errorIsForbidden ? undefined : (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )
            }
          />
        </CardBody>
      </Card>
    );
  }

  if (!approval) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title={
              task.approvalId
                ? "Approval record unavailable"
                : "No approval linked"
            }
            detail={
              task.approvalId
                ? "The task references an approval, but its authorized record is not available."
                : "This task has no approval record exposed by the Control Plane."
            }
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            {
              key: "Approval ID",
              value: <Identifier value={approval.approvalId} />,
            },
            { key: "Status", value: <StatusBadge status={approval.status} /> },
            { key: "Operation", value: approval.action },
            { key: "Risk", value: <RiskBadge level={approval.risk} /> },
            { key: "Requested by", value: approval.requestedBy },
            {
              key: "Requested",
              value: <Timestamp value={approval.requestedAt} />,
            },
            ...(approval.decidedBy
              ? [{ key: "Decided by", value: approval.decidedBy }]
              : []),
            ...(approval.decidedAt
              ? [
                  {
                    key: "Decided",
                    value: <Timestamp value={approval.decidedAt} />,
                  },
                ]
              : []),
            ...(approval.expiresAt
              ? [
                  {
                    key: "Expires",
                    value: <Timestamp value={approval.expiresAt} />,
                  },
                ]
              : []),
          ]}
        />
        <p className="text-caption task-approval__reason">{approval.reason}</p>
        <Link to="/approvals" className="link">
          Open Approvals
        </Link>
      </CardBody>
    </Card>
  );
}
