import { createContext } from "react";

export const MAX_RECENT_ROUTES = 8;
export interface WorkspaceRoute { pathname: string; projectId?: string }
export interface StoredWorkspaceContext { recentRoutes: WorkspaceRoute[]; pinnedRoutes: string[] }
export interface WorkspaceContextValue extends StoredWorkspaceContext {
  current: WorkspaceRoute;
  togglePinnedRoute: (pathname: string) => void;
  isPinnedRoute: (pathname: string) => boolean;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function normalizePathname(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://workspace.local");
    return url.origin === "https://workspace.local" ? url.pathname : null;
  } catch {
    return null;
  }
}

export function sanitizeStoredWorkspaceContext(value: unknown): StoredWorkspaceContext {
  const candidate = value && typeof value === "object" ? value as Partial<StoredWorkspaceContext> : {};
  const recentRoutes = Array.isArray(candidate.recentRoutes)
    ? candidate.recentRoutes.flatMap((route) => {
        if (!route || typeof route !== "object") return [];
        const pathname = normalizePathname((route as WorkspaceRoute).pathname);
        return pathname ? [{ pathname }] : [];
      }).slice(0, MAX_RECENT_ROUTES)
    : [];
  const pinnedRoutes = Array.isArray(candidate.pinnedRoutes)
    ? Array.from(new Set(candidate.pinnedRoutes.flatMap((route) => {
        const pathname = typeof route === "string" ? normalizePathname(route) : null;
        return pathname ? [pathname] : [];
      }))).slice(0, MAX_RECENT_ROUTES)
    : [];
  return { recentRoutes, pinnedRoutes };
}

export function workspaceReducer(state: StoredWorkspaceContext, action: { type: "visit" | "toggle"; pathname: string }): StoredWorkspaceContext {
  if (action.type === "visit") return {
    ...state,
    recentRoutes: [{ pathname: action.pathname }, ...state.recentRoutes.filter((item) => item.pathname !== action.pathname)].slice(0, MAX_RECENT_ROUTES),
  };
  return {
    ...state,
    pinnedRoutes: state.pinnedRoutes.includes(action.pathname)
      ? state.pinnedRoutes.filter((route) => route !== action.pathname)
      : [action.pathname, ...state.pinnedRoutes].slice(0, MAX_RECENT_ROUTES),
  };
}
