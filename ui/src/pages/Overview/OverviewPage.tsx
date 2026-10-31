import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useOverview } from "../../features/overview";
import type { OverviewSnapshot } from "../../features/overview/api/overviewTypes";
import { useI18n } from "../../i18n";
import { OverviewMetrics } from "./components/OverviewMetrics";
import { OverviewHero } from "./components/OverviewHero";
import { OverviewActivityCard } from "./components/OverviewActivityCard";
import { OverviewDegradedState } from "./components/OverviewDegradedState";
import { OverviewStateView } from "./components/OverviewStateView";
import { RecentActivity } from "./components/RecentActivity";
import { WorkforceStatusCard } from "./components/WorkforceStatusCard";
import "./OverviewPage.css";
import { ArrowDown, ArrowUp, LayoutDashboard, RotateCcw, Settings2 } from "lucide-react";
import { useState } from "react";
import { useWorkspaceContext, type DashboardWidgetId } from "../../features/workspaceContext";

function OverviewContent({
  snapshot,
  connection,
}: {
  snapshot: OverviewSnapshot;
  connection: "connected" | "degraded";
}) {
  const { t } = useI18n();
  const workspace = useWorkspaceContext();
  const [editing, setEditing] = useState(false);
  const widgets: Record<DashboardWidgetId, React.ReactNode> = {
    status: <PageSection><div className="overview-grid"><WorkforceStatusCard connection={connection} /></div></PageSection>,
    metrics: <PageSection><div className="overview-status-side"><OverviewMetrics metrics={snapshot.metrics} /></div></PageSection>,
    activity: <PageSection title={t("overview.operationalActivity")} description={t("overview.operationalActivityDescription")}><div className="overview-activity-grid">{snapshot.summaryCards.map((item) => <OverviewActivityCard key={item.id} item={item} />)}</div></PageSection>,
    recent: <PageSection title={t("overview.recentActivity")} description={t("overview.recentActivityDescription")}><RecentActivity items={snapshot.activity} /></PageSection>,
  };
  return (
    <div className="overview-page">
      <div className="overview-personalize">
        <div><LayoutDashboard size={18} aria-hidden="true" /><span>{t("overview.workspaceLayout")}</span></div>
        <button type="button" className="overview-personalize__button" aria-expanded={editing} onClick={() => setEditing((value) => !value)}><Settings2 size={16} aria-hidden="true" />{t("overview.customize")}</button>
      </div>
      {editing ? <section className="overview-widget-settings" aria-label={t("overview.customize")}>
        {workspace.dashboardWidgets.map((widget, index) => <div key={widget.id} className="overview-widget-setting">
          <label><input type="checkbox" checked={widget.visible} onChange={() => workspace.toggleDashboardWidget(widget.id)} />{t(`overview.widgets.${widget.id}`)}</label>
          <div>
            <button type="button" disabled={index === 0} aria-label={t("overview.moveUp", { widget: t(`overview.widgets.${widget.id}`) })} onClick={() => workspace.moveDashboardWidget(widget.id, -1)}><ArrowUp size={15} /></button>
            <button type="button" disabled={index === workspace.dashboardWidgets.length - 1} aria-label={t("overview.moveDown", { widget: t(`overview.widgets.${widget.id}`) })} onClick={() => workspace.moveDashboardWidget(widget.id, 1)}><ArrowDown size={15} /></button>
            <select aria-label={t("overview.widgetSize", { widget: t(`overview.widgets.${widget.id}`) })} value={widget.size} onChange={(event) => workspace.setDashboardWidgetSize(widget.id, event.target.value === "compact" ? "compact" : "wide")}><option value="compact">{t("overview.compact")}</option><option value="wide">{t("overview.wide")}</option></select>
          </div>
        </div>)}
        <button type="button" className="overview-personalize__button" onClick={workspace.resetDashboard}><RotateCcw size={15} aria-hidden="true" />{t("overview.resetLayout")}</button>
      </section> : null}
      <div className="overview-widgets">
        {workspace.dashboardWidgets.filter((widget) => widget.visible).map((widget) => <div key={widget.id} className={`overview-widget overview-widget--${widget.size}`}>{widgets[widget.id]}</div>)}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { t } = useI18n();
  const { data, status, refetch } = useOverview();

  // Operational data leads; the brand hero sits below it so KPIs stay above the fold.
  const header = <PageHeader title={t("overview.title")} description={t("overview.description")} />;

  if (status === "loading" || status === "error" || status === "unauthorized" || status === "empty") {
    return (
      <PageContainer variant="wide">
        {header}
        <OverviewStateView state={status} onRetry={status === "error" ? refetch : undefined} />
        <OverviewHero />
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
      <OverviewHero />
    </PageContainer>
  );
}
