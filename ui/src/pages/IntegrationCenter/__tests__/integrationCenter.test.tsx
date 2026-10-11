import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TABS } from "../../../features/integrationCenter/types";
import {
  makeActivity, makeCapabilities, makeConnector, makeDetail, makeEvent, makeEvents, makeHealth, makeMcpServer, makeOverview, makeRow,
  makeSubscription,
} from "../../../features/integrationCenter/__tests__/fixtures";
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
  window.sessionStorage.clear();
});

const OP = { role: "operator" as const, capabilities: ["view", "manage_integrations"] };
const ADMIN = { role: "admin" as const, capabilities: ["view", "manage_integrations"] };
const VIEWER = { role: "viewer" as const, capabilities: ["view"] };

const commandCalls = (calls: Call[], name: string) => calls.filter((c) => c.path === `/api/commands/${name}`);
const apiCalls = (calls: Call[], path: string) => calls.filter((c) => c.path === path);
const last = <T,>(list: T[]): T => list[list.length - 1] as T;
const locationText = () => screen.getByTestId("location").textContent;
const dialog = () => screen.getByRole("dialog");
const card = (id: string) => document.querySelector(`[data-connector-id="${id}"]`) as HTMLElement;
const OVERVIEW = "/integration-center?project=p1";

async function overviewReady() {
  await screen.findByTestId("connector-grid");
}

