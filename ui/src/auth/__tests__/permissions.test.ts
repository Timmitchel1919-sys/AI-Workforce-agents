import { describe, expect, it } from "vitest";
import { can, canAccessProject } from "../permissions";

describe("frontend permissions (UX only)", () => {
  it("viewer can only view", () => {
    expect(can("viewer", "view")).toBe(true);
    expect(can("viewer", "approve")).toBe(false);
    expect(can("viewer", "disable_agent")).toBe(false);
  });

  it("operator can act but not administer agents", () => {
    expect(can("operator", "approve")).toBe(true);
    expect(can("operator", "retry_task")).toBe(true);
    expect(can("operator", "disable_agent")).toBe(false);
  });

  it("admin can administer agents", () => {
    expect(can("admin", "disable_agent")).toBe(true);
    expect(can("admin", "enable_agent")).toBe(true);
  });

  it("no role → nothing (deny by default)", () => {
    expect(can(null, "view")).toBe(false);
  });

  it("project scope", () => {
    expect(canAccessProject("*", "aims")).toBe(true);
    expect(canAccessProject(["aims"], "aims")).toBe(true);
    expect(canAccessProject(["aims"], "money-mind")).toBe(false);
    expect(canAccessProject(null, "aims")).toBe(false);
  });
});
