import { describe, expect, it } from "vitest";
import type { ApprovalItem, AuditItem } from "../../governance";
import { mayAutomateWithoutAuthorization, requiresExplicitAuthorization } from "../automationPolicy";
import { buildNotifications } from "../notificationModel";

describe("smart notification model", () => {
  it("uses only supplied Control Plane records and prioritizes actual risk/outcomes", () => {
    const approval = { approvalId: "a1", status: "requested", action: "release", risk: "high", requestedBy: "u1", reason: "production", requestedAt: "2026-10-16T10:00:00Z" } satisfies ApprovalItem;
    const audit = { id: "e1", timestamp: "2026-10-16T11:00:00Z", type: "deployment.failed", outcome: "failed", data: {} } satisfies AuditItem;
    const items = buildNotifications([approval], [audit]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ category: "deployment", priority: "critical", source: "audit" });
    expect(items[1]).toMatchObject({ category: "approval", priority: "critical", source: "approval" });
    expect(buildNotifications([], [])).toEqual([]);
  });
});

describe("UX automation boundary", () => {
  it("permits UI preparation but never silently permits privileged or unknown actions", () => {
    expect(mayAutomateWithoutAuthorization("apply_filter")).toBe(true);
    expect(mayAutomateWithoutAuthorization("prepare_action_form")).toBe(true);
    expect(requiresExplicitAuthorization("deploy")).toBe(true);
    expect(requiresExplicitAuthorization("approve")).toBe(true);
    expect(requiresExplicitAuthorization("arbitrary_new_action")).toBe(true);
  });
});