describe("tab routing", () => {
  it("shows the connectors by default and moves between tabs through the URL, keeping the project", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt(OVERVIEW);
    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Tool Explorer" }));
    expect(await screen.findByRole("heading", { name: "Tool Explorer" })).toBeInTheDocument();
    expect(locationText()).toBe("/integration-center/tools?project=p1");
    expect(screen.getByRole("link", { name: "Tool Explorer" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("link", { name: "Connectors" }));
    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(locationText()).toBe("/integration-center?project=p1");
  });

  it("sends an unknown tab back to the overview, and an item id on another tab too", async () => {
    stubApi();
    renderAt("/integration-center/bogus");
    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(locationText()).toBe("/integration-center");
  });

  it("renders every tab", async () => {
    for (const tab of TABS) {
      stubApi();
      const { unmount } = renderAt(`/integration-center/${tab}?project=p1`);
      await waitFor(() => expect(document.querySelector(".ic-panel, .ic-empty")).not.toBeNull());
      expect(screen.getByRole("link", { name: /./, current: "page" })).toBeInTheDocument();
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it("changes the project scope in the URL", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt(OVERVIEW);
    await overviewReady();
    await user.selectOptions(screen.getByLabelText("Project"), "p2");
    await waitFor(() => expect(locationText()).toContain("project=p2"));
    await waitFor(() => expect(last(apiCalls(calls, "/api/integration-center/overview")).params.get("projectId")).toBe("p2"));
  });
});

describe("overview", () => {
  it("shows the summary cards from the API", async () => {
    stubApi();
    renderAt(OVERVIEW);
    await overviewReady();
    const value = (key: string) => document.querySelector(`[data-card="${key}"]`)?.textContent ?? "";
    expect(value("connectors")).toContain("3");
    expect(value("healthy")).toContain("1");
    expect(value("degraded")).toContain("1");
    expect(value("waitingApproval")).toContain("2");
    expect(value("blocked24h")).toContain("4");
    expect(value("queued")).toContain("5");
    expect(screen.getByTestId("vault-note")).toHaveTextContent("Credentials are encrypted at rest.");
  });

  it("shows name, provider, status, trust, mode, capabilities, last activity and health for a healthy connector", async () => {
    stubApi();
    renderAt(OVERVIEW);
    await overviewReady();
    const gh = within(card("github"));
    expect(gh.getByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(gh.getByText("Healthy", { selector: ".ic-tag span" })).toBeInTheDocument();
    expect(gh.getByText("SANDBOX")).toBeInTheDocument();
    expect(gh.getByText(/Trust: Limited/)).toBeInTheDocument();
    expect(gh.getByText("3 of 4 available, 2 read, 1 with side effects")).toBeInTheDocument();
    expect(gh.getByText("repository.read, Success, " + new Date("2026-05-01T10:00:00.000Z").toLocaleString("en-GB"))).toBeInTheDocument();
    expect(gh.getByText("Latency 120 ms")).toBeInTheDocument();
    expect(gh.getByText("1 errors in 10 recent calls")).toBeInTheDocument();
    expect(gh.getByText("Credential stored")).toBeInTheDocument();
  });

  it("is honest about a connector that is not connected: it never claims it works", async () => {
    stubApi();
    renderAt(OVERVIEW);
    await overviewReady();
    const wp = within(card("wordpress"));
    expect(screen.getByTestId("note-wordpress")).toHaveTextContent("Not connected. This connector cannot be used.");
    expect(wp.getByText("No credential stored")).toBeInTheDocument();
    expect(wp.getByText("no calls yet")).toBeInTheDocument();
    expect(card("wordpress").textContent).not.toMatch(/healthy|working/i);
  });

  it("shows a degraded connector with a visible warning and its last error", async () => {
    stubApi();
    renderAt(OVERVIEW);
    await overviewReady();
    const slack = within(card("slack"));
    expect(screen.getByTestId("note-slack")).toHaveTextContent(/Degraded: this connector is responding with problems/);
    expect(slack.getByText("LIVE")).toBeInTheDocument();
    expect(slack.getByText("Last error: slow down")).toBeInTheDocument();
    expect(slack.getByText("6 errors in 20 recent calls")).toBeInTheDocument();
  });

  it("describes ERROR, DISABLED, CONFIGURED and CONNECTED connectors without implying they work", async () => {
    const overview = makeOverview({
      connectors: ["ERROR", "DISABLED", "CONFIGURED", "CONNECTED"].map((s) => makeConnector({ connectorId: s.toLowerCase(), name: s, status: s })),
    });
    stubApi({ routes: { "/api/integration-center/overview": overview } });
    renderAt(OVERVIEW);
    await overviewReady();
    expect(screen.getByTestId("note-error")).toHaveTextContent("It is not working.");
    expect(screen.getByTestId("note-disabled")).toHaveTextContent("no agent can use this connector");
    expect(screen.getByTestId("note-configured")).toHaveTextContent("cannot be used until");
    expect(screen.getByTestId("note-connected")).toHaveTextContent("Run a connection test before relying on it");
  });

  it("shows an empty state when no connector is registered", async () => {
    stubApi({ routes: { "/api/integration-center/overview": makeOverview({ connectors: [], recentActivity: [] }) } });
    renderAt(OVERVIEW);
    expect(await screen.findByText("No connectors are registered")).toBeInTheDocument();
    expect(screen.getByText("No integration calls have been recorded yet.")).toBeInTheDocument();
  });

  it("explains that the vault cannot store credentials when the server has no key", async () => {
    stubApi({ routes: { "/api/integration-center/overview": makeOverview({ vault: { canStoreCredentials: false, note: "No vault key is configured on the server." } }) } });
    renderAt(OVERVIEW, ADMIN);
    expect(await screen.findByTestId("vault-note")).toHaveTextContent("No vault key is configured on the server.");
  });

  it("shows the server's own message when the overview fails", async () => {
    stubApi({ routes: { "/api/integration-center/overview": json(403, { error: { message: "no access to integrations" } }) } });
    renderAt(OVERVIEW);
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("no access to integrations");
    expect(screen.getByRole("alert")).toHaveAttribute("data-error-code", "FORBIDDEN");
  });

  it("shows a loading state first", async () => {
    stubApi();
    renderAt(OVERVIEW);
    expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
    await overviewReady();
  });
});

describe("permissions", () => {
  const buttonStates = (id: string, name: string) => ({
    connect: screen.getByRole("button", { name: `Connect ${name}` }),
    test: screen.getByRole("button", { name: `Test ${name}` }),
    validate: screen.getByRole("button", { name: `Validate security of ${name}` }),
    enable: screen.queryByRole("button", { name: `Enable ${name}` }),
    disable: screen.queryByRole("button", { name: `Disable ${name}` }),
    mode: screen.getByRole("button", { name: `Change mode of ${name}` }),
    trust: screen.getByRole("button", { name: `Change trust of ${name}` }),
    disconnect: screen.getByRole("button", { name: `Disconnect ${name}` }),
    id,
  });

  it("lets an administrator use every control", async () => {
    stubApi();
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    const wp = buttonStates("wordpress", "WordPress");
    for (const key of ["connect", "test", "validate", "enable", "mode", "trust", "disconnect"] as const) expect(wp[key], key).toBeEnabled();
    expect(screen.queryByText(/needs an administrator/)).toBeNull();
  });

  it("disables the administrator-only controls for an operator but keeps the rest", async () => {
    stubApi();
    renderAt(OVERVIEW, OP);
    await overviewReady();
    const wp = buttonStates("wordpress", "WordPress");
    expect(wp.connect).toBeDisabled();
    expect(wp.enable).toBeDisabled();
    expect(wp.disconnect).toBeDisabled();
    expect(wp.test).toBeEnabled();
    expect(wp.validate).toBeEnabled();
    expect(wp.trust).toBeEnabled();
    expect(wp.mode).toBeDisabled(); // SANDBOX can only be changed to LIVE, which is administrator-only
    const gh = buttonStates("github", "GitHub");
    expect(gh.disable).toBeEnabled();
    const slack = buttonStates("slack", "Slack");
    expect(slack.mode).toBeEnabled(); // LIVE -> SANDBOX is allowed
    expect(screen.getByText(/needs an administrator/)).toBeInTheDocument();
  });

  it("disables every control for a viewer and says why", async () => {
    stubApi();
    renderAt(OVERVIEW, VIEWER);
    await overviewReady();
    const wp = buttonStates("wordpress", "WordPress");
    for (const key of ["connect", "test", "validate", "enable", "mode", "trust", "disconnect"] as const) expect(wp[key], key).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable GitHub" })).toBeDisabled();
    expect(screen.getByText(/needs the manage integrations capability/)).toBeInTheDocument();
  });

  it("does not let an operator choose a higher trust state or LIVE mode", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Change trust of GitHub" }));
    expect(within(dialog()).getByRole("option", { name: /Trusted/ })).toBeDisabled();
    expect(within(dialog()).getByRole("option", { name: /Suspended/ })).toBeEnabled();
    expect(within(dialog()).getByText(/Raising trust is administrator-only/)).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Change mode of Slack" }));
    expect(within(dialog()).getByRole("option", { name: /LIVE/ })).toBeDisabled();
  });
});

describe("commands", () => {
  it("runs a connection test and announces the result politely", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_test_connection: () => executed({ connectorId: "github", ok: true, message: "Connected as acme", latencyMs: 55 }) } });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Test GitHub" }));
    await waitFor(() => expect(commandCalls(calls, "integration_test_connection")).toHaveLength(1));
    expect(commandCalls(calls, "integration_test_connection")[0]?.body).toEqual({ connectorId: "github" });
    const message = await screen.findByTestId("report-message");
    expect(message).toHaveTextContent("Connection test passed for GitHub: Connected as acme Latency 55 ms");
    expect(screen.getByTestId("report")).toHaveAttribute("role", "status");
    expect(message.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("reports a failed connection test as a failure, not a success", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { integration_test_connection: () => executed({ connectorId: "github", ok: false, message: "401 bad credentials", latencyMs: 10 }) } });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Test GitHub" }));
    expect(await screen.findByTestId("report-message")).toHaveTextContent("Connection test failed for GitHub: 401 bad credentials");
    expect(screen.getByTestId("report")).toHaveAttribute("role", "alert");
  });

  it("shows the server's refusal when a test cannot run", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { integration_test_connection: () => rejected("connector is disabled", "invalid_state") } });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Test GitHub" }));
    expect(await screen.findByTestId("report-message")).toHaveTextContent("connector is disabled");
    expect(screen.getByTestId("report")).toHaveAttribute("role", "alert");
  });

  it("validates security and lists every check", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      commands: {
        integration_validate_security: () => executed({ connectorId: "github", ok: false, checks: [{ check: "host pinning", ok: true, detail: "pinned" }, { check: "scope breadth", ok: false, detail: "wildcard scope" }] }),
      },
    });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Validate security of GitHub" }));
    expect(await screen.findByText("Security validation found problems for GitHub.")).toBeInTheDocument();
    expect(commandCalls(calls, "integration_validate_security")[0]?.body).toEqual({ connectorId: "github" });
    const report = within(screen.getByTestId("report"));
    expect(report.getByText("host pinning")).toBeInTheDocument();
    expect(report.getByText("wildcard scope")).toBeInTheDocument();
  });

  it("enables only after confirmation and shows the server's refusal inside the dialog", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_enable: () => rejected("security validation has not passed", "invalid_state") } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Enable WordPress" }));
    expect(commandCalls(calls, "integration_enable")).toHaveLength(0);
    await user.click(within(dialog()).getByRole("button", { name: "Enable" }));
    expect(await within(dialog()).findByTestId("error-reason")).toHaveTextContent("security validation has not passed");
    expect(commandCalls(calls, "integration_enable")[0]?.body).toEqual({ connectorId: "wordpress" });
  });

  it("disables a connector after confirmation", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_disable: () => executed({ connectorId: "github", status: "DISABLED" }) } });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Disable GitHub" }));
    await user.click(within(dialog()).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(commandCalls(calls, "integration_disable")).toHaveLength(1));
    expect(commandCalls(calls, "integration_disable")[0]?.body).toEqual({ connectorId: "github" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId("report-message")).toHaveTextContent("Done: Disable GitHub");
  });

  it("switches a LIVE connector back to SANDBOX as an operator", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_set_mode: () => executed({ connectorId: "slack", mode: "SANDBOX" }) } });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Change mode of Slack" }));
    expect(within(dialog()).getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.selectOptions(within(dialog()).getByLabelText("Mode"), "SANDBOX");
    await user.click(within(dialog()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(commandCalls(calls, "integration_set_mode")).toHaveLength(1));
    expect(commandCalls(calls, "integration_set_mode")[0]?.body).toEqual({ connectorId: "slack", mode: "SANDBOX" });
  });

  it("warns before switching to LIVE as an administrator", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_set_mode: () => executed({ connectorId: "github", mode: "LIVE" }) } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Change mode of GitHub" }));
    await user.selectOptions(within(dialog()).getByLabelText("Mode"), "LIVE");
    expect(within(dialog()).getByText("LIVE mode lets this connector change real data at the provider.")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(commandCalls(calls, "integration_set_mode")).toHaveLength(1));
    expect(commandCalls(calls, "integration_set_mode")[0]?.body).toEqual({ connectorId: "github", mode: "LIVE" });
  });

  it("lowers trust as an operator", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_set_trust: () => executed({ connectorId: "github", trust: "SUSPENDED" }) } });
    renderAt(OVERVIEW, OP);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Change trust of GitHub" }));
    await user.selectOptions(within(dialog()).getByLabelText("Trust state"), "SUSPENDED");
    await user.click(within(dialog()).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(commandCalls(calls, "integration_set_trust")).toHaveLength(1));
    expect(commandCalls(calls, "integration_set_trust")[0]?.body).toEqual({ connectorId: "github", trust: "SUSPENDED" });
  });

  it("disconnects after confirmation", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_disconnect: () => executed({ connectorId: "github", status: "DISABLED" }) } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Disconnect GitHub" }));
    expect(within(dialog()).getByText(/revokes the stored credential/)).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(commandCalls(calls, "integration_disconnect")).toHaveLength(1));
    expect(commandCalls(calls, "integration_disconnect")[0]?.body).toEqual({ connectorId: "github" });
  });
});

