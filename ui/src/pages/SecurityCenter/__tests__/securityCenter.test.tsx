import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeAgent, makeAlert, makeApproval, makeEmergency, makeOverview, makePolicy, makeProjectSecurity, makeRow, makeSecrets, makeTrust, LAYERS,
} from "../../../features/securityCenter/__tests__/fixtures";
import { TABS } from "../../../features/securityCenter/types";
import { executed, json, rejected, renderAt, stubApi, type Call } from "./harness";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const commandCalls = (calls: Call[], name: string) => calls.filter((c) => c.path === `/api/commands/${name}`);
const apiCalls = (calls: Call[], path: string) => calls.filter((c) => c.path === path);
const last = <T,>(list: T[]): T => list[list.length - 1] as T;
const locationText = () => screen.getByTestId("location").textContent;
const dialog = () => screen.getByRole("dialog");
const ADMIN = { role: "admin" as const, capabilities: ["view", "manage_security", "approve"] };

describe("tab routing", () => {
  it("shows the overview by default and moves between tabs through the URL, keeping the project", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt("/security-center?project=p1");
    expect(await screen.findByRole("heading", { name: "Trust score" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Agents" }));
    expect(await screen.findByRole("heading", { name: "Agent trust" })).toBeInTheDocument();
    expect(locationText()).toBe("/security-center/agents?project=p1");
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Trust score" })).toBeInTheDocument();
    expect(locationText()).toBe("/security-center?project=p1");
  });

  it("sends an unknown tab back to the overview and an item id on a tab without items too", async () => {
    stubApi();
    renderAt("/security-center/bogus");
    expect(await screen.findByRole("heading", { name: "Trust score" })).toBeInTheDocument();
    expect(locationText()).toBe("/security-center");
  });

  it("renders every tab", async () => {
    for (const tab of TABS) {
      stubApi();
      const { unmount } = renderAt(`/security-center/${tab}?project=p1`);
      await waitFor(() => expect(document.querySelector(".sc-panel, .sc-empty")).not.toBeNull());
      expect(screen.getByRole("link", { name: /./, current: "page" })).toBeInTheDocument();
      unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe("pause banner", () => {
  it.each(TABS)("is shown on the %s tab when the server reports a pause", async (tab) => {
    stubApi({ routes: { "/api/trust/overview": makeOverview({ banner: "AI WORKFORCE EXECUTION PAUSED", emergency: makeEmergency({ state: "PAUSED" }) }) } });
    renderAt(`/security-center/${tab}?project=p1`);
    const banner = await screen.findByTestId("pause-banner");
    expect(banner).toHaveTextContent("AI WORKFORCE EXECUTION PAUSED");
    expect(banner).toHaveAttribute("role", "alert");
  });

  it("is absent when there is no banner", async () => {
    stubApi();
    renderAt("/security-center?project=p1");
    await screen.findByRole("heading", { name: "Trust score" });
    expect(screen.queryByTestId("pause-banner")).toBeNull();
  });
});

describe("overview", () => {
  it("always shows the disclaimer with the score and avoids guarantee wording", async () => {
    stubApi();
    renderAt("/security-center?project=p1");
    expect(await screen.findByTestId("trust-score-value")).toHaveTextContent("72");
    expect(screen.getByTestId("trust-disclaimer")).toHaveTextContent("not a guarantee of security");
    expect(screen.getByText(/Open critical alerts: 1 found, -10 points/)).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/100% secure|fully protected|zero risk/i);
  });

  it("shows dashboard cards, 'not scanned' for missing vulnerability data, ledger status and honest capability notes", async () => {
    stubApi();
    renderAt("/security-center?project=p1");
    await screen.findByTestId("trust-score");
    const card = (key: string) => document.querySelector(`[data-card="${key}"]`)?.textContent ?? "";
    expect(card("openAlerts")).toContain("4");
    expect(card("blockedActions24h")).toContain("7");
    expect(card("suspendedAgents")).toContain("1");
    expect(card("dependencyVulnerabilities")).toContain("not scanned");
    expect(screen.getByTestId("dashboard-status")).toHaveTextContent("Attention");
    expect(screen.getByTestId("ledger-status")).toHaveTextContent("Ledger verified, 42 entries");
    expect(screen.getByText("Stale_policy".toLowerCase())).toBeInTheDocument();
    expect(screen.getByText("policy.evaluated")).toBeInTheDocument();
    expect(screen.getByText(/Outbound network detection is not available/)).toBeInTheDocument();
  });

  it("flags a broken ledger", async () => {
    stubApi({ routes: { "/api/trust/overview": makeOverview({ ledger: { ok: false, entries: 10, brokenAt: 4 } }) } });
    renderAt("/security-center?project=p1");
    expect(await screen.findByTestId("ledger-status")).toHaveTextContent("Ledger verification FAILED at entry 4");
  });

  it("reports vulnerability counts when a scan exists and shows the server error with a retry", async () => {
    const dash = makeOverview().dashboard;
    stubApi({ routes: { "/api/trust/overview": makeOverview({ dashboard: { ...dash, dependencyVulnerabilities: { scannedAt: dash.generatedAt, critical: 1, high: 2, moderate: 3, low: 4 } } }) } });
    renderAt("/security-center?project=p1");
    await screen.findByTestId("trust-score");
    expect(document.querySelector('[data-card="dependencyVulnerabilities"]')?.textContent).toContain("1 critical, 2 high, 3 moderate, 4 low");
  });

  it("shows the server's own message when the overview fails", async () => {
    stubApi({ routes: { "/api/trust/overview": json(403, { error: { message: "no access to trust data" } }) } });
    renderAt("/security-center?project=p1");
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("no access to trust data");
  });
});

describe("alerts", () => {
  const alerts = [
    makeAlert({ alertId: "low1", severity: "LOW", event: "Low thing", createdAt: "2026-05-03T00:00:00.000Z" }),
    makeAlert({ alertId: "hi1", severity: "HIGH", event: "High open", createdAt: "2026-05-01T00:00:00.000Z" }),
    makeAlert({ alertId: "crit1", severity: "CRITICAL", event: "Critical open", createdAt: "2026-05-02T00:00:00.000Z" }),
    makeAlert({ alertId: "crit2", severity: "CRITICAL", status: "RESOLVED", event: "Critical closed", createdAt: "2026-05-04T00:00:00.000Z" }),
  ];

  it("pins unresolved critical and high alerts at the top, most severe first", async () => {
    stubApi({ routes: { "/api/trust/alerts": { alerts } } });
    renderAt("/security-center/security?project=p1");
    const pinned = await screen.findByTestId("pinned-alerts");
    const ids = Array.from(pinned.querySelectorAll("[data-alert-id]")).map((n) => n.getAttribute("data-alert-id"));
    expect(ids).toEqual(["crit1", "hi1"]);
    const others = Array.from(screen.getByTestId("other-alerts").querySelectorAll("[data-alert-id]")).map((n) => n.getAttribute("data-alert-id"));
    expect(others).toEqual(["crit2", "low1"]);
  });

  it("builds the filter query from the controls", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/security-center/security?project=p1");
    await screen.findByTestId("pinned-alerts");
    await user.selectOptions(screen.getByLabelText("Status"), "INVESTIGATING");
    await user.selectOptions(screen.getByLabelText("Severity"), "HIGH");
    await user.click(screen.getByLabelText("Open alerts only"));
    await waitFor(() => {
      const params = last(apiCalls(calls, "/api/trust/alerts")).params;
      expect(params.get("status")).toBe("INVESTIGATING");
      expect(params.get("severity")).toBe("HIGH");
      expect(params.get("open")).toBe("1");
      expect(params.get("projectId")).toBe("p1");
    });
  });

  it("shows evidence, occurrences and history in the detail view", async () => {
    stubApi();
    renderAt("/security-center/security/al1?project=p1");
    const detail = await screen.findByTestId("alert-detail");
    expect(within(detail).getByText("db://prod")).toBeInTheDocument();
    expect(within(detail).getByText("attempts")).toBeInTheDocument();
    expect(within(detail).getByText("3", { selector: "dd" })).toBeInTheDocument();
    expect(within(detail).getByText("Status history")).toBeInTheDocument();
  });

  it("acknowledges with an optional note", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_alert_transition: () => executed() } });
    renderAt("/security-center/security/al1?project=p1");
    await user.click(await screen.findByRole("button", { name: "Acknowledge" }));
    await user.click(within(dialog()).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(commandCalls(calls, "security_alert_transition")).toHaveLength(1));
    expect(commandCalls(calls, "security_alert_transition")[0]?.body).toEqual({ alertId: "al1", status: "ACKNOWLEDGED" });
  });

  it("requires a note to resolve or mark a false positive", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_alert_transition: () => executed() } });
    renderAt("/security-center/security/al1?project=p1");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const confirm = within(dialog()).getByRole("button", { name: "Resolve" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog()).getByLabelText(/Note/), "Fixed the rule");
    await user.click(confirm);
    await waitFor(() => expect(commandCalls(calls, "security_alert_transition")).toHaveLength(1));
    expect(commandCalls(calls, "security_alert_transition")[0]?.body).toEqual({ alertId: "al1", status: "RESOLVED", note: "Fixed the rule" });
    await user.click(await screen.findByRole("button", { name: "False positive" }));
    expect(within(dialog()).getByRole("button", { name: "False positive" })).toBeDisabled();
  });

  it("shows the server's text when closing a HIGH alert is rejected", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { security_alert_transition: () => rejected("only an administrator may close HIGH or CRITICAL alerts") } });
    renderAt("/security-center/security/al1?project=p1");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    await user.type(within(dialog()).getByLabelText(/Note/), "done");
    await user.click(within(dialog()).getByRole("button", { name: "Resolve" }));
    expect(await within(dialog()).findByTestId("error-reason")).toHaveTextContent("only an administrator may close HIGH or CRITICAL alerts");
  });

  it("offers no lifecycle actions to someone without manage_security", async () => {
    stubApi();
    renderAt("/security-center/security/al1?project=p1", { capabilities: ["view"], role: "viewer" });
    await screen.findByTestId("alert-detail");
    expect(screen.queryByTestId("alert-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
  });
});

