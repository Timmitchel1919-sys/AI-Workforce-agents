import { PlaceholderPage } from "../PlaceholderPage";
import { SystemHealthCard } from "./SystemHealthCard";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { Section, Stack } from "../../components/layout";
import { Badge } from "../../components/ui";
import { useApiStatus } from "../../features/system";
import { useDashboardSnapshot } from "../../features/dashboard";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import type { DashboardSnapshot } from "../../api/contracts";

export function OverviewPage() {
  const online = useOnlineStatus();
  const { reachability } = useApiStatus();
  const dashboard = useDashboardSnapshot();

  return (
    <PlaceholderPage
      title="AI Workforce Control Center"
      description="UI-4 integration foundation — real Control Plane data plumbing (no dashboard design yet)."
    >
      <Stack gap="lg">
        <Section title="Connectivity">
          <Stack gap="sm">
            <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
              <span className="text-label">Browser</span>
              <Badge tone={online ? "success" : "danger"}>
                {online ? "online" : "offline"}
              </Badge>
              <span className="text-label">Control Plane API</span>
              <Badge
                tone={
                  reachability === "reachable"
                    ? "success"
                    : reachability === "checking"
                      ? "neutral"
                      : "danger"
                }
              >
                {reachability}
              </Badge>
            </div>
            <p className="text-caption">
              Browser connectivity and API availability are tracked separately.
            </p>
          </Stack>
        </Section>

        <Section title="Dashboard snapshot">
          <QueryStatePanel
            label="GET /api/dashboard"
            query={dashboard}
            count={(d: DashboardSnapshot) =>
              d.agents.length +
              d.tasks.length +
              d.workflows.length +
              d.approvals.length
            }
          />
        </Section>

        <Section title="System health">
          <SystemHealthCard />
        </Section>
      </Stack>
    </PlaceholderPage>
  );
}