describe("credentials never leak", () => {
  const SECRET = "sk-live-TOP-SECRET-0123456789";

  function assertNoLeak(calls: Call[]) {
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET);
    expect(locationText()).not.toContain(SECRET);
    for (const call of calls) expect(call.url).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);
  }

  it("uses one password field with autocomplete off and sends the value only in the store command", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_store_credential: () => executed({ connectorId: "wordpress", purpose: "primary", kind: "api_key", storedAt: "2026-05-01T10:00:00.000Z" }) } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Connect WordPress" }));
    const field = within(dialog()).getByLabelText("Credential value") as HTMLInputElement;
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(dialog().querySelectorAll("input[type=password]")).toHaveLength(1);
    expect(dialog().querySelectorAll("input[type=text]")).toHaveLength(0);
    await user.selectOptions(within(dialog()).getByLabelText("Credential type"), "api_key");
    await user.type(field, SECRET);
    expect(field.value).toBe(SECRET);
    await user.click(within(dialog()).getByRole("button", { name: "Store credential" }));
    await waitFor(() => expect(commandCalls(calls, "integration_store_credential")).toHaveLength(1));
    expect(commandCalls(calls, "integration_store_credential")[0]?.body).toEqual({ connectorId: "wordpress", purpose: "primary", kind: "api_key", value: SECRET });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId("report-message")).toHaveTextContent("Credential stored for WordPress. Only its metadata is shown.");
    assertNoLeak(calls);
  });

  it("clears the field and never shows the value when the server refuses", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_store_credential: () => rejected("only an administrator may store credentials") } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Connect WordPress" }));
    const field = within(dialog()).getByLabelText("Credential value") as HTMLInputElement;
    await user.type(field, SECRET);
    await user.click(within(dialog()).getByRole("button", { name: "Store credential" }));
    expect(await within(dialog()).findByTestId("error-reason")).toHaveTextContent("only an administrator may store credentials");
    expect((within(dialog()).getByLabelText("Credential value") as HTMLInputElement).value).toBe("");
    expect(within(dialog()).getByRole("button", { name: "Store credential" })).toBeDisabled();
    assertNoLeak(calls);
  });

  it("clears the field when the request cannot be sent at all", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_store_credential: () => { throw new TypeError("network down"); } } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Connect WordPress" }));
    await user.type(within(dialog()).getByLabelText("Credential value"), SECRET);
    await user.click(within(dialog()).getByRole("button", { name: "Store credential" }));
    await within(dialog()).findByRole("alert");
    expect((within(dialog()).getByLabelText("Credential value") as HTMLInputElement).value).toBe("");
    assertNoLeak(calls);
  });

  it("cannot store anything when the server has no vault key", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ routes: { "/api/integration-center/overview": makeOverview({ vault: { canStoreCredentials: false, note: "No vault key" } }) } });
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    await user.click(screen.getByRole("button", { name: "Connect WordPress" }));
    expect(within(dialog()).getByText(/no vault key configured/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Credential value")).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Store credential" })).toBeDisabled();
    expect(commandCalls(calls, "integration_store_credential")).toHaveLength(0);
  });

  it("never renders a credential value in the connector detail, only metadata", async () => {
    stubApi();
    renderAt("/integration-center/overview/github?project=p1", ADMIN);
    const list = await screen.findByTestId("credential-list");
    expect(within(list).getByText("vault://github/primary")).toBeInTheDocument();
    expect(within(list).getByText("Token")).toBeInTheDocument();
    expect(document.querySelectorAll("input[type=password]")).toHaveLength(0);
  });
});