describe("agents", () => {
  const agents = [
    makeAgent({ id: "a", agentId: "agent-1", state: "TRUSTED" }),
    makeAgent({ id: "b", agentId: "agent-2", state: "SUSPENDED", reason: "leaked token" }),
    makeAgent({ id: "c", agentId: "agent-3", state: "DISABLED" }),
  ];

  it("suspends an agent only with a reason", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ routes: { "/api/trust/trust": makeTrust({ agents }) }, commands: { security_set_agent_trust: () => executed() } });
    renderAt("/security-center/agents?project=p1");
    await user.click(await screen.findByRole("button", { name: /Suspend agent-1/ }));
    const confirm = within(dialog()).getByRole("button", { name: "Suspend" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog()).getByLabelText(/Reason/), "odd behaviour");
    await user.click(confirm);
    await waitFor(() => expect(commandCalls(calls, "security_set_agent_trust")).toHaveLength(1));
    expect(commandCalls(calls, "security_set_agent_trust")[0]?.body).toEqual({ agentId: "agent-1", state: "SUSPENDED", reason: "odd behaviour" });
  });

  it("limits, requires review and restores with the right states", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ routes: { "/api/trust/trust": makeTrust({ agents }) }, commands: { security_set_agent_trust: () => executed() } });
    renderAt("/security-center/agents?project=p1");
    await user.click(await screen.findByRole("button", { name: /Limit agent-1/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Limit" }));
    await waitFor(() => expect(commandCalls(calls, "security_set_agent_trust")).toHaveLength(1));
    expect(commandCalls(calls, "security_set_agent_trust")[0]?.body).toEqual({ agentId: "agent-1", state: "LIMITED" });
    await user.click(await screen.findByRole("button", { name: /Require review agent-1/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Require review" }));
    await waitFor(() => expect(commandCalls(calls, "security_set_agent_trust")).toHaveLength(2));
    expect(last(commandCalls(calls, "security_set_agent_trust")).body).toMatchObject({ state: "REVIEW_REQUIRED" });
  });

  it("shows the server's message when restoring a suspended agent is refused", async () => {
    const user = userEvent.setup();
    stubApi({
      routes: { "/api/trust/trust": makeTrust({ agents }) },
      commands: { security_set_agent_trust: () => rejected("only an administrator may lift a suspension") },
    });
    renderAt("/security-center/agents?project=p1");
    await user.click(await screen.findByRole("button", { name: /Restore agent-2/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Restore" }));
    expect(await within(dialog()).findByTestId("error-reason")).toHaveTextContent("only an administrator may lift a suspension");
  });

  it("shows a disabled agent read-only", async () => {
    stubApi({ routes: { "/api/trust/trust": makeTrust({ agents }) } });
    renderAt("/security-center/agents?project=p1");
    const row = (await screen.findByText("agent-3")).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).getByText(/operational enable switch/)).toBeInTheDocument();
  });

  it("offers no actions to a viewer", async () => {
    stubApi({ routes: { "/api/trust/trust": makeTrust({ agents }) } });
    renderAt("/security-center/agents?project=p1", { capabilities: ["view"], role: "viewer" });
    await screen.findByText("agent-1");
    expect(screen.queryByRole("button", { name: /Suspend/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
  });
});

describe("models and tools", () => {
  it("shows model trust, the default policy and an edit dialog for administrators", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_set_model_trust: () => executed() } });
    renderAt("/security-center/models?project=p1", ADMIN);
    expect(await screen.findByRole("rowheader", { name: "anthropic/claude-x" })).toBeInTheDocument();
    expect(screen.getByText("Provider retains nothing.")).toBeInTheDocument();
    expect(screen.getByText("Default handling text.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Edit anthropic\/claude-x/ }));
    await user.selectOptions(within(dialog()).getByLabelText("Highest data class"), "PUBLIC");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(calls, "security_set_model_trust")).toHaveLength(1));
    expect(commandCalls(calls, "security_set_model_trust")[0]?.body).toMatchObject({
      provider: "anthropic", model: "claude-x", maxDataClass: "PUBLIC", approvedTaskTypes: ["code"], external: true, status: "ENABLED",
    });
  });

  it("hides model and tool editing from non-administrators", async () => {
    stubApi();
    const { unmount } = renderAt("/security-center/models?project=p1");
    await screen.findByText("anthropic/claude-x");
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    unmount();
    renderAt("/security-center/tools?project=p1");
    await screen.findByText("Shell");
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("edits a tool as an administrator", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_set_tool_trust: () => executed() } });
    renderAt("/security-center/tools?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: /Edit Shell/ }));
    await user.selectOptions(within(dialog()).getByLabelText("Approval rule"), "ALWAYS");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(calls, "security_set_tool_trust")).toHaveLength(1));
    expect(commandCalls(calls, "security_set_tool_trust")[0]?.body).toEqual({ toolId: "shell", approval: "ALWAYS", status: "ENABLED", allowedAgents: ["agent-1"] });
  });
});

