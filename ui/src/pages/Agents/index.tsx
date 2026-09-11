import { PlaceholderPage } from "../PlaceholderPage";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { useAgents } from "../../features/agents";

export function AgentsPage() {
  const query = useAgents();
  return (
    <PlaceholderPage
      title="Agents"
      description="Roster, status, capabilities, current task."
    >
      <QueryStatePanel
        label="GET /api/agents"
        query={query}
        count={(d) => d.length}
      />
    </PlaceholderPage>
  );
}
