import { PlaceholderPage } from "../PlaceholderPage";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { useWorkflows } from "../../features/workflows";

export function WorkflowsPage() {
  const query = useWorkflows();
  return (
    <PlaceholderPage
      title="Workflows"
      description="Workflow progression and approvals."
    >
      <QueryStatePanel
        label="GET /api/workflows"
        query={query}
        count={(d) => d.length}
      />
    </PlaceholderPage>
  );
}
