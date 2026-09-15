import { SystemHealthCard } from "./SystemHealthCard";
import { PageFrame, Section, Stack } from "../../components/layout";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Metric,
  Skeleton,
  StatusBadge,
  Timestamp,
} from "../../components/ui";
import { RefreshCw } from "../../components/ui/icons";
import { useApiStatus } from "../../features/system";
import { useDashboardSnapshot } from "../../features/dashboard";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import { formatRelativeTime } from "../../lib/time";
import "./overview.css";

export function OverviewPage() {
  const online = useOnlineStatus();
  const { reachability } = useApiStatus();
  const dashboard = useDashboardSnapshot();
  const lastUpdated = dashboard.dataUpdatedAt
    ? formatRelativeTime(new Date(dashboard.dataUpdatedAt).toISOString())
    : null;

  const refreshAction = (
    <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
      {lastUpdated && !dashboard.isPending ? (
        <span className="text-caption" aria-live="polite">
          {dashboard.isFetching ? "Refreshing…" : `Updated ${lastUpdated}`}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        iconLeft={RefreshCw}
        onClick={() => void dashboard.refetch()}
        loading={dashboard.isFetching}
        disabled={dashboard.isPending}
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <PageFrame
      title="AI Workforce Control Center"
      description="Monitor governed workforce activity, availability, and operational health."
      actions={refreshAction}
    >
      <Stack gap="lg">
        <Section title="Workforce at a glance">
          {dashboard.isPending ? (
            <div className="overview-metric-grid" aria-label="Loading overview">
              {Array.from({ length: 6 }, (_, index) => (
                <Card key={index} padded className="overview-metric-skeleton">
                  <Skeleton variant="text" count={2} />
                </Card>
              ))}
            </div>
          ) : dashboard.isError ? (
            <ErrorState
              title="Unable to load workforce overview"
              detail="The dashboard snapshot could not be retrieved. Retry when the Control Plane is available."
              action={
                <Button onClick={() => void dashboard.refetch()}>Retry</Button>
              }
            />
          ) : dashboard.data ? (
            <div className="overview-metric-grid">
              <Metric
                label="Registered agents"
                value={dashboard.data.status.counts.registeredAgents}
              />
              <Metric
                label="Active workflows"
                value={dashboard.data.status.counts.activeWorkflows}
              />
              <Metric
                label="Running tasks"
                value={dashboard.data.status.counts.runningTasks}
              />
              <Metric
                label="Awaiting approval"
                value={dashboard.data.status.counts.awaitingApproval}
              />
              <Metric
                label="Available tools"
                value={dashboard.data.status.counts.availableTools}
              />
              <Metric
                label="Registered projects"
                value={dashboard.data.status.counts.registeredProjects}
              />
            </div>
          ) : null}
        </Section>

        <Section title="Operations">
          <div className="overview-operations-grid">
            <Card className="overview-operation-card">
              <CardHeader>Connectivity</CardHeader>
              <CardBody>
                <Stack gap="sm">
                  <div className="overview-status-row">
                    <span className="text-label">Browser</span>
                    <Badge tone={online ? "success" : "danger"}>
                      {online ? "online" : "offline"}
                    </Badge>
                  </div>
                  <div className="overview-status-row">
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
                    Browser and API availability are monitored separately.
                  </p>
                </Stack>
              </CardBody>
            </Card>

            <Card className="overview-operation-card">
              <CardHeader
                actions={
                  dashboard.data ? (
                    <StatusBadge status={dashboard.data.status.status} />
                  ) : undefined
                }
              >
                Snapshot
              </CardHeader>
              <CardBody>
                {dashboard.data ? (
                  <Stack gap="sm">
                    <div className="overview-status-row">
                      <span className="text-label">Generated</span>
                      <Timestamp value={dashboard.data.generatedAt} relative />
                    </div>
                    <div className="overview-status-row">
                      <span className="text-label">Recent audit events</span>
                      <span>{dashboard.data.recentAudit.length}</span>
                    </div>
                    {dashboard.data.error ? (
                      <p className="text-caption">
                        Some snapshot data may be incomplete.
                      </p>
                    ) : (
                      <p className="text-caption">
                        Counts reflect the latest governed workforce snapshot.
                      </p>
                    )}
                  </Stack>
                ) : (
                  <p className="text-caption">
                    Snapshot information appears when the Control Plane is
                    available.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="System health">
          <div className="overview-health-card">
            <SystemHealthCard />
          </div>
        </Section>
      </Stack>
    </PageFrame>
  );
}
