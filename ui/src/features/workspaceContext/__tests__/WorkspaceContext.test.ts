import { describe, expect, it } from "vitest";
import { sanitizeStoredWorkspaceContext } from "../workspaceContextState";

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
    });
  });
});
