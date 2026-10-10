import { useId } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ALL_PROJECTS } from "../lib/logic";
import { useScope } from "../hooks/useScope";
import { useT } from "../lib/useT";
import { TABS, type KnowledgeTab } from "../types";
import { ConflictsTab } from "./ConflictsTab";
import { DecisionsTab } from "./DecisionsTab";
import { DocumentsTab } from "./DocumentsTab";
import { GraphTab } from "./GraphTab";
import { MemoriesTab } from "./MemoriesTab";
import { MemoryDetailView } from "./MemoryDetail";
import { OverviewTab } from "./OverviewTab";
import { ProjectTab } from "./ProjectTab";
import { SettingsTab } from "./SettingsTab";
import { Notice, Skeleton } from "./common";

function isTab(value: string | undefined): value is KnowledgeTab {
  return value !== undefined && (TABS as readonly string[]).includes(value);
}

/** Knowledge Center: project scope + tab state live in the URL (`/knowledge/:tab/:memoryId?project=…`). */
export function KnowledgeCenter() {
  const { tab: tabParam, memoryId } = useParams();
  const { tt } = useT();
  const scope = useScope();
  const selectId = useId();

  if (tabParam !== undefined && !isTab(tabParam)) return <Navigate to="/knowledge" replace />;
  const tab: KnowledgeTab = isTab(tabParam) ? tabParam : "overview";
  // A memory id is only meaningful under the Memories tab.
  if (memoryId && tab !== "memories") return <Navigate to="/knowledge/memories" replace />;
  if (scope.loading) return <Skeleton label={tt("common.loading")} />;

  const { projectId, projects, search } = scope;

  return (
    <div className="kn-stack">
      <div className="kn-scope">
        <label htmlFor={selectId} className="kn-scope__label">{tt("scope.label")}</label>
        <select id={selectId} className="ui-select" value={projectId ?? ALL_PROJECTS} onChange={(event) => scope.select(event.target.value)}>
          <option value={ALL_PROJECTS}>{tt("scope.all")}</option>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
        </select>
      </div>
      {scope.failed ? <Notice tone="warning">{tt("scope.loadFailed")}</Notice> : null}

      <nav className="kn-tabs" aria-label={tt("tabs.label")}>
        {TABS.map((id) => (
          <Link
            key={id}
            to={`/knowledge${id === "overview" ? "" : `/${id}`}${search}`}
            className={`kn-tab${id === tab ? " is-active" : ""}`}
            aria-current={id === tab ? "page" : undefined}
          >
            {tt(`tabs.${id}`)}
          </Link>
        ))}
      </nav>

      <div className="kn-tabpanel">
        {tab === "overview" ? <OverviewTab projectId={projectId} /> : null}
        {tab === "project" ? <ProjectTab projectId={projectId} search={search} /> : null}
        {tab === "memories" ? (
          memoryId ? <MemoryDetailView key={memoryId} memoryId={memoryId} /> : <MemoriesTab projectId={projectId} projects={projects} search={search} />
        ) : null}
        {tab === "documents" ? <DocumentsTab projectId={projectId} projects={projects} /> : null}
        {tab === "decisions" ? <DecisionsTab projectId={projectId} search={search} /> : null}
        {tab === "graph" ? <GraphTab projectId={projectId} /> : null}
        {tab === "conflicts" ? <ConflictsTab projectId={projectId} search={search} /> : null}
        {tab === "settings" ? <SettingsTab projectId={projectId} /> : null}
      </div>
    </div>
  );
}