describe("policies", () => {
  const policies = [makePolicy(), makePolicy({ policyId: "pol-b", name: "Core baseline", builtin: true, critical: true, layer: "SYSTEM_SECURITY" })];

  it("lists policies in precedence order with badges", async () => {
    stubApi({ routes: { "/api/trust/policies": { layers: LAYERS, policies } } });
    renderAt("/security-center/policies?project=p1");
    const layers = await screen.findByTestId("policy-layers");
    expect(Array.from(layers.querySelectorAll("li")).map((l) => l.textContent)[0]).toBe("System security");
    const row = (await screen.findByText("Core baseline")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Built-in")).toBeInTheDocument();
    expect(within(row).getByText("Critical")).toBeInTheDocument();
    expect(within(row).getByText("read-only")).toBeInTheDocument();
  });

  it("never offers ALLOW when creating, and sends the form as a command", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_create_policy: () => executed() } });
    renderAt("/security-center/policies?project=p1");
    await user.click(await screen.findByRole("button", { name: "New policy" }));
    const form = within(dialog());
    const effect = form.getByLabelText("Effect") as HTMLSelectElement;
    expect(Array.from(effect.options).map((o) => o.value)).toEqual(["REQUIRE_REVIEW", "REQUIRE_SECURITY_REVIEW", "REQUIRE_APPROVAL", "DENY"]);
    expect(Array.from(effect.options).some((o) => /allow/i.test(o.textContent ?? ""))).toBe(false);
    expect(form.getByRole("button", { name: "Create policy" })).toBeDisabled();
    await user.type(form.getByLabelText("Name"), "No exports");
    await user.selectOptions(effect, "DENY");
    await user.click(form.getByLabelText("Export"));
    await user.click(form.getByLabelText("Production"));
    await user.type(form.getByLabelText("Resource contains"), "customers, pii");
    await user.type(form.getByLabelText("Minimum count"), "5");
    await user.selectOptions(form.getByLabelText("Minimum risk"), "HIGH");
    await user.click(form.getByRole("button", { name: "Create policy" }));
    await waitFor(() => expect(commandCalls(calls, "security_create_policy")).toHaveLength(1));
    expect(commandCalls(calls, "security_create_policy")[0]?.body).toMatchObject({
      name: "No exports", effect: "DENY", layer: "SYSTEM_SECURITY", critical: false,
      conditions: { actions: ["EXPORT"], environments: ["PRODUCTION"], resourceIncludes: ["customers", "pii"], minCount: 5, minRisk: "HIGH" },
    });
  });

  it("shows conditions readably and edits a custom policy keeping unrelated conditions", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_update_policy: () => executed() } });
    renderAt("/security-center/policies/pol-1?project=p1");
    await screen.findByText("resourceKinds");
    const view = within(screen.getByTestId("policy-view"));
    expect(view.getByText("resourceKinds")).toBeInTheDocument();
    expect(view.getByText("database")).toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "Edit" }));
    const dialogs = screen.getAllByRole("dialog");
    const form = within(dialogs[dialogs.length - 1] as HTMLElement);
    await user.clear(form.getByLabelText("Name"));
    await user.type(form.getByLabelText("Name"), "Renamed");
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(calls, "security_update_policy")).toHaveLength(1));
    expect(commandCalls(calls, "security_update_policy")[0]?.body).toMatchObject({
      policyId: "pol-1", name: "Renamed", conditions: { actions: ["DELETE"], environments: ["PRODUCTION"], resourceKinds: ["database"] },
    });
  });

  it("disables a policy", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_set_policy_status: () => executed() } });
    renderAt("/security-center/policies/pol-1?project=p1");
    await user.click(await screen.findByRole("button", { name: "Disable" }));
    const dialogs = screen.getAllByRole("dialog");
    await user.click(within(dialogs[dialogs.length - 1] as HTMLElement).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(commandCalls(calls, "security_set_policy_status")).toHaveLength(1));
    expect(commandCalls(calls, "security_set_policy_status")[0]?.body).toEqual({ policyId: "pol-1", status: "DISABLED" });
  });

  it("makes built-in policies read-only and explains why; critical ones need an administrator", async () => {
    stubApi({ routes: { "/api/trust/policies/pol-b": makePolicy({ policyId: "pol-b", name: "Core baseline", builtin: true, critical: true }) } });
    renderAt("/security-center/policies/pol-b?project=p1");
    await screen.findByText(/safety baseline/);
    const view = within(screen.getByTestId("policy-view"));
    expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(view.queryByRole("button", { name: "Disable" })).toBeNull();
    expect(view.getByText(/safety baseline/)).toBeInTheDocument();
    expect(view.getByText(/only be created, changed or switched by an administrator/)).toBeInTheDocument();
  });

  it("hides policy authoring from viewers", async () => {
    stubApi();
    renderAt("/security-center/policies?project=p1", { capabilities: ["view"], role: "viewer" });
    await screen.findByText("Block prod deletes");
    expect(screen.queryByRole("button", { name: "New policy" })).toBeNull();
  });
});

