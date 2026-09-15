import { Link, useParams } from "react-router-dom";
import { isApiError } from "../../api";
import { PageFrame, Section, Stack } from "../../components/layout";
import { Button, Card, CardBody, ErrorState, Identifier, KeyValue, Skeleton, StatusBadge } from "../../components/ui";
import { ChevronLeft } from "../../components/ui/icons";
import { useProject } from "../../features/projects";
import "./ProjectDetailPage.css";

/** Read-only Project intelligence from the existing Control Plane ProjectView. */
export function ProjectDetailPage() {
  const { projectId } = useParams();
  const query = useProject(projectId);
  if (query.isPending) return <PageFrame title="Project" description="Loading project…"><Stack gap="lg"><Link to="/projects" className="link">Back to Projects</Link><Skeleton height="4rem" /><Skeleton height="18rem" /></Stack></PageFrame>;
  if (query.isError || !query.data) {
    const notFound = isApiError(query.error) && query.error.category === "not_found";
    const forbidden = isApiError(query.error) && query.error.category === "forbidden";
    return <PageFrame title="Project" description="Project detail"><Stack gap="lg"><Link to="/projects" className="link">Back to Projects</Link><ErrorState variant={notFound ? "not-found" : forbidden ? "forbidden" : "network"} title={notFound ? "Project not found" : forbidden ? "Access restricted" : "Unable to load this project"} detail={notFound ? "The requested project does not exist or is no longer available." : forbidden ? "You do not have permission to view this project." : "The Control Center could not retrieve this project."} action={!notFound && !forbidden ? <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button> : undefined} /></Stack></PageFrame>;
  }
  const project = query.data;
  return <PageFrame title={project.displayName} description="Project intelligence" actions={<StatusBadge status={project.status} />}><Stack gap="lg"><Link to="/projects" className="link ui-inline" style={{ gap: 4 }}><ChevronLeft width={16} aria-hidden="true" />Back to Projects</Link><div className="project-detail-grid"><Stack gap="lg"><Section title="Overview"><Card><CardBody><KeyValue rows={[{ key: "Project ID", value: <Identifier value={project.projectId} /> }, { key: "Lifecycle status", value: <StatusBadge status={project.status} /> }, { key: "Adapter status", value: <StatusBadge status={project.adapterStatus} /> }, { key: "Description / purpose", value: "Not exposed by the Control Plane" }]} /></CardBody></Card></Section><Section title="Resources"><Card><CardBody><KeyValue rows={[{ key: "Connected agents", value: project.connectedAgents.length }, { key: "Active workflows", value: project.activeWorkflows }, { key: "Recent task references", value: project.recentTaskIds.length }]} /></CardBody></Card></Section><Section title="Metadata"><Card><CardBody><KeyValue rows={[{ key: "Owner / team", value: "Not exposed by the Control Plane" }, { key: "Created / updated", value: "Not exposed by the Control Plane" }, { key: "Workspace / classification", value: "Not exposed by the Control Plane" }]} /></CardBody></Card></Section></Stack><Stack gap="lg"><Section title="Repository"><Card><CardBody><KeyValue rows={[{ key: "Repository", value: "Not exposed by the Control Plane" }, { key: "Default branch", value: "Not exposed by the Control Plane" }]} /></CardBody></Card></Section><Section title="Environment"><Card><CardBody><KeyValue rows={[{ key: "Environment", value: "Not exposed by the Control Plane" }, { key: "Hosting / production URL", value: "Not exposed by the Control Plane" }]} /></CardBody></Card></Section><Section title="Delivery"><Card><CardBody><KeyValue rows={[{ key: "Build / deployment", value: "Not exposed by the Control Plane" }, { key: "Release version", value: "Not exposed by the Control Plane" }]} /></CardBody></Card></Section></Stack></div></Stack></PageFrame>;
}
