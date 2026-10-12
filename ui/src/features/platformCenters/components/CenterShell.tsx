import { useId, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useScope, type Scope } from "../hooks/useScope";
import { useT } from "../lib/useT";
import { Notice, ReportBanner, Skeleton } from "./common";
import { ReportProvider, type Report } from "./report";

export interface TabContext { tab: string; itemId: string | undefined; scope: Scope }

interface Props {
  /** Route base without trailing slash, e.g. "/operations-center". */
  base: string;
  /** i18n group holding `tabs.<id>`, e.g. "ops". */
  group: string;
  tabs: readonly string[];
  defaultTab: string;
  /** Tabs that accept an item id (`/base/:tab/:itemId`). */
  itemTabs?: readonly string[];
  render: (ctx: TabContext) => ReactNode;
}

export const ALL = "all";

/** Shared page frame: project scope and tab state live in the URL (`/base/:tab/:itemId?project=…`). */
export function CenterShell({ base, group, tabs, defaultTab, itemTabs = [], render }: Props) {
  const { tab: tabParam, itemId } = useParams();
  const { tt } = useT();
  const scope = useScope();
  const selectId = useId();
  const [report, setReport] = useState<Report | null>(null);
  const api = useMemo(() => ({ report: setReport, clear: () => setReport(null) }), []);

  if (tabParam !== undefined && !tabs.includes(tabParam)) return <Navigate to={base} replace />;
  const tab = tabParam ?? defaultTab;
  if (itemId && !itemTabs.includes(tab)) return <Navigate to={`${base}/${tab}`} replace />;
  if (scope.loading) return <Skeleton label={tt("common.loading")} />;
  const { projectId, projects, search } = scope;

  return (
    <ReportProvider value={api}>
      <div className="pc-stack">
        <div className="pc-scope">
          <label htmlFor={selectId} className="pc-scope__label">{tt("scope.label")}</label>
          <select id={selectId} className="ui-select" value={projectId ?? ALL} onChange={(event) => scope.select(event.target.value)}>
            <option value={ALL}>{tt("scope.all")}</option>
            {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
          </select>
        </div>
        {scope.failed ? <Notice tone="warning">{tt("scope.loadFailed")}</Notice> : null}
        <nav className="pc-tabs" aria-label={tt("tabs.label")}>
          {tabs.map((id) => (
            <Link key={id} to={`${base}${id === defaultTab ? "" : `/${id}`}${search}`} className={`pc-tab${id === tab ? " is-active" : ""}`} aria-current={id === tab ? "page" : undefined}>
              {tt(`${group}.tabs.${id}`)}
            </Link>
          ))}
        </nav>
        <ReportBanner report={report} onDismiss={() => setReport(null)} />
        <div className="pc-tabpanel">{render({ tab, itemId, scope })}</div>
      </div>
    </ReportProvider>
  );
}