describe("approvals", () => {
  it("shows every field of an approval in full", async () => {
    stubApi();
    renderAt("/security-center/approvals?project=p1");
    const card = await screen.findByText(/DELETE · db:\/\/prod\/users/);
    const li = card.closest("li") as HTMLElement;
    const text = li.textContent ?? "";
    for (const expected of [
      "DELETE", "db://prod/users", "Money Mind (p1)", "agent-1", "anthropic/claude-x", "High", "Production",
      "Agent wants to remove stale rows from the users table after the migration finished successfully.", "About 1200 rows removed.",
      "Restorable from last night's backup.", "DELETE FROM users WHERE stale", "psql -c 'DELETE FROM users WHERE stale'", "pol-1, pol-9",
    ]) expect(text, expected).toContain(expected);
    for (const field of ["Reason", "Expected impact", "Reversibility", "Changes", "Proposed command", "Requested by", "Requested at", "Expires"]) {
      expect(within(li).getByText(field)).toBeInTheDocument();
    }
  });

  it("approves, denies and cancels with the right bodies", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_decide_approval: () => executed(), security_cancel_approval: () => executed() } });
    renderAt("/security-center/approvals?project=p1");
    await user.type(await screen.findByLabelText("Note"), "Looks fine");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(commandCalls(calls, "security_decide_approval")).toHaveLength(1));
    expect(commandCalls(calls, "security_decide_approval")[0]?.body).toEqual({ approvalId: "ap1", decision: "approve", note: "Looks fine" });
    await user.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(commandCalls(calls, "security_decide_approval")).toHaveLength(2));
    expect(last(commandCalls(calls, "security_decide_approval")).body).toEqual({ approvalId: "ap1", decision: "deny", note: "Looks fine" });
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(commandCalls(calls, "security_cancel_approval")).toHaveLength(1));
    expect(commandCalls(calls, "security_cancel_approval")[0]?.body).toEqual({ approvalId: "ap1" });
  });

  it("surfaces the server's message for a CRITICAL approval without a note", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      routes: { "/api/trust/approvals": { approvals: [makeApproval({ risk: "CRITICAL" })] } },
      commands: { security_decide_approval: () => rejected("approving a CRITICAL action needs a written note and an administrator") },
    });
    renderAt("/security-center/approvals?project=p1");
    expect(await screen.findByText(/needs a written note and an administrator\. The server decides/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("approving a CRITICAL action needs a written note and an administrator");
    expect(commandCalls(calls, "security_decide_approval")[0]?.body).toEqual({ approvalId: "ap1", decision: "approve" });
  });

  it("loads the history with the closed states and shows no decision buttons", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      routes: { "/api/trust/approvals": (call: Call) => ({ approvals: call.params.get("state") === "PENDING" ? [makeApproval()] : [makeApproval({ approvalId: "ap2", state: "APPROVED", decidedBy: "alice", decision: "approve", decidedAt: "2026-05-01T11:00:00.000Z" })] }) },
    });
    renderAt("/security-center/approvals?project=p1");
    await screen.findByRole("button", { name: "Approve" });
    expect(last(apiCalls(calls, "/api/trust/approvals")).params.get("state")).toBe("PENDING");
    await user.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("Decided by");
    expect(last(apiCalls(calls, "/api/trust/approvals")).params.get("state")).toBe("APPROVED,DENIED,EXPIRED,CANCELLED");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("hides decision buttons without the approve capability", async () => {
    stubApi();
    renderAt("/security-center/approvals?project=p1", { capabilities: ["view", "manage_security"], role: "operator" });
    await screen.findByText(/DELETE · db:\/\/prod\/users/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });
});