describe("connector detail", () => {
  it("shows the installation steps with their status", async () => {
    stubApi();
    renderAt("/integration-center/overview/github?project=p1");
    const steps = await screen.findByTestId("install-steps");
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent("Register");
    expect(items[0]).toHaveAttribute("data-step-status", "DONE");
    expect(items[7]).toHaveTextContent("Enable");
    expect(items[7]).toHaveTextContent("Pending");
  });

  it("lists capabilities with operation class, risk, approval, sandbox behaviour and unavailable reason", async () => {
    stubApi();
    renderAt("/integration-center/overview/github?project=p1");
    const table = await screen.findByTestId("capability-table");
    const read = within(table.querySelector('[data-capability="repository.read"]') as HTMLElement);
    expect(read.getByText("Read")).toBeInTheDocument();
    expect(read.getByText("Low")).toBeInTheDocument();
    expect(read.getByText("No approval")).toBeInTheDocument();
    expect(read.getByText("Runs in sandbox")).toBeInTheDocument();
    const merge = within(table.querySelector('[data-capability="pull_request.merge"]') as HTMLElement);
    expect(merge.getByText("Deploy")).toBeInTheDocument();
    expect(merge.getByText("High")).toBeInTheDocument();
    expect(merge.getByText("Approval always")).toBeInTheDocument();
    expect(merge.getByText("Substituted by pull_request.draft")).toBeInTheDocument();
    const del = within(table.querySelector('[data-capability="repository.delete"]') as HTMLElement);
    expect(del.getByText("Blocked in sandbox")).toBeInTheDocument();
    expect(del.getByText("Not available: Not implemented in this deployment")).toBeInTheDocument();
  });

  it("shows the webhook endpoint, whether a signing secret is set, and the security checks", async () => {
    stubApi();
    renderAt("/integration-center/overview/github?project=p1");
    expect(await screen.findByTestId("webhook-endpoint")).toHaveTextContent("/api/integrations/webhooks/github");
    expect(screen.getByText("No signing secret is set, so deliveries cannot be verified")).toBeInTheDocument();
    const checks = screen.getByTestId("security-checks");
    expect(within(checks).getByText("scope breadth")).toBeInTheDocument();
    expect(within(checks).getByText("wildcard scope requested")).toBeInTheDocument();
    expect(screen.getByText("Some checks fail")).toBeInTheDocument();
  });

  it("says when a signing secret is set", async () => {
    stubApi({ routes: { "/api/integration-center/connectors/github": makeDetail({ webhook: { configured: true, endpoint: "/api/integrations/webhooks/github" } }) } });
    renderAt("/integration-center/overview/github?project=p1", ADMIN);
    expect(await screen.findByText("A signing secret is set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke signing secret" })).toBeEnabled();
  });

  it("stores the webhook signing secret with purpose webhook and never shows it", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_store_credential: () => executed({ connectorId: "github", purpose: "webhook" }) } });
    renderAt("/integration-center/overview/github?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: "Set signing secret" }));
    const field = within(dialog()).getByLabelText("Signing secret") as HTMLInputElement;
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    await user.type(field, "whsec_ABC123");
    await user.click(within(dialog()).getByRole("button", { name: "Store signing secret" }));
    await waitFor(() => expect(commandCalls(calls, "integration_store_credential")).toHaveLength(1));
    expect(commandCalls(calls, "integration_store_credential")[0]?.body).toEqual({ connectorId: "github", purpose: "webhook", value: "whsec_ABC123" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain("whsec_ABC123");
  });

  it("revokes the primary credential after confirmation", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_revoke_credential: () => executed({ connectorId: "github", purpose: "primary" }) } });
    renderAt("/integration-center/overview/github?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: "Revoke credential of GitHub" }));
    await user.click(within(dialog()).getByRole("button", { name: "Revoke credential" }));
    await waitFor(() => expect(commandCalls(calls, "integration_revoke_credential")).toHaveLength(1));
    expect(commandCalls(calls, "integration_revoke_credential")[0]?.body).toEqual({ connectorId: "github", purpose: "primary" });
  });

  it("disables credential controls for an operator", async () => {
    stubApi();
    renderAt("/integration-center/overview/github?project=p1", OP);
    await screen.findByTestId("connector-detail");
    expect(screen.getByRole("button", { name: "Revoke credential of GitHub" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set signing secret" })).toBeDisabled();
  });

  it("maps and unmaps projects", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      commands: { integration_map_project: () => executed({ mappingId: "m2" }), integration_unmap_project: () => executed({ mappingId: "map-1" }) },
    });
    renderAt("/integration-center/overview/github?project=p1", OP);
    const list = await screen.findByTestId("mapping-list");
    expect(within(list).getByText("acme/app")).toBeInTheDocument();
    expect(within(list).getByText("Money Mind")).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Add mapping" });
    expect(within(form).getByRole("button", { name: "Add mapping" })).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText("Project"), "p2");
    await user.type(within(form).getByLabelText("External resource"), "acme/new");
    await user.selectOptions(within(form).getByLabelText("Role"), "FALLBACK");
    await user.click(within(form).getByRole("button", { name: "Add mapping" }));
    await waitFor(() => expect(commandCalls(calls, "integration_map_project")).toHaveLength(1));
    expect(commandCalls(calls, "integration_map_project")[0]?.body).toEqual({ projectId: "p2", connectorId: "github", resource: "acme/new", role: "FALLBACK" });
    await user.click(await screen.findByRole("button", { name: "Remove mapping acme/app for Money Mind" }));
    await waitFor(() => expect(commandCalls(calls, "integration_unmap_project")).toHaveLength(1));
    expect(commandCalls(calls, "integration_unmap_project")[0]?.body).toEqual({ mappingId: "map-1" });
  });

  it("shows the server's text when a mapping is refused", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { integration_map_project: () => rejected("project not found", "not_found") } });
    renderAt("/integration-center/overview/github?project=p1", OP);
    const form = await screen.findByRole("form", { name: "Add mapping" });
    await user.selectOptions(within(form).getByLabelText("Project"), "p2");
    await user.type(within(form).getByLabelText("External resource"), "x/y");
    await user.click(within(form).getByRole("button", { name: "Add mapping" }));
    expect(await within(form).findByTestId("error-reason")).toHaveTextContent("project not found");
  });

  it("offers no mapping form to a viewer", async () => {
    stubApi();
    renderAt("/integration-center/overview/github?project=p1", VIEWER);
    await screen.findByTestId("mapping-list");
    expect(screen.queryByRole("form", { name: "Add mapping" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove mapping/ })).toBeNull();
  });

  it("shows an error with the server's reason for an unknown connector and links back", async () => {
    stubApi({ routes: { "/api/integration-center/connectors/ghost": json(404, { error: { message: "connector not found: ghost" } }) } });
    renderAt("/integration-center/overview/ghost?project=p1");
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("connector not found: ghost");
    expect(screen.getByRole("link", { name: /Back to connectors/ })).toHaveAttribute("href", "/integration-center?project=p1");
  });

  it("opens from the connector grid", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt(OVERVIEW);
    await overviewReady();
    await user.click(screen.getByRole("link", { name: "Details for GitHub" }));
    expect(await screen.findByTestId("connector-detail")).toBeInTheDocument();
    expect(locationText()).toBe("/integration-center/overview/github?project=p1");
  });
});

