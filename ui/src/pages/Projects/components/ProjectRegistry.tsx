import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProjectView } from "../../../api/contracts";
import { Stack } from "../../../components/layout";
import {
  DataTable,
  Identifier,
  StatusBadge,
  type Column,
} from "../../../components/ui";
import { useBreakpointUp } from "../../../theme/breakpoints";
import { ProjectRow } from "./ProjectRow";
export function ProjectRegistry({
  projects,
}: {
  projects: readonly ProjectView[];
}) {
  const navigate = useNavigate();
  const asTable = useBreakpointUp("sm");
  const wide = useBreakpointUp("lg");
  const columns = useMemo<Column<ProjectView>[]>(() => {
    const base: Column<ProjectView>[] = [
      {
        id: "project",
        header: "Project",
        cell: (project) => (
          <span className="project-row__identity">
            <Link
              to={`/projects/${encodeURIComponent(project.projectId)}`}
              className="link project-row__name"
              onClick={(event) => event.stopPropagation()}
            >
              {project.displayName}
            </Link>
            <Identifier value={project.projectId} truncate copyable={false} />
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (project) => <StatusBadge status={project.status} />,
      },
      {
        id: "adapter",
        header: "Adapter",
        cell: (project) => <StatusBadge status={project.adapterStatus} />,
      },
      {
        id: "capabilities",
        header: "Capabilities",
        align: "right",
        cell: (project) => project.capabilities.length,
      },
      {
        id: "agents",
        header: "Agents",
        align: "right",
        cell: (project) => project.connectedAgents.length,
      },
      {
        id: "workflows",
        header: "Active workflows",
        align: "right",
        cell: (project) => project.activeWorkflows,
      },
    ];
    return wide
      ? base
      : base.filter((column) =>
          ["project", "status", "adapter"].includes(column.id),
        );
  }, [wide]);
  if (!asTable)
    return (
      <Stack gap="md" aria-label="Project registry">
        {projects.map((project) => (
          <ProjectRow key={project.projectId} project={project} />
        ))}
      </Stack>
    );
  return (
    <DataTable
      caption="Project registry"
      columns={columns}
      rows={projects}
      rowKey={(project) => project.projectId}
      onRowClick={(project) =>
        navigate(`/projects/${encodeURIComponent(project.projectId)}`)
      }
    />
  );
}