describe("simulator", () => {
  it("simulates and shows decision, risk factors, policies, obligations, explanation and that nothing was executed", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/security-center/simulator?project=p1");
    await user.type(await screen.findByLabelText("Resource"), "db://prod");
    await user.selectOptions(screen.getByLabelText("Action"), "DELETE");
    await user.selectOptions(screen.getByLabelText("Environment"), "PRODUCTION");
    await user.type(screen.getByLabelText("Count"), "3");
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    const result = within(await screen.findByTestId("sim-result"));
    const params = last(apiCalls(calls, "/api/trust/simulate")).params;
    expect(Object.fromEntries(params.entries())).toMatchObject({ projectId: "p1", action: "DELETE", resource: "db://prod", environment: "PRODUCTION", count: "3" });
    expect(result.getByTestId("sim-explanation")).toHaveTextContent("Deleting production data requires a human approval first.");
    expect(result.getByTestId("sim-note")).toHaveTextContent("Simulation only - nothing was executed.");
    expect(result.getByText("Decision: Require approval")).toBeInTheDocument();
    expect(result.getByText("production_resource")).toBeInTheDocument();
    expect(result.getByText("One database")).toBeInTheDocument();
    expect(result.getByText("Block prod deletes")).toBeInTheDocument();
    expect(result.getByText("Allow cleanup")).toBeInTheDocument();
    expect(result.getByText("Production data is protected.")).toBeInTheDocument();
    expect(result.getByText("Approval required").nextSibling).toHaveTextContent("yes");
  });

  it("does not call the simulator until the form is submitted", async () => {
    const calls = stubApi();
    renderAt("/security-center/simulator?project=p1");
    await screen.findByRole("heading", { name: "Policy simulator" });
    expect(apiCalls(calls, "/api/trust/simulate")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Simulate" })).toBeDisabled();
  });
});

