import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { getDevelopmentOverviewFallback } from "../../features/overview/api/overviewDevelopmentAdapter";
import { useOverview } from "../../features/overview";
import { OverviewMetrics } from "./components/OverviewMetrics";
import { OverviewActivityCard } from "./components/OverviewActivityCard";
import { OverviewDegradedState } from "./components/OverviewDegradedState";
import { OverviewStateView } from "./components/OverviewStateView";
import { RecentActivity } from "./components/RecentActivity";
import { WorkforceStatusCard } from "./components/WorkforceStatusCard";
import "./OverviewPage.css";

function OverviewContent({
  metrics,
  summaryCards,
  activity,
}: {
  metrics: ReturnType<typeof getDevelopmentOverviewFallback>['metrics'];
  summaryCards: ReturnType<typeof getDevelopmentOverviewFallback>['summaryCards'];
  activity: ReturnType<typeof getDevelopmentOverviewFallback>['activity'];
}) {
  return (
    <div className="overview-page">
      <PageSection>
        <div className="overview-grid">
          <WorkforceStatusCard />
          <div className="overview-status-side">
            <OverviewMetrics metrics={metrics} />
          </div>
        </div>
      </PageSection>

      <PageSection title="Operational activity" description="A summary of the current operational landscape.">
        <div className="overview-activity-grid">
          {summaryCards.map((item) => (
            <OverviewActivityCard key={item.id} item={item} />
          ))}
        </div>
      </PageSection>

      <PageSection title="Recent activity" description="Latest actions and system events from the workforce.">
        <RecentActivity items={activity} />
      </PageSection>
    </div>
  );
}

export default function OverviewPage() {
  const { data, status, refetch } = useOverview();
  const overview = data ?? getDevelopmentOverviewFallback();

  if (status === "loading") {
    return (
      <PageContainer variant="wide">
        <PageHeader
          eyebrow="AI Workforce"
          title="Overview"
          description="Monitor your AI workforce, operations, and Control Plane activity."
        />
        <OverviewStateView state="loading" />
      </PageContainer>
    );
  }

  if (status === "error") {
    return (
      <PageContainer variant="wide">
        <PageHeader
          eyebrow="AI Workforce"
          title="Overview"
          description="Monitor your AI workforce, operations, and Control Plane activity."
        />
        <OverviewStateView state="error" onRetry={refetch} />
      </PageContainer>
    );
  }

  if (status === "unauthorized") {
    return (
      <PageContainer variant="wide">
        <PageHeader
          eyebrow="AI Workforce"
          title="Overview"
          description="Monitor your AI workforce, operations, and Control Plane activity."
        />
        <OverviewStateView state="unauthorized" />
      </PageContainer>
    );
  }

  if (status === "empty") {
    return (
      <PageContainer variant="wide">
        <PageHeader
          eyebrow="AI Workforce"
          title="Overview"
          description="Monitor your AI workforce, operations, and Control Plane activity."
        />
        <OverviewStateView state="empty" />
      </PageContainer>
    );
  }

  if (status === "degraded") {
    return (
      <PageContainer variant="wide">
        <PageHeader
          eyebrow="AI Workforce"
          title="Overview"
          description="Monitor your AI workforce, operations, and Control Plane activity."
        />
        <div className="overview-page">
          <OverviewDegradedState />
          <OverviewContent metrics={overview.metrics} summaryCards={overview.summaryCards} activity={overview.activity} />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="wide">
      <PageHeader
        eyebrow="AI Workforce"
        title="Overview"
        description="Monitor your AI workforce, operations, and Control Plane activity."
      />
      <OverviewContent metrics={overview.metrics} summaryCards={overview.summaryCards} activity={overview.activity} />
    </PageContainer>
  );
}