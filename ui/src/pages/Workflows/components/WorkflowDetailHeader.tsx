import { Link } from "react-router-dom";
import type { WorkflowView } from "../../../api/contracts";
import {
  Badge,
  Identifier,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { Stack } from "../../../components/layout";

export function WorkflowDetailHeader({ workflow }: { workflow: WorkflowView }) {
  return (
    <Stack gap="sm">
      <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
        <StatusBadge status={workflow.status} />
        {workflow.paused ? <Badge tone="warning">Paused</Badge> : null}
        <Identifier value={workflow.workflowId} />
      </div>
      {workflow.description ? (
        <p className="workflow-overview__description">{workflow.description}</p>
      ) : null}
      <dl className="workflow-detail-facts">
        <div>
          <dt className="text-label">Project</dt>
          <dd>
            <Link
              to={`/projects/${encodeURIComponent(workflow.projectId)}`}
              className="link"
            >
              {workflow.projectId}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-label">Current stage</dt>
          <dd>{workflow.currentSpecId ?? "Not available"}</dd>
        </div>
        <div>
          <dt className="text-label">Updated</dt>
          <dd>
            <Timestamp value={workflow.updatedAt} relative />
          </dd>
        </div>
      </dl>
    </Stack>
  );
}