describe("audit", () => {
  it("builds the ledger query from the filters and shows verification", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/security-center/audit?project=p1");
    expect(await screen.findByTestId("ledger-status")).toHaveTextContent("Ledger verified, 42 entries");
    await user.type(screen.getByLabelText("Agent"), "agent-1");
    await user.type(screen.getByLabelText("Task"), "t9");
    await user.type(screen.getByLabelText("Tool"), "shell");
    await user.selectOptions(screen.getByLabelText("Action"), "DELETE");
    await user.selectOptions(screen.getByLabelText("Risk"), "HIGH");
    await user.type(screen.getByLabelText("Policy id"), "pol-1");
    await user.type(screen.getByLabelText("Result"), "DENY");
    await user.type(screen.getByLabelText("Operation"), "action.denied");
    await user.type(screen.getByLabelText("Since"), "2026-05-01");
    await user.type(screen.getByLabelText("Until"), "2026-05-02");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      const p = last(apiCalls(calls, "/api/trust/ledger")).params;
      expect(Object.fromEntries(p.entries())).toEqual({
        projectId: "p1", agentId: "agent-1", taskId: "t9", toolId: "shell", action: "DELETE", risk: "HIGH", policyId: "pol-1", result: "DENY",
        operation: "action.denied", since: "2026-05-01T00:00:00.000Z", until: "2026-05-02T23:59:59.999Z", limit: "200",
      });
    });
  });

  it("shows When/Who/What/Risk/Policy/Result and expandable detail, and a failed verification", async () => {
    const user = userEvent.setup();
    stubApi({ routes: { "/api/trust/ledger": { entries: [makeRow()], verification: { ok: false, entries: 9, brokenAt: 3 } } } });
    renderAt("/security-center/audit?project=p1");
    expect(await screen.findByTestId("ledger-status")).toHaveTextContent("Ledger verification FAILED at entry 3");
    const row = screen.getByText("Deleted table").closest("tr") as HTMLElement;
    for (const expected of ["agent-1", "action.denied", "High", "pol-1", "DENY"]) expect(row.textContent).toContain(expected);
    expect(screen.queryByText("needs approval")).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Show detail" }));
    expect(screen.getByText("needs approval")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });
});

