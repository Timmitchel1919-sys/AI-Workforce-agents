import { Link } from "react-router-dom";
import type { OperatorRole, WorkflowView } from "../../../api/contracts";
import { can, canAccessProject } from "../../../auth/permissions";
import { Card, CardBody, KeyValue, StatusBadge } from "../../../components/ui";
import type { WorkflowPermissionHint } from "./workflowGovernance.types";

const PERMISSION_HINTS: readonly {
  action: WorkflowPermissionHint["action"];
  label: string;
  capability: "pause_workflow" | "resume_workflow" | "cancel_workflow";
}[] = [
  { action: "pause", label: "Pause workflow", capability: "pause_workflow" },
  { action: "resume", label: "Resume workflow", capability: "resume_workflow" },
  { action: "cancel", label: "Cancel workflow", capability: "cancel_workflow" },
];

export function workflowPermissionHints(
  workflow: WorkflowView,
  role: OperatorRole | null | undefined,
  allowedProjects: readonly string[] | "*" | null | undefined,
): readonly WorkflowPermissionHint[] {
  const hasProjectAccess = canAccessProject(
    allowedProjects,
    workflow.projectId,
  );
  return PERMISSION_HINTS.map((hint) => ({
    action: hint.action,
    label: hint.label,
    state:
      hasProjectAccess && can(role, hint.capability)
        ? "can_request"
        : "read_only",
  }));
}

/** Read-only Control Plane governance metadata and non-authoritative UX hints. */
export function WorkflowGovernanceCard({
  workflow,
  role,
  allowedProjects,
}: {
  workflow: WorkflowView;
  role: OperatorRole | null | undefined;
  allowedProjects: readonly string[] | "*" | null | undefined;
}) {
  const hints = workflowPermissionHints(workflow, role, allowedProjects);
  const projectAccess = canAccessProject(allowedProjects, workflow.projectId);

  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            {
              key: "Project",
              value: (
                <Link
                  to={`/projects/${encodeURIComponent(workflow.projectId)}`}
                  className="link"
                >
                  {workflow.projectId}
                </Link>
              ),
            },
            { key: "Owner / team", value: "Not exposed by the Control Plane" },
            { key: "Environment", value: "Not exposed by the Control Plane" },
            {
              key: "Governance state",
              value: <StatusBadge status={workflow.status} />,
            },
            {
              key: "Current session access",
              value: projectAccess
                ? "Project in access scope"
                : "Read-only outside project scope",
            },
            {
              key: "Policy information",
              value: "Not exposed by the Control Plane",
            },
          ]}
        />
        <div className="workflow-governance__permissions">
          <strong>Operational permission hints</strong>
          <p className="text-caption">
            The Control Plane validates every request. These are current-session
            hints, not an authorization decision.
          </p>
          <ul aria-label="Workflow operational permission hints">
            {hints.map((hint) => (
              <li key={hint.action}>
                <span>{hint.label}</span>
                <span>
                  {hint.state === "can_request" ? "Can request" : "Read-only"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}
