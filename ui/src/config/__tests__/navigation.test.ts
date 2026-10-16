import { describe, expect, it } from "vitest";
import { navigationItems, visibleNavigationItems } from "../navigation";

describe("permission-aware navigation discovery", () => {
  it("does not advertise admin-only routes before an admin role is established", () => {
    const adminRoutes = navigationItems.filter((item) => item.minimumRole === "admin").map((item) => item.route);

    expect(adminRoutes.length).toBeGreaterThan(0);
    expect(visibleNavigationItems(undefined).map((item) => item.route)).not.toEqual(
      expect.arrayContaining(adminRoutes),
    );
    expect(visibleNavigationItems("viewer").map((item) => item.route)).not.toEqual(
      expect.arrayContaining(adminRoutes),
    );
    expect(visibleNavigationItems("operator").map((item) => item.route)).not.toEqual(
      expect.arrayContaining(adminRoutes),
    );
  });

  it("exposes the complete real-route catalogue to administrators", () => {
    expect(visibleNavigationItems("admin")).toEqual(navigationItems);
  });
});