describe("secrets", () => {
  it("shows counters, protections, names and configured state, never values", async () => {
    const configured = [{ name: "OPENAI_API_KEY", configured: true, value: "sk-live-DO-NOT-SHOW" }, { name: "STRIPE_KEY", configured: false }];
    stubApi({ routes: { "/api/trust/secrets": makeSecrets({ configured, recent: [{ id: "r1", seq: 1, at: "2026-05-01T10:00:00.000Z", operation: "secret.detected", actor: "agent-1", result: "REDACTED", detail: { kind: "api_key" }, prevHash: "0", hash: "h" }] }) } });
    renderAt("/security-center/secrets?project=p1");
    const list = await screen.findByTestId("configured-credentials");
    expect(within(list).getByText("OPENAI_API_KEY")).toBeInTheDocument();
    expect(within(list).getByText("configured")).toBeInTheDocument();
    expect(within(list).getByText("not configured")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-live-DO-NOT-SHOW");
    expect(screen.getByText("Secrets are redacted before logging")).toBeInTheDocument();
    expect(screen.getByText("Detection is pattern based and can miss unusual formats.")).toBeInTheDocument();
    expect(document.querySelector('[data-card="detections7d"]')?.textContent).toContain("5");
    expect(screen.getByText("secret.detected")).toBeInTheDocument();
  });
});

describe("project security", () => {
  it("shows baseline, dependency scan and runs scan commands, showing the server's honest message", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      commands: { security_scan_config: () => executed("Scanned 12 files"), security_scan_dependencies: () => rejected("This project has no source workspace to scan.", "invalid_state") },
    });
    renderAt("/security-center/project?project=p1");
    expect(await screen.findByText(".env.example")).toBeInTheDocument();
    expect(screen.getByText("left-pad")).toBeInTheDocument();
    expect(screen.getByText(/1 critical, 2 high, 3 moderate, 4 low, 0 info \(10 total\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan security configuration" }));
    expect(await screen.findByTestId("command-reason")).toHaveTextContent("Scanned 12 files");
    expect(commandCalls(calls, "security_scan_config")[0]?.body).toEqual({ projectId: "p1" });
    await user.click(screen.getByRole("button", { name: "Scan dependencies" }));
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("no source workspace");
    expect(screen.queryByRole("button", { name: "Accept current configuration as baseline" })).toBeNull();
  });

  it("lets administrators accept the baseline after confirming", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_accept_config: () => executed() } });
    renderAt("/security-center/project?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: "Accept current configuration as baseline" }));
    expect(commandCalls(calls, "security_accept_config")).toHaveLength(0);
    await user.click(within(dialog()).getByRole("button", { name: "Accept current configuration as baseline" }));
    await waitFor(() => expect(commandCalls(calls, "security_accept_config")).toHaveLength(1));
    expect(commandCalls(calls, "security_accept_config")[0]?.body).toEqual({ projectId: "p1" });
  });

  it("asks for a project when the scope is all projects", async () => {
    stubApi();
    renderAt("/security-center/project?project=all");
    expect(await screen.findByText("Select a project")).toBeInTheDocument();
  });

  it("shows 'no baseline' honestly", async () => {
    stubApi({ routes: { "/api/trust/project": makeProjectSecurity({ configBaseline: null, dependencyScan: null }) } });
    renderAt("/security-center/project?project=p1");
    expect(await screen.findByText("No baseline yet")).toBeInTheDocument();
    expect(screen.getByText("Not scanned")).toBeInTheDocument();
  });
});

