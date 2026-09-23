import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useOverview } from "../../features/overview";
import type { OverviewSnapshot } from "../../features/overview/api/overviewTypes";
import { useI18n } from "../../i18n";
import { OverviewHero } from "./components/OverviewHero";
import { OverviewMetrics } from "./components/OverviewMetrics";
import { OverviewActivityCard } from "./components/OverviewActivityCard";
import { OverviewDegradedState } from "./components/OverviewDegradedState";
import { OverviewStateView } from "./components/OverviewStateView";
import { RecentActivity } from "./components/RecentActivity";
import { WorkforceStatusCard } from "./components/WorkforceStatusCard";
import "./OverviewPage.css";

function OverviewContent({
  snapshot,
  connection,
}: {
  snapshot: OverviewSnapshot;
  connection: "connected" | "degraded";
}) {
  const { t } = useI18n();
  return (
    <div className="overview-page">
      <PageSection>
        <div className="overview-grid">
          <WorkforceStatusCard connection={connection} />
          <div className="overview-status-side">
            <OverviewMetrics metrics={snapshot.metrics} />
          </div>
        </div>
      </PageSection>

      <PageSection title={t("overview.operationalActivity")} description={t("overview.operationalActivityDescription")}>
        <div className="overview-activity-grid">
          {snapshot.summaryCards.map((item) => (
            <OverviewActivityCard key={item.id} item={item} />
          ))}
        </div>
      </PageSection>

      <PageSection title={t("overview.recentActivity")} description={t("overview.recentActivityDescription")}>
        <RecentActivity items={snapshot.activity} />
      </PageSection>
    </div>
  );
}

export default function OverviewPage() {
  const { t } = useI18n();
  const { data, status, refetch } = useOverview();

  const header = (
    <>
      <PageHeader eyebrow={t("common.brand")} title={t("overview.title")} description={t("overview.description")} />
      <OverviewHero />
    </>
  );

  if (status === "loading" || status === "error" || status === "unauthorized" || status === "empty") {
    return (
      <PageContainer variant="wide">
        {header}
        <OverviewStateView state={status} onRetry={status === "error" ? refetch : undefined} />
      </PageContainer>
    );
  }

  // Only real snapshot data is rendered; there is no demo fallback outside development.
  return (
    <PageContainer variant="wide">
      {header}
      {status === "degraded" ? <OverviewDegradedState /> : null}
      {data ? (
        <OverviewContent snapshot={data} connection={status === "degraded" ? "degraded" : "connected"} />
      ) : null}
    </PageContainer>
  );
}
