import { PlaceholderPage } from "../PlaceholderPage";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { useProjects } from "../../features/projects";

export function ProjectsPage() {
  const query = useProjects();
  return (
    <PlaceholderPage
      title="Projects"
      description="Registered projects and adapter status."
    >
      <QueryStatePanel
        label="GET /api/projects"
        query={query}
        count={(d) => d.length}
      />
    </PlaceholderPage>
  );
}
