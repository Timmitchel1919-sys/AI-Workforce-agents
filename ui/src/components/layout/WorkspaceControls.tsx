import { Columns2, Focus, Maximize2, PanelRight, Rows3 } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
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

export function WorkspaceControls() {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const workspace = useWorkspaceContext();
  const base = Object.keys(relatedRoutes).find((route) => workspace.current.pathname === route || workspace.current.pathname.startsWith(`${route}/`));
  const allowed = new Map(visibleNavigationItems(accessDetails.role).map((item) => [item.route, item]));
  const actions = (base ? relatedRoutes[base] : ["/projects", "/tasks", "/approvals"]).flatMap((route) => allowed.has(route) ? [allowed.get(route)!] : []).slice(0, 4);

  useEffect(() => {
    document.documentElement.dataset.workspaceLayout = workspace.layoutPreset;
    document.documentElement.dataset.workspaceInspector = workspace.openPanels.includes("inspector") ? "open" : "closed";
    return () => { delete document.documentElement.dataset.workspaceLayout; delete document.documentElement.dataset.workspaceInspector; };
  }, [workspace.layoutPreset, workspace.openPanels]);

  const setPreset = (preset: WorkspaceLayoutPreset) => workspace.setLayoutPreset(preset);
  const enterFullscreen = () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else void document.exitFullscreen?.(); };
  return <>
    <nav className="workspace-controls" aria-label={t("shell.contextActions")}>
      <div className="workspace-controls__actions">{actions.map((item) => <Link key={item.route} to={item.route}>{t(item.labelKey)}</Link>)}</div>
      <div className="workspace-controls__layouts" role="group" aria-label={t("shell.workspaceLayout")}>
        <button type="button" aria-pressed={workspace.layoutPreset === "standard"} onClick={() => setPreset("standard")} title={t("shell.standardLayout")}><Rows3 size={16} /><span>{t("shell.standardLayout")}</span></button>
        <button type="button" aria-pressed={workspace.layoutPreset === "focus"} onClick={() => setPreset("focus")} title={t("shell.focusMode")}><Focus size={16} /><span>{t("shell.focusMode")}</span></button>
        <button type="button" aria-pressed={workspace.layoutPreset === "split"} onClick={() => setPreset("split")} title={t("shell.splitView")}><Columns2 size={16} /><span>{t("shell.splitView")}</span></button>
        <button type="button" aria-pressed={workspace.openPanels.includes("inspector")} onClick={() => workspace.togglePanel("inspector")} title={t("shell.contextInspector")}><PanelRight size={16} /><span>{t("shell.contextInspector")}</span></button>
        <button type="button" onClick={enterFullscreen} title={t("shell.fullscreen")}><Maximize2 size={16} /><span>{t("shell.fullscreen")}</span></button>
      </div>
    </nav>
    {workspace.openPanels.includes("inspector") ? <aside className="workspace-context-inspector" aria-label={t("shell.contextInspector")}>
      <strong>{t("shell.currentContext")}</strong><span>{workspace.current.pathname}</span>{workspace.current.projectId ? <span>{t("shell.activeProject")}: {workspace.current.projectId}</span> : <span>{t("shell.noProjectContext")}</span>}
    </aside> : null}
  </>;
}
