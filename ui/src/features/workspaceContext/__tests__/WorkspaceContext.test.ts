import { describe, expect, it } from "vitest";
import { emptyWorkspaceContext, sanitizeStoredWorkspaceContext, workspaceReducer } from "../workspaceContextState";

describe("workspace context persistence", () => {
  it("keeps only bounded same-origin route metadata", () => {
    const result = sanitizeStoredWorkspaceContext({
      recentRoutes: [
        { pathname: "/projects", projectId: "project-a" },
        { pathname: "https://attacker.example/admin" },
        { pathname: "//attacker.example/admin" },
        { pathname: "/tasks", projectId: "x".repeat(121) },
      ],
      pinnedRoutes: ["/projects", "/projects", "javascript:alert(1)"],
    });

    expect(result).toEqual({
      recentRoutes: [{ pathname: "/projects" }, { pathname: "/tasks" }],
      pinnedRoutes: ["/projects"],
      recentSearches: [],
      recentCommands: [],
      savedViews: [],
      recentLayouts: [],
      routeVisits: [],
      openPanels: ["context"],
      layoutPreset: "standard",
      dashboardWidgets: [
        { id: "status", visible: true, size: "compact" },
        { id: "metrics", visible: true, size: "wide" },
        { id: "activity", visible: true, size: "wide" },
        { id: "recent", visible: true, size: "compact" },
      ],
    });
  });

  it("bounds and sanitizes recent search and command history", () => {
    let state = emptyWorkspaceContext();
    state = workspaceReducer(state, { type: "search", query: `  ${"x".repeat(100)}  ` });
    state = workspaceReducer(state, { type: "command", pathname: "/projects" });
    const sanitized = sanitizeStoredWorkspaceContext({ ...state, recentCommands: ["/projects", "https://attacker.example"] });
    expect(sanitized.recentSearches).toEqual(["x".repeat(80)]);
    expect(sanitized.recentCommands).toEqual(["/projects"]);
  });

  it("keeps layout preferences presentation-only and supports reset", () => {
    let state = emptyWorkspaceContext();
    state = workspaceReducer(state, { type: "layout", preset: "focus" });
    state = workspaceReducer(state, { type: "widget-toggle", id: "recent" });
    state = workspaceReducer(state, { type: "widget-move", id: "metrics", direction: -1 });
    expect(state.layoutPreset).toBe("focus");
    expect(state.dashboardWidgets[0].id).toBe("metrics");
    expect(state.dashboardWidgets.find((item) => item.id === "recent")?.visible).toBe(false);
    state = workspaceReducer(state, { type: "dashboard-reset" });
    expect(state.dashboardWidgets.map((item) => item.id)).toEqual(["status", "metrics", "activity", "recent"]);
  });

  it("stores bounded privacy-conscious history and saved views", () => {
    let state = emptyWorkspaceContext();
    state = workspaceReducer(state, { type: "visit", pathname: "/projects" });
    state = workspaceReducer(state, { type: "visit", pathname: "/projects" });
    state = workspaceReducer(state, { type: "layout", preset: "split" });
    state = workspaceReducer(state, { type: "save-view", view: { id: "/projects:split", pathname: "/projects", layoutPreset: "split" } });
    expect(state.routeVisits).toEqual([{ pathname: "/projects", count: 2 }]);
    expect(state.recentLayouts).toEqual(["split"]);
    expect(state.savedViews).toEqual([{ id: "/projects:split", pathname: "/projects", layoutPreset: "split" }]);
    state = workspaceReducer(state, { type: "remove-view", id: "/projects:split" });
    expect(state.savedViews).toEqual([]);
  });
});
