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
});
