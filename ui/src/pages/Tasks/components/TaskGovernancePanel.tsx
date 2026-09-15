import { useMemo } from "react";
import { isApiError } from "../../../api";
import type { TaskView } from "../../../api/contracts";
import { useAuth } from "../../../auth/useAuth";
import { useApprovals } from "../../../features/approvals";
import {
  findTaskApproval,
  hasTaskProjectAccess,
  taskAccessLevelLabel,
  taskPermissions,
} from "../taskGovernance";
import { TaskApprovalSummary } from "./TaskApprovalSummary";
import { TaskGovernanceCard } from "./TaskGovernanceCard";

/** Data composition only; both rendered cards remain presentational. */
export function TaskGovernancePanel({ task }: { task: TaskView }) {
  const { role, allowedProjects } = useAuth();
  const approvals = useApprovals();
  const approval = useMemo(
    () => (approvals.data ? findTaskApproval(approvals.data, task) : null),
    [approvals.data, task],
  );
  const approvalForbidden =
    isApiError(approvals.error) && approvals.error.category === "forbidden";

  return (
    <>
      <TaskGovernanceCard
        task={task}
        accessLevel={taskAccessLevelLabel(role)}
        projectInScope={hasTaskProjectAccess(allowedProjects, task)}
        permissions={taskPermissions(role)}
      />
      <TaskApprovalSummary
        task={task}
        approval={approval}
        isPending={approvals.isPending}
        isError={approvals.isError}
        errorIsForbidden={approvalForbidden}
        onRetry={() => void approvals.refetch()}
      />
    </>
  );
}
