import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { navigationItems } from "../../config/navigation";
import {
  normalizePathname,
  sanitizeStoredWorkspaceContext,
  workspaceReducer,
  WorkspaceContext,
  type StoredWorkspaceContext,
  type WorkspaceRoute,
} from "./workspaceContextState";

const STORAGE_KEY = "aw.workspaceContext.v1";
const emptyContext = (): StoredWorkspaceContext => ({ recentRoutes: [], pinnedRoutes: [] });
const storageKey = (userId: string) => `${STORAGE_KEY}.${userId}`;

function readStoredContext(userId: string | null): StoredWorkspaceContext {
  if (!userId) return emptyContext();
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    return raw ? sanitizeStoredWorkspaceContext(JSON.parse(raw)) : emptyContext();
  } catch {
    return emptyContext();
  }
}

function AccountWorkspaceProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const location = useLocation();
  const [stored, dispatch] = useReducer(workspaceReducer, userId, readStoredContext);
  const current = useMemo<WorkspaceRoute>(() => {
    const projectId = new URLSearchParams(location.search).get("project");
    return { pathname: location.pathname, ...(projectId ? { projectId } : {}) };
  }, [location.pathname, location.search]);
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
  }), [current, stored, togglePinnedRoute]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function WorkspaceContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return <AccountWorkspaceProvider key={userId ?? "anonymous"} userId={userId}>{children}</AccountWorkspaceProvider>;
}
