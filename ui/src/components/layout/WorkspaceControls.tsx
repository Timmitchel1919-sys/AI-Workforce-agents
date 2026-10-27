import { BookmarkPlus, Columns2, Focus, History, Maximize2, PanelRight, Pin, Rows3, Sparkles, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { visibleNavigationItems } from "../../config/navigation";
import { useWorkspaceContext, type WorkspaceLayoutPreset } from "../../features/workspaceContext";
import { useI18n } from "../../i18n";

const relatedRoutes: Record<string, string[]> = {
  "/projects": ["/tasks", "/workflows", "/software-factory", "/graph"],
  "/agents": ["/tasks", "/agent-teams", "/operations"],
  "/tasks": ["/agents", "/workflows", "/approvals"],
  "/workflows": ["/workflow-studio", "/tasks", "/approvals"],
  "/operations": ["/audit-log", "/security-center", "/approvals"],
  "/approvals": ["/audit-log", "/operations"],
};

const resourceType = (pathname: string) => {
  if (pathname.startsWith("/projects")) return "Project";
  if (pathname.startsWith("/agents")) return "Agent";
  if (pathname.startsWith("/tasks")) return "Task";
  if (pathname.startsWith("/workflows")) return "Workflow";
  if (pathname.startsWith("/graph")) return "Graph Node";
  if (pathname.startsWith("/infrastructure")) return "Environment";
  return "Workspace";
};

export function WorkspaceControls() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { accessDetails } = useAuth();
  const workspace = useWorkspaceContext();
  const allowed = useMemo(() => new Map(visibleNavigationItems(accessDetails.role).map((item) => [item.route, item])), [accessDetails.role]);
  const base = Object.keys(relatedRoutes).find((route) => workspace.current.pathname === route || workspace.current.pathname.startsWith(`${route}/`));
  const actions = (base ? relatedRoutes[base] : ["/projects", "/tasks", "/approvals"]).flatMap((route) => allowed.has(route) ? [allowed.get(route)!] : []).slice(0, 4);
  const repeated = workspace.routeVisits.find((item) => item.count >= 3);
  const suggestion = repeated && allowed.get(repeated.pathname);

  useEffect(() => {
    document.documentElement.dataset.workspaceLayout = workspace.layoutPreset;
    document.documentElement.dataset.workspaceInspector = workspace.openPanels.includes("inspector") ? "open" : "closed";
    return () => { delete document.documentElement.dataset.workspaceLayout; delete document.documentElement.dataset.workspaceInspector; };
  }, [workspace.layoutPreset, workspace.openPanels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      if (typing || modalOpen || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "i") { event.preventDefault(); workspace.togglePanel("inspector"); }
      else if (event.key.toLowerCase() === "m") { event.preventDefault(); document.getElementById("main-content")?.focus(); }
      else if (event.key === "[") { const previous = workspace.recentRoutes[1]; if (previous && allowed.has(previous.pathname)) { event.preventDefault(); navigate(previous.pathname); } }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allowed, navigate, workspace]);

  const setPreset = (preset: WorkspaceLayoutPreset) => workspace.setLayoutPreset(preset);
  const enterFullscreen = () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else void document.exitFullscreen?.(); };

  if (pathname.startsWith("/workflow-studio") || pathname.startsWith("/operations")) {
    return null;
  }

  return <>
    <nav className="workspace-controls" aria-label={t("shell.contextActions")}>
      <div className="workspace-controls__actions">
        {actions.map((item) => <Link key={item.route} to={item.route}>{t(item.labelKey)}</Link>)}
        {suggestion ? <button type="button" className="workspace-controls__insight" onClick={() => navigate(suggestion.route)} title={t("shell.frequentRouteSuggestion")}><Sparkles size={14} aria-hidden="true" /><span>{t("shell.frequentRoute", { page: t(suggestion.labelKey) })}</span></button> : null}
      </div>
      <div className="workspace-controls__layouts" role="group" aria-label={t("shell.workspaceLayout")}>
        <button type="button" onClick={workspace.saveCurrentView} title={t("shell.saveView")}><BookmarkPlus size={16} /><span>{t("shell.saveView")}</span></button>
        <button type="button" aria-pressed={workspace.layoutPreset === "standard"} onClick={() => setPreset("standard")} title={t("shell.standardLayout")}><Rows3 size={16} /><span>{t("shell.standardLayout")}</span></button>
        <button type="button" aria-pressed={workspace.layoutPreset === "focus"} onClick={() => setPreset("focus")} title={t("shell.focusMode")}><Focus size={16} /><span>{t("shell.focusMode")}</span></button>
        <button type="button" aria-pressed={workspace.layoutPreset === "split"} onClick={() => setPreset("split")} title={t("shell.splitView")}><Columns2 size={16} /><span>{t("shell.splitView")}</span></button>
        <button type="button" aria-pressed={workspace.openPanels.includes("inspector")} onClick={() => workspace.togglePanel("inspector")} title={t("shell.contextInspector")}><PanelRight size={16} /><span>{t("shell.contextInspector")}</span></button>
        <button type="button" onClick={enterFullscreen} title={t("shell.fullscreen")}><Maximize2 size={16} /><span>{t("shell.fullscreen")}</span></button>
      </div>
    </nav>
    {workspace.openPanels.includes("inspector") ? <aside className="workspace-context-inspector" aria-label={t("shell.contextInspector")}>
      <header><div><small>{resourceType(workspace.current.pathname)}</small><strong>{t("shell.currentContext")}</strong></div><button type="button" onClick={() => workspace.togglePanel("inspector")} aria-label={t("common.close")}><X size={16} /></button></header>
      <section><h3>{t("shell.summary")}</h3><code>{workspace.current.pathname}</code><span>{workspace.current.projectId ? `${t("shell.activeProject")}: ${workspace.current.projectId}` : t("shell.noProjectContext")}</span></section>
      <section><h3>{t("shell.status")}</h3><span className="workspace-context-inspector__unknown">{t("shell.inspectorNotConnected")}</span></section>
      <section><h3>{t("shell.relationships")}</h3><div className="workspace-context-inspector__links">{actions.map((item) => <Link key={item.route} to={item.route}>{t(item.labelKey)}</Link>)}</div></section>
      <section><h3>{t("shell.workspaceHistory")}</h3>{workspace.recentRoutes.slice(0, 5).map((item) => <button key={item.pathname} type="button" onClick={() => navigate(item.pathname)}><History size={13} />{item.pathname}</button>)}</section>
      <section><h3>{t("shell.savedViews")}</h3>{workspace.savedViews.length ? workspace.savedViews.map((view) => <div className="workspace-context-inspector__saved" key={view.id}><button type="button" onClick={() => { workspace.setLayoutPreset(view.layoutPreset); navigate(view.pathname); }}><Pin size={13} />{view.pathname} · {view.layoutPreset}</button><button type="button" onClick={() => workspace.removeSavedView(view.id)} aria-label={t("shell.removeSavedView")}><X size={13} /></button></div>) : <span>{t("shell.noSavedViews")}</span>}</section>
      <section><h3>{t("shell.evidence")}</h3><span>{t("shell.inspectorEvidenceBoundary")}</span></section>
      <footer><kbd>I</kbd> {t("shell.openInspectorShortcut")} · <kbd>M</kbd> {t("shell.focusMainShortcut")} · <kbd>[</kbd> {t("shell.previousResourceShortcut")}</footer>
    </aside> : null}
  </>;
}
