import { PlaceholderPage } from "../PlaceholderPage";
import { SystemHealthCard } from "./SystemHealthCard";

export function OverviewPage() {
  return (
    <PlaceholderPage
      title="AI Workforce Control Center"
      description="Overview of agents, tasks, workflows, approvals, and system health."
    >
      <SystemHealthCard />
    </PlaceholderPage>
  );
}
