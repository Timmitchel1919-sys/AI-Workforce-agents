import { describe, expect, it } from "vitest";
import { allowsRole } from "../roleAccess";

describe("role-aware route discovery", () => {
  it("keeps admin surfaces unavailable to viewer and operator roles", () => {
    expect(allowsRole("viewer", "admin")).toBe(false);
    expect(allowsRole("operator", "admin")).toBe(false);
    expect(allowsRole(undefined, "admin")).toBe(false);
    expect(allowsRole("admin", "admin")).toBe(true);
  });

  it("uses an ordered role hierarchy only for UI discovery", () => {
    expect(allowsRole("admin", "operator")).toBe(true);
    expect(allowsRole("operator", "viewer")).toBe(true);
    expect(allowsRole("viewer", "operator")).toBe(false);
  });
});
