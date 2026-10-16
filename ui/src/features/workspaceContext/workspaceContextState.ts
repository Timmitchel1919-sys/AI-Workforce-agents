import { createContext } from "react";

export const MAX_RECENT_ROUTES = 8;
export const DASHBOARD_WIDGET_IDS = ["status", "metrics", "activity", "recent"] as const;
export type DashboardWidgetId = typeof DASHBOARD_WIDGET_IDS[number];
export type DashboardWidgetSize = "compact" | "wide";
export type WorkspaceLayoutPreset = "standard" | "focus" | "split";
export type WorkspacePanel = "context" | "inspector";
export interface WorkspaceRoute { pathname: string; projectId?: string }
export interface DashboardWidgetPreference { id: DashboardWidgetId; visible: boolean; size: DashboardWidgetSize }
export interface StoredWorkspaceContext { recentRoutes: WorkspaceRoute[]; pinnedRoutes: string[]; recentSearches: string[]; recentCommands: string[]; openPanels: WorkspacePanel[]; layoutPreset: WorkspaceLayoutPreset; dashboardWidgets: DashboardWidgetPreference[] }
export interface WorkspaceContextValue extends StoredWorkspaceContext {
  current: WorkspaceRoute;
  togglePinnedRoute: (pathname: string) => void;
  isPinnedRoute: (pathname: string) => boolean;
  setLayoutPreset: (preset: WorkspaceLayoutPreset) => void;
  togglePanel: (panel: WorkspacePanel) => void;
  toggleDashboardWidget: (id: DashboardWidgetId) => void;
  moveDashboardWidget: (id: DashboardWidgetId, direction: -1 | 1) => void;
  setDashboardWidgetSize: (id: DashboardWidgetId, size: DashboardWidgetSize) => void;
  resetDashboard: () => void;
  recordSearch: (query: string) => void;
  recordCommand: (route: string) => void;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);
export const defaultDashboardWidgets = (): DashboardWidgetPreference[] => DASHBOARD_WIDGET_IDS.map((id) => ({ id, visible: true, size: id === "metrics" || id === "activity" ? "wide" : "compact" }));
export const emptyWorkspaceContext = (): StoredWorkspaceContext => ({ recentRoutes: [], pinnedRoutes: [], recentSearches: [], recentCommands: [], openPanels: ["context"], layoutPreset: "standard", dashboardWidgets: defaultDashboardWidgets() });

export function normalizePathname(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try { const url = new URL(value, "https://workspace.local"); return url.origin === "https://workspace.local" ? url.pathname : null; } catch { return null; }
}
const isPanel = (value: unknown): value is WorkspacePanel => value === "context" || value === "inspector";
const isPreset = (value: unknown): value is WorkspaceLayoutPreset => value === "standard" || value === "focus" || value === "split";

export function sanitizeStoredWorkspaceContext(value: unknown): StoredWorkspaceContext {
  const candidate = value && typeof value === "object" ? value as Partial<StoredWorkspaceContext> : {};
  const recentRoutes = Array.isArray(candidate.recentRoutes) ? candidate.recentRoutes.flatMap((route) => {
    if (!route || typeof route !== "object") return [];
    const pathname = normalizePathname((route as WorkspaceRoute).pathname);
    return pathname ? [{ pathname }] : [];
  }).slice(0, MAX_RECENT_ROUTES) : [];
  const pinnedRoutes = Array.isArray(candidate.pinnedRoutes) ? Array.from(new Set(candidate.pinnedRoutes.flatMap((route) => { const pathname = typeof route === "string" ? normalizePathname(route) : null; return pathname ? [pathname] : []; }))).slice(0, MAX_RECENT_ROUTES) : [];
  const recentSearches = Array.isArray(candidate.recentSearches) ? Array.from(new Set(candidate.recentSearches.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean))).slice(0, 6) : [];
  const recentCommands = Array.isArray(candidate.recentCommands) ? Array.from(new Set(candidate.recentCommands.flatMap((route) => { const pathname = typeof route === "string" ? normalizePathname(route) : null; return pathname ? [pathname] : []; }))).slice(0, 6) : [];
  const openPanels = Array.isArray(candidate.openPanels) ? Array.from(new Set(candidate.openPanels.filter(isPanel))) : ["context" as const];
  const supplied = Array.isArray(candidate.dashboardWidgets) ? candidate.dashboardWidgets : [];
  const dashboardWidgets = defaultDashboardWidgets().map((fallback) => {
    const found = supplied.find((item) => item?.id === fallback.id);
    return found ? { id: fallback.id, visible: found.visible !== false, size: found.size === "compact" ? "compact" as const : "wide" as const } : fallback;
  });
  return { recentRoutes, pinnedRoutes, recentSearches, recentCommands, openPanels, layoutPreset: isPreset(candidate.layoutPreset) ? candidate.layoutPreset : "standard", dashboardWidgets };
}

export type WorkspaceAction = { type: "visit" | "toggle" | "command"; pathname: string } | { type: "search"; query: string } | { type: "layout"; preset: WorkspaceLayoutPreset } | { type: "panel"; panel: WorkspacePanel } | { type: "widget-toggle"; id: DashboardWidgetId } | { type: "widget-move"; id: DashboardWidgetId; direction: -1 | 1 } | { type: "widget-size"; id: DashboardWidgetId; size: DashboardWidgetSize } | { type: "dashboard-reset" };
export function workspaceReducer(state: StoredWorkspaceContext, action: WorkspaceAction): StoredWorkspaceContext {
  if (action.type === "visit") return { ...state, recentRoutes: [{ pathname: action.pathname }, ...state.recentRoutes.filter((item) => item.pathname !== action.pathname)].slice(0, MAX_RECENT_ROUTES) };
  if (action.type === "toggle") return { ...state, pinnedRoutes: state.pinnedRoutes.includes(action.pathname) ? state.pinnedRoutes.filter((route) => route !== action.pathname) : [action.pathname, ...state.pinnedRoutes].slice(0, MAX_RECENT_ROUTES) };
  if (action.type === "search") { const query = action.query.trim().slice(0, 80); return query ? { ...state, recentSearches: [query, ...state.recentSearches.filter((item) => item !== query)].slice(0, 6) } : state; }
  if (action.type === "command") return { ...state, recentCommands: [action.pathname, ...state.recentCommands.filter((item) => item !== action.pathname)].slice(0, 6) };
  if (action.type === "layout") return { ...state, layoutPreset: action.preset };
  if (action.type === "panel") return { ...state, openPanels: state.openPanels.includes(action.panel) ? state.openPanels.filter((panel) => panel !== action.panel) : [...state.openPanels, action.panel] };
  if (action.type === "widget-toggle") return { ...state, dashboardWidgets: state.dashboardWidgets.map((item) => item.id === action.id ? { ...item, visible: !item.visible } : item) };
  if (action.type === "widget-size") return { ...state, dashboardWidgets: state.dashboardWidgets.map((item) => item.id === action.id ? { ...item, size: action.size } : item) };
  if (action.type === "widget-move") { const index = state.dashboardWidgets.findIndex((item) => item.id === action.id); const target = index + action.direction; if (index < 0 || target < 0 || target >= state.dashboardWidgets.length) return state; const dashboardWidgets = [...state.dashboardWidgets]; [dashboardWidgets[index], dashboardWidgets[target]] = [dashboardWidgets[target], dashboardWidgets[index]]; return { ...state, dashboardWidgets }; }
  return { ...state, dashboardWidgets: defaultDashboardWidgets() };
}
