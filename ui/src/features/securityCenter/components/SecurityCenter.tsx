import { useId } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useOverview } from "../hooks/useTrust";
import { useScope } from "../hooks/useScope";
import { ALL_PROJECTS } from "../lib/logic";
import { useT } from "../lib/useT";
import { TABS, type SecurityTab } from "../types";
import { AgentsTab } from "./AgentsTab";
import { AlertsTab } from "./AlertsTab";
import { ApprovalsTab } from "./ApprovalsTab";
import { AuditTab } from "./AuditTab";
import { EmergencyTab } from "./EmergencyTab";
import { ModelsTab } from "./ModelsTab";
import { OverviewTab } from "./OverviewTab";
import { PoliciesTab } from "./PoliciesTab";
import { ProjectSecurityTab } from "./ProjectSecurityTab";
import { SecretsTab } from "./SecretsTab";
import { SimulatorTab } from "./SimulatorTab";
import { ToolsTab } from "./ToolsTab";
import { Notice, Skeleton } from "./common";

function isTab(value: string | undefined): value is SecurityTab {
  return value !== undefined && (TABS as readonly string[]).includes(value);
}

/** Permanently visible on every tab while the emergency stop is active. The text comes from the server. */
function PauseBanner({ projectId }: { projectId: string | undefined }) {
  const { data } = useOverview(projectId);
  if (!data?.banner) return null;
  return (
    <div className="sc-banner" role="alert" data-testid="pause-banner">
      <strong>{data.banner}</strong>
    </div>
  );
}

/** Security & Trust Center: project scope + tab state live in the URL (`/security-center/:tab/:itemId?project=…`). */
export function SecurityCenter() {
  const { tab: tabParam, itemId } = useParams();
  const { tt } = useT();
  const scope = useScope();
  const selectId = useId();

  if (tabParam !== undefined && !isTab(tabParam)) return <Navigate to="/security-center" replace />;
  const tab: SecurityTab = isTab(tabParam) ? tabParam : "overview";
  // An item id is only meaningful for alerts and policies.
  if (itemId && tab !== "security" && tab !== "policies") return <Navigate to={`/security-center/${tab}`} replace />;
  if (scope.loading) return <Skeleton label={tt("common.loading")} />;

  const { projectId, projects, search } = scope;

  return (
    <div className="sc-stack">
      <PauseBanner projectId={projectId} />
      <div className="sc-scope">
        <label htmlFor={selectId} className="sc-scope__label">{tt("scope.label")}</label>
        <select id={selectId} className="ui-select" value={projectId ?? ALL_PROJECTS} onChange={(event) => scope.select(event.target.value)}>
          <option value={ALL_PROJECTS}>{tt("scope.all")}</option>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
        </select>
      </div>
      {scope.failed ? <Notice tone="warning">{tt("scope.loadFailed")}</Notice> : null}

      <nav className="sc-tabs" aria-label={tt("tabs.label")}>
        {TABS.map((id) => (
          <Link
            key={id}
            to={`/security-center${id === "overview" ? "" : `/${id}`}${search}`}
            className={`sc-tab${id === tab ? " is-active" : ""}`}
            aria-current={id === tab ? "page" : undefined}
          >
            {tt(`tabs.${id}`)}
          </Link>
        ))}
      </nav>

      <div className="sc-tabpanel">
        {tab === "overview" ? <OverviewTab projectId={projectId} /> : null}
        {tab === "security" ? <AlertsTab projectId={projectId} search={search} alertId={itemId} /> : null}
        {tab === "agents" ? <AgentsTab /> : null}
        {tab === "models" ? <ModelsTab /> : null}
        {tab === "tools" ? <ToolsTab /> : null}
        {tab === "policies" ? <PoliciesTab search={search} projects={projects} policyId={itemId} /> : null}
        {tab === "approvals" ? <ApprovalsTab projectId={projectId} projects={projects} /> : null}
        {tab === "simulator" ? <SimulatorTab projectId={projectId} projects={projects} /> : null}
        {tab === "audit" ? <AuditTab projectId={projectId} /> : null}
        {tab === "secrets" ? <SecretsTab /> : null}
        {tab === "project" ? <ProjectSecurityTab projectId={projectId} /> : null}
        {tab === "emergency" ? <EmergencyTab projectId={projectId} /> : null}
      </div>
    </div>
  );
}