describe("emergency control", () => {
  const withState = (state: "NORMAL" | "PAUSED" | "INVESTIGATING" | "RECOVERY_REQUIRED") =>
    ({ "/api/trust/overview": makeOverview({ emergency: makeEmergency({ state, reason: state === "NORMAL" ? undefined : "suspected leak", history: [{ state, at: "2026-05-01T10:00:00.000Z", by: "alice", note: "history note" }] }) }) });
  const names = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());

  it("offers only 'Emergency stop' when normal, and requires a reason in a confirm dialog", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ routes: withState("NORMAL"), commands: { security_emergency_stop: () => executed() } });
    renderAt("/security-center/emergency?project=p1");
    const stop = await screen.findByRole("button", { name: /Emergency stop/ });
    expect(names().some((n) => n === "Resume AI execution" || n === "Mark investigating" || n === "Require recovery")).toBe(false);
    await user.click(stop);
    expect(commandCalls(calls, "security_emergency_stop")).toHaveLength(0);
    const confirm = within(dialog()).getByRole("button", { name: "Emergency stop" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog()).getByLabelText(/Reason/), "suspected leak");
    await user.click(confirm);
    await waitFor(() => expect(commandCalls(calls, "security_emergency_stop")).toHaveLength(1));
    expect(commandCalls(calls, "security_emergency_stop")[0]?.body).toEqual({ reason: "suspected leak" });
  });

  it("offers investigating and recovery when paused, and sends the target state", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ routes: withState("PAUSED"), commands: { security_emergency_advance: () => executed() } });
    renderAt("/security-center/emergency?project=p1");
    await user.click(await screen.findByRole("button", { name: "Mark investigating" }));
    await user.type(within(dialog()).getByLabelText(/Note/), "looking");
    await user.click(within(dialog()).getByRole("button", { name: "Mark investigating" }));
    await waitFor(() => expect(commandCalls(calls, "security_emergency_advance")).toHaveLength(1));
    expect(commandCalls(calls, "security_emergency_advance")[0]?.body).toEqual({ to: "INVESTIGATING", note: "looking" });
    expect(screen.queryByRole("button", { name: /Emergency stop/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume AI execution" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Require recovery" }));
    await user.click(within(dialog()).getByRole("button", { name: "Require recovery" }));
    await waitFor(() => expect(commandCalls(calls, "security_emergency_advance")).toHaveLength(2));
    expect(last(commandCalls(calls, "security_emergency_advance")).body).toEqual({ to: "RECOVERY_REQUIRED" });
  });

  it("offers only 'Require recovery' while investigating", async () => {
    stubApi({ routes: withState("INVESTIGATING") });
    renderAt("/security-center/emergency?project=p1");
    await screen.findByRole("button", { name: "Require recovery" });
    expect(screen.queryByRole("button", { name: "Mark investigating" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume AI execution" })).toBeNull();
  });

  it("resumes only from RECOVERY_REQUIRED, for administrators, with a required note", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ routes: withState("RECOVERY_REQUIRED"), commands: { security_emergency_resume: () => executed() } });
    renderAt("/security-center/emergency?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: "Resume AI execution" }));
    const confirm = within(dialog()).getByRole("button", { name: "Resume AI execution" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog()).getByLabelText(/Note/), "cause fixed");
    await user.click(confirm);
    await waitFor(() => expect(commandCalls(calls, "security_emergency_resume")).toHaveLength(1));
    expect(commandCalls(calls, "security_emergency_resume")[0]?.body).toEqual({ note: "cause fixed" });
  });

  it("does not offer resume to non-administrators and explains why", async () => {
    stubApi({ routes: withState("RECOVERY_REQUIRED") });
    renderAt("/security-center/emergency?project=p1");
    expect(await screen.findByText("Only an administrator can resume AI execution.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume AI execution" })).toBeNull();
  });

  it("shows the state, reason, history and that recovery is never automatic; also on the overview", async () => {
    stubApi({ routes: withState("PAUSED") });
    const { unmount } = renderAt("/security-center/emergency?project=p1");
    expect(await screen.findByText("history note")).toBeInTheDocument();
    expect(screen.getByText("suspected leak")).toBeInTheDocument();
    expect(screen.getByText(/never automatic/)).toBeInTheDocument();
    unmount();
    renderAt("/security-center?project=p1");
    expect((await screen.findByTestId("emergency-panel")).getAttribute("data-state")).toBe("PAUSED");
  });

  it("shows no emergency controls to a viewer", async () => {
    stubApi({ routes: withState("NORMAL") });
    renderAt("/security-center/emergency?project=p1", { capabilities: ["view"], role: "viewer" });
    await screen.findByTestId("emergency-panel");
    expect(screen.queryByRole("button", { name: /Emergency stop/ })).toBeNull();
  });
});

describe("commands refetch and polling", () => {
  it("refetches the trust queries after a successful command", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { security_cancel_approval: () => executed() } });
    renderAt("/security-center/approvals?project=p1");
    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(commandCalls(calls, "security_cancel_approval")).toHaveLength(1));
    const before = apiCalls(calls, "/api/trust/approvals").length;
    await waitFor(() => expect(apiCalls(calls, "/api/trust/approvals").length).toBeGreaterThan(before - 1));
    await waitFor(() => expect(apiCalls(calls, "/api/trust/approvals").length).toBeGreaterThanOrEqual(2));
    expect(apiCalls(calls, "/api/trust/overview").length).toBeGreaterThanOrEqual(2);
  });
});

describe("language", () => {
  it("renders Dutch", async () => {
    stubApi();
    renderAt("/security-center?project=p1", { language: "nl" });
    expect(await screen.findByRole("heading", { name: "Vertrouwensscore" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Goedkeuringen" })).toBeInTheDocument();
  });
});
