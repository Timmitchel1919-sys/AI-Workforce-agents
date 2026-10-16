import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { navigationItems } from "../../config/navigation";
import {
  normalizePathname,
  sanitizeStoredWorkspaceContext,
  workspaceReducer,
  WorkspaceContext,
  emptyWorkspaceContext,
  type WorkspaceRoute,
  type WorkspaceLayoutPreset, type WorkspacePanel, type DashboardWidgetId, type DashboardWidgetSize,
} from "./workspaceContextState";

const STORAGE_KEY = "aw.workspaceContext.v2";
const storageKey = (userId: string) => `${STORAGE_KEY}.${userId}`;

function readStoredContext(userId: string | null) {
  if (!userId) return emptyWorkspaceContext();
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    return raw ? sanitizeStoredWorkspaceContext(JSON.parse(raw)) : emptyWorkspaceContext();
  } catch {
    return emptyWorkspaceContext();
  }
}

function AccountWorkspaceProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const location = useLocation();
  const [stored, dispatch] = useReducer(workspaceReducer, userId, readStoredContext);
  const current = useMemo<WorkspaceRoute>(() => {
    // Project identity must come from an authorized resource response. A query-string value is
    // caller-controlled and must never make an otherwise hidden project visible in workspace state.
    return { pathname: location.pathname };
  }, [location.pathname]);
  const coarsePathname = useMemo(() => navigationItems
    .map((item) => item.route)
    .filter((route) => location.pathname === route || location.pathname.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0] ?? "/overview", [location.pathname]);

  useEffect(() => {
    if (userId) dispatch({ type: "visit", pathname: coarsePathname });
  }, [coarsePathname, userId]);
  useEffect(() => {
    try {
      if (userId) window.sessionStorage.setItem(storageKey(userId), JSON.stringify(stored));
    } catch { /* optional browser preference */ }
  }, [stored, userId]);

  const togglePinnedRoute = useCallback((pathname: string) => {
    const normalized = normalizePathname(pathname);
    if (normalized) dispatch({ type: "toggle", pathname: normalized });
  }, []);
  const value = useMemo(() => ({
    ...stored,
    current,
    togglePinnedRoute,
    isPinnedRoute: (pathname: string) => stored.pinnedRoutes.includes(pathname),
    setLayoutPreset: (preset: WorkspaceLayoutPreset) => dispatch({ type: "layout", preset }),
    togglePanel: (panel: WorkspacePanel) => dispatch({ type: "panel", panel }),
    toggleDashboardWidget: (id: DashboardWidgetId) => dispatch({ type: "widget-toggle", id }),
    moveDashboardWidget: (id: DashboardWidgetId, direction: -1 | 1) => dispatch({ type: "widget-move", id, direction }),
    setDashboardWidgetSize: (id: DashboardWidgetId, size: DashboardWidgetSize) => dispatch({ type: "widget-size", id, size }),
    resetDashboard: () => dispatch({ type: "dashboard-reset" }),
    recordSearch: (query: string) => dispatch({ type: "search", query }),
    recordCommand: (pathname: string) => { const normalized = normalizePathname(pathname); if (normalized) dispatch({ type: "command", pathname: normalized }); },
    saveCurrentView: () => dispatch({ type: "save-view", view: { id: `${current.pathname}:${stored.layoutPreset}`, pathname: current.pathname, layoutPreset: stored.layoutPreset } }),
    removeSavedView: (id: string) => dispatch({ type: "remove-view", id }),
  }), [current, stored, togglePinnedRoute]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function WorkspaceContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return <AccountWorkspaceProvider key={userId ?? "anonymous"} userId={userId}>{children}</AccountWorkspaceProvider>;
}