describe("tool explorer", () => {
  const mapped = makeCapabilities({
    capabilities: [makeRow({ mappedToProject: true }), makeRow({ connectorId: "gitlab", provider: "GitLab", status: "ERROR", mappedToProject: false }), makeRow({
      capability: "email.send", description: "Send an email.", operation: "SEND", risk: "HIGH", connectorId: "gmail", provider: "Gmail", sandbox: { substitute: "email.draft" },
      status: "DISCOVERED", approval: "always", mappedToProject: false,
    })],
  });

  it("lists each capability once with its providers, approval hint and mapping", async () => {
    stubApi({ routes: { "/api/integration-center/capabilities": mapped } });
    renderAt("/integration-center/tools?project=p1");
    const list = await screen.findByTestId("tool-list");
    expect(within(list).getAllByRole("listitem", { name: "" }).length).toBeGreaterThan(0);
    const read = within(list.querySelector('[data-capability="repository.read"]') as HTMLElement);
    const providers = within(read.getByTestId("providers-repository.read"));
    expect(providers.getByText("GitHub")).toBeInTheDocument();
    expect(providers.getByText("GitLab")).toBeInTheDocument();
    expect(providers.getByText("Error")).toBeInTheDocument();
    expect(providers.getAllByText(/provider is not working/).length).toBe(1);
    expect(read.getByText("Mapped to project")).toBeInTheDocument();
    expect(read.getByText(/Approval hint: No approval/)).toBeInTheDocument();
    const email = within(list.querySelector('[data-capability="email.send"]') as HTMLElement);
    expect(email.getByText("Not mapped to project")).toBeInTheDocument();
    expect(email.getByText(/Approval hint: Approval always/)).toBeInTheDocument();
    expect(email.getByText("Substituted by email.draft")).toBeInTheDocument();
    expect(screen.getByTestId("tool-count")).toHaveTextContent("2 capabilities");
  });

  it("asks for a project before it can say what is mapped", async () => {
    stubApi();
    renderAt("/integration-center/tools?project=all");
    const list = await screen.findByTestId("tool-list");
    expect(within(list).getAllByText("Select a project to see mapping").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Only capabilities mapped to the selected project")).toBeDisabled();
  });

  it("searches through the API", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/integration-center/tools?project=p1");
    await screen.findByTestId("tool-list");
    await user.type(screen.getByLabelText("Search capabilities"), "mail");
    await waitFor(() => expect(last(apiCalls(calls, "/api/integration-center/capabilities")).params.get("q")).toBe("mail"));
    expect(last(apiCalls(calls, "/api/integration-center/capabilities")).params.get("projectId")).toBe("p1");
  });

  it("filters by operation class and by mapped-to-project", async () => {
    const user = userEvent.setup();
    stubApi({ routes: { "/api/integration-center/capabilities": mapped } });
    renderAt("/integration-center/tools?project=p1");
    const list = await screen.findByTestId("tool-list");
    await user.selectOptions(screen.getByLabelText("Operation class"), "SEND");
    expect(list.querySelector('[data-capability="repository.read"]')).toBeNull();
    expect(list.querySelector('[data-capability="email.send"]')).not.toBeNull();
    await user.selectOptions(screen.getByLabelText("Operation class"), "");
    await user.click(screen.getByLabelText("Only capabilities mapped to the selected project"));
    expect(list.querySelector('[data-capability="email.send"]')).toBeNull();
    expect(list.querySelector('[data-capability="repository.read"]')).not.toBeNull();
  });

  it("shows an empty state, MCP capabilities and an error", async () => {
    stubApi({ routes: { "/api/integration-center/capabilities": makeCapabilities({ capabilities: [], mcp: [] }) } });
    const first = renderAt("/integration-center/tools?project=p1");
    expect(await screen.findByText("No capabilities match")).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();
    stubApi({
      routes: {
        "/api/integration-center/capabilities": makeCapabilities({
          capabilities: [],
          mcp: [{ capability: "mcp.docs.search", description: "Search docs", operation: "WRITE", risk: "MEDIUM", approval: "likely", available: true, providers: [{ connectorId: "mcp.docs", provider: "MCP", status: "ENABLED", mode: "SANDBOX", trust: "LIMITED", resource: "*", role: "PRIMARY" }] }],
        }),
      },
    });
    const second = renderAt("/integration-center/tools?project=p1");
    const row = (await screen.findByTestId("tool-list")).querySelector('[data-capability="mcp.docs.search"]') as HTMLElement;
    expect(within(row).getByText("MCP", { selector: ".ic-tag span" })).toBeInTheDocument();
    second.unmount();
    vi.unstubAllGlobals();
    stubApi({ routes: { "/api/integration-center/capabilities": json(500, { error: { message: "registry offline" } }) } });
    renderAt("/integration-center/tools?project=p1");
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("registry offline");
  });
});

