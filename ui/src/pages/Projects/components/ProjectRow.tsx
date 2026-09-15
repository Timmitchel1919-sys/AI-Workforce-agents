import { Link } from "react-router-dom";
import type { ProjectView } from "../../../api/contracts";
import {
  Card,
  CardBody,
  Identifier,
  KeyValue,
  StatusBadge,
} from "../../../components/ui";
export function ProjectRow({ project }: { project: ProjectView }) {
  return (
    <Card>
      <CardBody>
        <div className="project-card__head">
          <Link
            to={`/projects/${encodeURIComponent(project.projectId)}`}
            className="project-card__title link"
          >
            {project.displayName}
          </Link>
          <StatusBadge status={project.status} />
        </div>
        <KeyValue
          rows={[
            {
              key: "Project ID",
              value: (
                <Identifier
                  value={project.projectId}
                  truncate
                  copyable={false}
                />
              ),
            },
            {
              key: "Adapter",
              value: <StatusBadge status={project.adapterStatus} />,
            },
            { key: "Connected agents", value: project.connectedAgents.length },
            { key: "Active workflows", value: project.activeWorkflows },
            { key: "Capabilities", value: project.capabilities.length },
          ]}
        />
      </CardBody>
    </Card>
  );
}
