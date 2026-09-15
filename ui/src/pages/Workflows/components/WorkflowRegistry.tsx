import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WorkflowView } from "../../../api/contracts";
import { Stack } from "../../../components/layout";
import {
  DataTable,
  Identifier,
  StatusBadge,
  Timestamp,
  type Column,
} from "../../../components/ui";
import { useBreakpointUp } from "../../../theme/breakpoints";
import { WorkflowRow } from "./WorkflowRow";

export function WorkflowRegistry({
  workflows,
}: {
  workflows: readonly WorkflowView[];
}) {
  const navigate = useNavigate();
  const asTable = useBreakpointUp("sm");
  const wide = useBreakpointUp("lg");
  const columns = useMemo<Column<WorkflowView>[]>(() => {
    const base: Column<WorkflowView>[] = [
      {
        id: "workflow",
        header: "Workflow",
        cell: (workflow) => (
          <span className="workflow-row__identity">
            <Link
              to={`/workflows/${encodeURIComponent(workflow.workflowId)}`}
              className="link workflow-row__name"
              onClick={(event) => event.stopPropagation()}
            >
              {workflow.name}
            </Link>
            <Identifier value={workflow.workflowId} truncate copyable={false} />
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (workflow) => <StatusBadge status={workflow.status} />,
      },
      {
        id: "project",
        header: "Project",
        cell: (workflow) => workflow.projectId,
      },
      {
        id: "stages",
        header: "Stages",
        align: "right",
        cell: (workflow) => workflow.stages.length,
      },
      {
        id: "agents",
        header: "Agents",
        align: "right",
        cell: (workflow) => workflow.participatingAgents.length,
      },
      {
        id: "updated",
        header: "Updated",
        cell: (workflow) => <Timestamp value={workflow.updatedAt} relative />,
      },
    ];
    return wide
      ? base
      : base.filter((column) =>
          ["workflow", "status", "project", "updated"].includes(column.id),
        );
  }, [wide]);

  if (!asTable) {
    return (
      <Stack gap="md" aria-label="Workflow registry">
        {workflows.map((workflow) => (
          <WorkflowRow key={workflow.workflowId} workflow={workflow} />
        ))}
      </Stack>
    );
  }

  return (
    <DataTable
      caption="Workflow registry"
      columns={columns}
      rows={workflows}
      rowKey={(workflow) => workflow.workflowId}
      onRowClick={(workflow) =>
        navigate(`/workflows/${encodeURIComponent(workflow.workflowId)}`)
      }
    />
  );
}