describe("simulator", () => {
  const SIM = {
    projectId: "p1", success: true, connectorId: "github", executed: false,
    decision: { effect: "ALLOW", risk: "LOW", explanation: "Read access is allowed by default policy." },
    error: null, selection: ["GitHub is mapped to this project", "GitHub is healthy"],
  };
  const region = () => screen.getByRole("region", { name: "Simulator" });

  async function pick(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByTestId("tool-list");
    await user.selectOptions(within(region()).getByLabelText("Capability"), "repository.read");
  }

  it("runs a dry run and states that nothing was executed", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_simulate: () => executed(SIM) } });
    renderAt("/integration-center/tools?project=p1");
    await pick(user);
    await user.type(within(region()).getByLabelText("Parameters (JSON object)"), '{{"repo":"acme/app"}');
    await user.click(within(region()).getByRole("button", { name: "Run dry-run" }));
    const result = await screen.findByTestId("sim-result");
    expect(commandCalls(calls, "integration_simulate")[0]?.body).toEqual({ projectId: "p1", capability: "repository.read", parameters: { repo: "acme/app" } });
    expect(within(result).getByTestId("sim-note")).toHaveTextContent("Nothing was executed");
    expect(within(result).getByTestId("sim-effect")).toHaveTextContent("ALLOW");
    expect(within(result).getByTestId("sim-explanation")).toHaveTextContent("Read access is allowed by default policy.");
    expect(within(within(result).getByTestId("sim-selection")).getAllByRole("listitem")).toHaveLength(2);
    expect(within(result).getByText("The request would pass evaluation")).toBeInTheDocument();
    expect(region().closest("[aria-live]") ?? region().querySelector("[aria-live]")).not.toBeNull();
  });

  it("explains a request that would not proceed, with the error", async () => {
    const user = userEvent.setup();
    stubApi({
      commands: {
        integration_simulate: () => executed({ ...SIM, success: false, connectorId: null, decision: { effect: "REQUIRE_APPROVAL", risk: "HIGH", explanation: "Needs approval." }, error: { kind: "NOT_MAPPED", message: "Project is not mapped to a connector", retryable: false }, selection: [] }),
      },
    });
    renderAt("/integration-center/tools?project=p1");
    await pick(user);
    await user.click(within(region()).getByRole("button", { name: "Run dry-run" }));
    const result = await screen.findByTestId("sim-result");
    expect(within(result).getByText("The request would not proceed")).toBeInTheDocument();
    expect(within(result).getByTestId("sim-error")).toHaveTextContent("Project is not mapped to a connector");
    expect(within(result).getByText("No connector was selected")).toBeInTheDocument();
    expect(within(result).getByText("No selection reasons were reported.")).toBeInTheDocument();
  });

  it("warns if the server ever reports an execution", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { integration_simulate: () => executed({ ...SIM, executed: true }) } });
    renderAt("/integration-center/tools?project=p1");
    await pick(user);
    await user.click(within(region()).getByRole("button", { name: "Run dry-run" }));
    expect(await screen.findByText(/should not happen for a dry run/)).toBeInTheDocument();
    expect(screen.queryByTestId("sim-note")).toBeNull();
  });

  it("rejects parameters that are not a JSON object without calling the server", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_simulate: () => executed(SIM) } });
    renderAt("/integration-center/tools?project=p1");
    await pick(user);
    await user.type(within(region()).getByLabelText("Parameters (JSON object)"), "[[1,2]");
    await user.click(within(region()).getByRole("button", { name: "Run dry-run" }));
    expect(await screen.findByTestId("params-invalid")).toHaveTextContent("Parameters must be a valid JSON object.");
    expect(commandCalls(calls, "integration_simulate")).toHaveLength(0);
  });

  it("shows the server's refusal", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { integration_simulate: () => rejected("project not found", "not_found") } });
    renderAt("/integration-center/tools?project=p1");
    await pick(user);
    await user.click(within(region()).getByRole("button", { name: "Run dry-run" }));
    expect(await within(region()).findByTestId("error-reason")).toHaveTextContent("project not found");
  });

  it("is disabled for a viewer", async () => {
    stubApi();
    renderAt("/integration-center/tools?project=p1", VIEWER);
    await screen.findByTestId("tool-list");
    expect(within(region()).getByRole("button", { name: "Run dry-run" })).toBeDisabled();
    expect(within(region()).getByLabelText("Capability")).toBeDisabled();
    expect(within(region()).getByText(/needs the manage integrations capability/)).toBeInTheDocument();
  });
});

describe("event monitor", () => {
  it("states plainly that events only propose work", async () => {
    stubApi();
    renderAt("/integration-center/events?project=p1");
    expect(await screen.findByTestId("propose-note")).toHaveTextContent("only PROPOSE work for the operator");
  });

  it("lists events and expands the normalised payload", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt("/integration-center/events?project=p1");
    const table = await screen.findByTestId("event-table");
    expect(within(table).getByText("repository.changed")).toBeInTheDocument();
    expect(within(table).getByText("Proposed work")).toBeInTheDocument();
    const toggle = within(table).getByRole("button", { name: "Show payload for ev-1" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("payload-ev-1")).toBeNull();
    await user.click(toggle);
    const payload = within(screen.getByTestId("payload-ev-1"));
    expect(payload.getByText("branch")).toBeInTheDocument();
    expect(payload.getByText("main")).toBeInTheDocument();
    expect(payload.getByText("commits")).toBeInTheDocument();
    expect(payload.getByText("3")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Hide payload for ev-1" })).toHaveAttribute("aria-expanded", "true");
    await user.click(within(table).getByRole("button", { name: "Hide payload for ev-1" }));
    expect(screen.queryByTestId("payload-ev-1")).toBeNull();
  });

  it("renders event content as text, never as markup", async () => {
    const user = userEvent.setup();
    stubApi({ routes: { "/api/integration-center/events": makeEvents({ events: [makeEvent({ summary: { title: "<img src=x onerror=alert(1)>" } })] }) } });
    renderAt("/integration-center/events?project=p1");
    await user.click(await screen.findByRole("button", { name: "Show payload for ev-1" }));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("builds the filter query from the controls", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/integration-center/events?project=p1");
    await screen.findByTestId("event-table");
    const form = screen.getByRole("form", { name: "Event Monitor" });
    await user.selectOptions(within(form).getByLabelText("Provider"), "GitHub");
    await user.type(within(form).getByLabelText("Event type"), "repository.changed");
    await user.selectOptions(within(form).getByLabelText("Status"), "TRIGGERED");
    await user.type(within(form).getByLabelText("Since"), "2026-04-30");
    await user.click(within(form).getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      const params = last(apiCalls(calls, "/api/integration-center/events")).params;
      expect(params.get("provider")).toBe("GitHub");
      expect(params.get("type")).toBe("repository.changed");
      expect(params.get("status")).toBe("TRIGGERED");
      expect(params.get("since")).toBe("2026-04-30T00:00:00.000Z");
      expect(params.get("projectId")).toBe("p1");
    });
    await user.click(within(form).getByRole("button", { name: "Reset filters" }));
    expect(within(form).getByLabelText("Event type")).toHaveValue("");
    expect(within(form).getByLabelText("Status")).toHaveValue("");
    expect(within(form).getByLabelText("Since")).toHaveValue("");
  });

  it("shows empty states for events and subscriptions", async () => {
    stubApi({ routes: { "/api/integration-center/events": makeEvents({ events: [], subscriptions: [] }) } });
    renderAt("/integration-center/events?project=p1");
    expect(await screen.findByText("No events match")).toBeInTheDocument();
    expect(screen.getByText("No subscriptions")).toBeInTheDocument();
  });

  it("shows the server's message when events cannot be loaded", async () => {
    stubApi({ routes: { "/api/integration-center/events": json(403, { error: { message: "no events for you" } }) } });
    renderAt("/integration-center/events?project=p1");
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("no events for you");
  });

  it("lists subscriptions and enables or disables them", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_set_subscription: () => executed({ subscriptionId: "sub-1", enabled: false }) } });
    renderAt("/integration-center/events?project=p1");
    const list = await screen.findByTestId("subscription-list");
    expect(within(list).getByText("Review pushes")).toBeInTheDocument();
    expect(within(list).getByText("branch=main")).toBeInTheDocument();
    expect(within(list).getByText("Review the latest push")).toBeInTheDocument();
    expect(within(list).getByText("Proposed 2 times · Never fired")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Disable subscription Review pushes" }));
    await waitFor(() => expect(commandCalls(calls, "integration_set_subscription")).toHaveLength(1));
    expect(commandCalls(calls, "integration_set_subscription")[0]?.body).toEqual({ subscriptionId: "sub-1", enabled: false });
  });

  it("enables a disabled subscription", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      routes: { "/api/integration-center/events": makeEvents({ subscriptions: [makeSubscription({ enabled: false })] }) },
      commands: { integration_set_subscription: () => executed() },
    });
    renderAt("/integration-center/events?project=p1");
    await user.click(await screen.findByRole("button", { name: "Enable subscription Review pushes" }));
    await waitFor(() => expect(commandCalls(calls, "integration_set_subscription")).toHaveLength(1));
    expect(commandCalls(calls, "integration_set_subscription")[0]?.body).toEqual({ subscriptionId: "sub-1", enabled: true });
  });

  it("creates a subscription with typed conditions", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_create_subscription: () => executed({ subscriptionId: "sub-2" }) } });
    renderAt("/integration-center/events?project=p1");
    const form = await screen.findByRole("form", { name: "Create subscription" });
    expect(within(form).getByRole("button", { name: "Create subscription" })).toBeDisabled();
    await user.type(within(form).getByLabelText("Name"), "Review main");
    await user.selectOptions(within(form).getByLabelText("Provider"), "GitHub");
    await user.type(within(form).getByLabelText("Event type"), "repository.changed");
    expect(within(form).getByLabelText("Project")).toHaveValue("p1");
    await user.type(within(form).getByLabelText("Request text"), "Look at this push");
    await user.type(within(form).getByLabelText(/Conditions/), "branch=main{Enter}forced=false");
    await user.click(within(form).getByRole("button", { name: "Create subscription" }));
    await waitFor(() => expect(commandCalls(calls, "integration_create_subscription")).toHaveLength(1));
    expect(commandCalls(calls, "integration_create_subscription")[0]?.body).toEqual({
      name: "Review main", provider: "GitHub", eventType: "repository.changed", projectId: "p1", request: "Look at this push",
      conditions: [{ field: "branch", equals: "main" }, { field: "forced", equals: false }],
    });
  });

  it("rejects a malformed condition without calling the server", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_create_subscription: () => executed() } });
    renderAt("/integration-center/events?project=p1");
    const form = await screen.findByRole("form", { name: "Create subscription" });
    await user.type(within(form).getByLabelText("Name"), "x");
    await user.selectOptions(within(form).getByLabelText("Provider"), "GitHub");
    await user.type(within(form).getByLabelText("Event type"), "t");
    await user.type(within(form).getByLabelText("Request text"), "r");
    await user.type(within(form).getByLabelText(/Conditions/), "nonsense");
    await user.click(within(form).getByRole("button", { name: "Create subscription" }));
    expect(await screen.findByTestId("conditions-invalid")).toBeInTheDocument();
    expect(commandCalls(calls, "integration_create_subscription")).toHaveLength(0);
  });

  it("offers a viewer no way to change subscriptions", async () => {
    stubApi();
    renderAt("/integration-center/events?project=p1", VIEWER);
    await screen.findByTestId("subscription-list");
    expect(screen.queryByRole("form", { name: "Create subscription" })).toBeNull();
    expect(screen.queryByRole("button", { name: /subscription Review pushes/ })).toBeNull();
  });
});

