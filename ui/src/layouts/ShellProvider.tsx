import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ShellContext, type ShellState } from "./shellContext";

const SIDEBAR_KEY = "ai-workforce.sidebar-state";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/**
 * Lightweight UI-only state shared across the shell (sidebar collapse + mobile
 * drawer). No server state here. Sidebar preference persists to localStorage.
 */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setCollapsedState] = useState(readCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const persist = (collapsed: boolean) => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      /* ignore */
    }
  };

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setCollapsedState(collapsed);
    persist(collapsed);
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsedState((prev) => {
      persist(!prev);
      return !prev;
    });
  }, []);

  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  const value = useMemo<ShellState>(
    () => ({
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
    }),
    [
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
    ],
  );

  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}
