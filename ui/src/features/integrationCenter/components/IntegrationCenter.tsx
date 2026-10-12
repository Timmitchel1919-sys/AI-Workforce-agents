import { useId, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useScope } from "../hooks/useScope";
import { ALL_PROJECTS } from "../lib/logic";
import { useT } from "../lib/useT";
import { TABS, type IntegrationTab } from "../types";
import { ConnectorDetail } from "./ConnectorDetail";
import { EventsTab } from "./EventsTab";
import { LogTab } from "./LogTab";
import { OverviewTab } from "./OverviewTab";
import { ToolsTab } from "./ToolsTab";
import { Notice, ReportBanner, Skeleton } from "./common";
import { ReportProvider, type Report } from "./report";

function isTab(value: string | undefined): value is IntegrationTab {
  return value !== undefined && (TABS as readonly string[]).includes(value);
}

/** Integration Center: project scope + tab state live in the URL (`/integration-center/:tab/:itemId?project=…`). */
export function IntegrationCenter() {
  const { tab: tabParam, itemId } = useParams();
  const { tt } = useT();
  const scope = useScope();
  const selectId = useId();
  const [report, setReport] = useState<Report | null>(null);
  const api = useMemo(() => ({ report: setReport, clear: () => setReport(null) }), []);

  if (tabParam !== undefined && !isTab(tabParam)) return <Navigate to="/integration-center" replace />;
  const tab: IntegrationTab = isTab(tabParam) ? tabParam : "overview";
  // An item id is only meaningful for a connector (the overview tab).
  if (itemId && tab !== "overview") return <Navigate to={`/integration-center/${tab}`} replace />;
  if (scope.loading) return <Skeleton label={tt("common.loading")} />;

  const { projectId, projects, search } = scope;

  return (
    <ReportProvider value={api}>
      <div className="ic-stack">
        <div className="ic-scope">
          <label htmlFor={selectId} className="ic-scope__label">{tt("scope.label")}</label>
          <select id={selectId} className="ui-select" value={projectId ?? ALL_PROJECTS} onChange={(event) => scope.select(event.target.value)}>
            <option value={ALL_PROJECTS}>{tt("scope.all")}</option>
            {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
          </select>
        </div>
        {scope.failed ? <Notice tone="warning">{tt("scope.loadFailed")}</Notice> : null}

        <nav className="ic-tabs" aria-label={tt("tabs.label")}>
          {TABS.map((id) => (
            <Link
              key={id}
              to={`/integration-center${id === "overview" ? "" : `/${id}`}${search}`}
              className={`ic-tab${id === tab ? " is-active" : ""}`}
              aria-current={id === tab ? "page" : undefined}
            >
              {tt(`tabs.${id}`)}
            </Link>
          ))}
        </nav>

        <ReportBanner report={report} onDismiss={() => setReport(null)} />

        <div className="ic-tabpanel">
          {tab === "overview" && !itemId ? <OverviewTab projectId={projectId} search={search} /> : null}
          {tab === "overview" && itemId ? <ConnectorDetail connectorId={itemId} projectId={projectId} search={search} projects={projects} /> : null}
          {tab === "tools" ? <ToolsTab projectId={projectId} projects={projects} /> : null}
          {tab === "events" ? <EventsTab projectId={projectId} projects={projects} /> : null}
          {tab === "log" ? <LogTab projectId={projectId} projects={projects} /> : null}
        </div>
      </div>
    </ReportProvider>
  );
}