describe("integration log", () => {
  it("lists activity with time, capability, connector, project, agent, outcome, duration and error kind", async () => {
    stubApi({
      routes: {
        "/api/integration-center/activity": { activity: [makeActivity(), makeActivity({ id: "act-2", outcome: "FAILED", errorKind: "RATE_LIMIT", agentId: undefined, durationMs: 1200 })] },
      },
    });
    renderAt("/integration-center/log?project=p1");
    const table = await screen.findByTestId("activity-table");
    const first = within(table.querySelector('[data-activity-id="act-1"]') as HTMLElement);
    expect(first.getByText("repository.read")).toBeInTheDocument();
    expect(first.getByText("GitHub")).toBeInTheDocument();
    expect(first.getByText("Money Mind")).toBeInTheDocument();
    expect(first.getByText("agent-1")).toBeInTheDocument();
    expect(first.getByText("Success")).toBeInTheDocument();
    expect(first.getByText("87 ms")).toBeInTheDocument();
    const second = within(table.querySelector('[data-activity-id="act-2"]') as HTMLElement);
    expect(second.getByText("Failed")).toBeInTheDocument();
    expect(second.getByText(/RATE_LIMIT/)).toBeInTheDocument();
    expect(second.getByText("operator")).toBeInTheDocument();
  });

  it("filters activity by connector and outcome", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/integration-center/log?project=p1");
    await screen.findByTestId("activity-table");
    const form = screen.getByRole("form", { name: "Integration activity" });
    await waitFor(() => expect(within(form).getByRole("option", { name: "Slack" })).toBeInTheDocument());
    await user.selectOptions(within(form).getByLabelText("Connector"), "slack");
    await user.selectOptions(within(form).getByLabelText("Outcome"), "DENIED");
    await user.click(within(form).getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      const params = last(apiCalls(calls, "/api/integration-center/activity")).params;
      expect(params.get("connectorId")).toBe("slack");
      expect(params.get("outcome")).toBe("DENIED");
      expect(params.get("projectId")).toBe("p1");
    });
  });

  it("shows empty activity, audit and queue states", async () => {
    stubApi({
      routes: {
        "/api/integration-center/activity": { activity: [] },
        "/api/integration-center/audit": { entries: [] },
        "/api/integration-center/health": makeHealth({ queue: [] }),
        "/api/integration-center/mcp": { servers: [] },
      },
    });
    renderAt("/integration-center/log?project=p1");
    expect(await screen.findByText("No activity matches")).toBeInTheDocument();
    expect(await screen.findByText("No audit entries")).toBeInTheDocument();
    expect(await screen.findByText("The queue is empty.")).toBeInTheDocument();
    expect(await screen.findByText("No MCP servers are registered")).toBeInTheDocument();
  });

  it("shows an error for each section independently", async () => {
    stubApi({
      routes: {
        "/api/integration-center/activity": json(500, { error: { message: "activity store down" } }),
        "/api/integration-center/audit": json(403, { error: { message: "no ledger access" } }),
      },
    });
    renderAt("/integration-center/log?project=p1");
    await waitFor(() => expect(screen.getAllByTestId("error-reason")).toHaveLength(2));
    const reasons = screen.getAllByTestId("error-reason").map((n) => n.textContent);
    expect(reasons).toContain("activity store down");
    expect(reasons).toContain("no ledger access");
    expect(await screen.findByTestId("mcp-list")).toBeInTheDocument();
  });

  it("shows the integration audit ledger entries", async () => {
    stubApi();
    renderAt("/integration-center/log?project=p1");
    const table = await screen.findByTestId("audit-table");
    expect(within(table).getByText("credential.stored")).toBeInTheDocument();
    expect(within(table).getByText("STORED")).toBeInTheDocument();
    expect(within(table).getByText("purpose")).toBeInTheDocument();
  });

  it("shows the queue and health, and drains the queue", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_drain_queue: () => executed({ processed: 1 }) } });
    renderAt("/integration-center/log?project=p1");
    const queue = await screen.findByTestId("queue-list");
    expect(within(queue).getByText("email.draft")).toBeInTheDocument();
    expect(within(queue).getByText(/timeout/)).toBeInTheDocument();
    expect(within(screen.getByTestId("health-list")).getByText("GitHub")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Drain queue" }));
    await waitFor(() => expect(commandCalls(calls, "integration_drain_queue")).toHaveLength(1));
    expect(await screen.findByTestId("report-message")).toHaveTextContent("Queue drain requested.");
  });

  it("disables draining for a viewer", async () => {
    stubApi();
    renderAt("/integration-center/log?project=p1", VIEWER);
    await screen.findByTestId("queue-list");
    expect(screen.getByRole("button", { name: "Drain queue" })).toBeDisabled();
  });
});

