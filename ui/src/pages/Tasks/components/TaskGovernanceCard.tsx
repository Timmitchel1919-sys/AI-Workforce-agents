import { Link } from "react-router-dom";
import type { TaskView } from "../../../api/contracts";
import {
  Badge,
  Card,
  CardBody,
  KeyValue,
  StatusBadge,
} from "../../../components/ui";
import type { TaskGovernancePermission } from "../taskGovernance";

/**
 * Presentational task-governance facts. This component receives only
 * Control-Plane-derived Task and operator data; it does not fetch, create an
 * approval, write audit events, or authorize an operation.
 */
export function TaskGovernanceCard({
  task,
  accessLevel,
  projectInScope,
  permissions,
}: {
  task: TaskView;
  accessLevel: string;
  projectInScope: boolean;
  permissions: readonly TaskGovernancePermission[];
}) {
  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            { key: "Your access level", value: accessLevel },
            {
              key: "Project scope",
              value: (
                <Badge tone={projectInScope ? "success" : "neutral"}>
                  {projectInScope ? "In scope" : "Outside scope"}
                </Badge>
              ),
            },
            {
              key: "Project",
              value: (
                <Link
                  to={`/projects/${encodeURIComponent(task.projectId)}`}
                  className="link"
                >
                  {task.projectId}
                </Link>
              ),
            },
            {
              key: "Current governance state",
              value: task.approvalState ? (
                <StatusBadge status={task.approvalState} />
              ) : (
                "No approval state recorded"
              ),
            },
          ]}
        />

        <div className="task-governance__permissions">
          <p className="text-label">Operational permissions</p>
          {permissions.map((permission) => (
            <span
              key={permission.capability}
              className="task-governance__permission"
            >
              <span className="text-body-sm">{permission.label}</span>
              <Badge tone={permission.granted ? "success" : "neutral"}>
                {permission.granted ? "Granted" : "Not granted"}
              </Badge>
            </span>
          ))}
        </div>

        <p className="text-caption task-governance__note">
          Permission indicators are guidance only. The Control Plane validates
          every request. Environment, owner, team, and policy-detail metadata
          are not exposed for tasks.
        </p>
      </CardBody>
    </Card>
  );
}