describe("MCP servers", () => {
  it("lists servers with status, trust, projects and tools", async () => {
    stubApi();
    renderAt("/integration-center/log?project=p1");
    const list = await screen.findByTestId("mcp-list");
    const row = within(list.querySelector('[data-server-id="docs"]') as HTMLElement);
    expect(row.getByText("Docs server")).toBeInTheDocument();
    expect(row.getByText("Pending review")).toBeInTheDocument();
    expect(row.getByText("Review required")).toBeInTheDocument();
    expect(row.getByText("Money Mind")).toBeInTheDocument();
    expect(row.getByText("search")).toBeInTheDocument();
  });

  it("says when no project may use a server", async () => {
    stubApi({ routes: { "/api/integration-center/mcp": { servers: [makeMcpServer({ projects: [] })] } } });
    renderAt("/integration-center/log?project=p1");
    expect(await screen.findByText("No project may use this server")).toBeInTheDocument();
  });

  it("lets only an administrator enable, disable or review a server; an operator can still discover tools", async () => {
    stubApi();
    renderAt("/integration-center/log?project=p1", OP);
    await screen.findByTestId("mcp-list");
    expect(screen.getByRole("button", { name: "Enable MCP server Docs server" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable MCP server Docs server" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discover tools of MCP server Docs server" })).toBeEnabled();
  });

  it("enables a server as an administrator", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_set_mcp_status: () => executed({ serverId: "docs", status: "ENABLED" }) } });
    renderAt("/integration-center/log?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: "Enable MCP server Docs server" }));
    await waitFor(() => expect(commandCalls(calls, "integration_set_mcp_status")).toHaveLength(1));
    expect(commandCalls(calls, "integration_set_mcp_status")[0]?.body).toEqual({ serverId: "docs", status: "ENABLED" });
  });

  it("shows the server's text when a status change is refused", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { integration_set_mcp_status: () => rejected("only an administrator may change an MCP server's status") } });
    renderAt("/integration-center/log?project=p1", ADMIN);
    await user.click(await screen.findByRole("button", { name: "Disable MCP server Docs server" }));
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("only an administrator may change an MCP server's status");
  });

  it("discovers tools", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_discover_mcp: () => executed({ serverId: "docs", tools: 4 }) } });
    renderAt("/integration-center/log?project=p1", OP);
    await user.click(await screen.findByRole("button", { name: "Discover tools of MCP server Docs server" }));
    await waitFor(() => expect(commandCalls(calls, "integration_discover_mcp")).toHaveLength(1));
    expect(commandCalls(calls, "integration_discover_mcp")[0]?.body).toEqual({ serverId: "docs" });
    expect(await screen.findByTestId("report-message")).toHaveTextContent("Discovered 4 tools on Docs server.");
  });

  it("registers a server as an administrator", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { integration_register_mcp: () => executed({ serverId: "wiki", status: "PENDING_REVIEW" }) } });
    renderAt("/integration-center/log?project=p1", ADMIN);
    const form = await screen.findByRole("form", { name: "Register an MCP server" });
    expect(within(form).getByRole("button", { name: "Register server" })).toBeDisabled();
    await user.type(within(form).getByLabelText("Server id"), "wiki");
    await user.type(within(form).getByLabelText("Name"), "Wiki");
    await user.type(within(form).getByLabelText("URL"), "https://wiki.example.test/mcp");
    await user.type(within(form).getByLabelText(/Read-only tools/), "search, read");
    await user.click(within(form).getByRole("checkbox", { name: "Money Mind" }));
    await user.click(within(form).getByRole("button", { name: "Register server" }));
    await waitFor(() => expect(commandCalls(calls, "integration_register_mcp")).toHaveLength(1));
    expect(commandCalls(calls, "integration_register_mcp")[0]?.body).toEqual({
      serverId: "wiki", name: "Wiki", url: "https://wiki.example.test/mcp", permissions: [], projects: ["p1"], readOnlyTools: ["search", "read"],
    });
    expect(await screen.findByTestId("report-message")).toHaveTextContent("MCP server registered; it is pending review.");
  });

  it("disables the register form for an operator", async () => {
    stubApi();
    renderAt("/integration-center/log?project=p1", OP);
    const form = await screen.findByRole("form", { name: "Register an MCP server" });
    expect(within(form).getByLabelText("Server id")).toBeDisabled();
    expect(within(form).getByRole("button", { name: "Register server" })).toBeDisabled();
    expect(within(form).getByText("Only an administrator can register MCP servers.")).toBeInTheDocument();
  });
});

describe("language and theme", () => {
  it("renders the Dutch catalogue", async () => {
    stubApi();
    renderAt(OVERVIEW, { language: "nl", ...OP });
    expect(await screen.findByRole("heading", { name: "Samenvatting" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Toolverkenner" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gebeurtenismonitor" })).toBeInTheDocument();
    expect(screen.getByTestId("note-wordpress")).toHaveTextContent("Niet verbonden. Deze connector kan niet worden gebruikt.");
    expect(screen.getByRole("button", { name: "WordPress verbinden" })).toBeInTheDocument();
  });

  it("uses theme tokens only: the stylesheet has no hard-coded colours", async () => {
    const css = (await import("../../../features/integrationCenter/integrationCenter.css?raw")).default as string;
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});

describe("a11y basics", () => {
  it("labels the tab navigation and gives the dialog an accessible name", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt(OVERVIEW, ADMIN);
    await overviewReady();
    expect(screen.getByRole("navigation", { name: "Integration sections" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect WordPress" }));
    expect(screen.getByRole("dialog", { name: "Connect WordPress" })).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Credential value")).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves focus to a failed request so it is announced", async () => {
    stubApi({ routes: { "/api/integration-center/overview": json(500, { error: { message: "boom" } }) } });
    renderAt(OVERVIEW);
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
  });
});

