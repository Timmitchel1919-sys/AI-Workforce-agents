import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ANALYSIS, CAPABILITIES, PLAN, REVIEW_SESSION, makeSession, summary } from "../../../features/projectOnboarding/__tests__/fixtures";
import type { OnboardingSession } from "../../../features/projectOnboarding/types";
import { commandOk, json, renderAt, stubApi } from "./harness";

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

const commandCalls = (calls: { url: string }[], name: string) => calls.filter((c) => c.url.endsWith(`/api/commands/${name}`));

describe("Projects page", () => {
  it("shows + New Project and the resume list (drafts are not projects)", async () => {
    stubApi({ sessions: [summary({ status: "analyzed" }), summary({ id: "ob2", status: "ready" })] });
    renderAt("/projects");
    expect(await screen.findByRole("link", { name: /New Project/ })).toHaveAttribute("href", "/projects/new");
    const resume = await screen.findByRole("region", { name: "Resume onboarding" });
    expect(within(resume).getAllByRole("link")).toHaveLength(1);
    expect(within(resume).getByText(/Draft: Analyzed/)).toBeInTheDocument();
  });

  it("hides + New Project without canCreate", async () => {
    stubApi({ capabilities: { ...CAPABILITIES, canCreate: false } });
    renderAt("/projects");
    await waitFor(() => expect(screen.queryByText("Projects", { selector: "h1" })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("link", { name: /New Project/ })).not.toBeInTheDocument();
  });
});

describe("Entry screen", () => {
  it("shows three kinds and both modes; local import is disabled with the honest note", async () => {
    stubApi({});
    renderAt("/projects/new");
    expect(await screen.findByRole("radio", { name: /Create New Project/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Import Existing Project/ })).toBeEnabled();
    const local = screen.getByRole("radio", { name: /Import Local Project/ });
    expect(local).toBeDisabled();
    expect(screen.getByTestId("kind-note-import_local")).toHaveTextContent("needs a future Desktop Agent");
    expect(screen.getByRole("radio", { name: /Guided Setup/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /AI Auto Setup/ })).toBeEnabled();
  });

  it("creates a draft session and opens the wizard, not a project", async () => {
    const calls = stubApi({
      commands: { onboarding_create: () => commandOk(makeSession()) },
      session: () => makeSession(),
    });
    renderAt("/projects/new");
    await userEvent.click(await screen.findByRole("button", { name: "Start onboarding" }));
    expect(await screen.findByRole("heading", { name: "Project type and identity", level: 2 })).toBeInTheDocument();
    const [create] = commandCalls(calls, "onboarding_create");
    expect(create?.body).toEqual({ mode: "guided", kind: "import_existing" });
    expect(screen.queryByText("PROJECT CONTROL CENTER")).not.toBeInTheDocument();
  });

  it("shows a denial state when the operator cannot create", async () => {
    stubApi({ capabilities: { ...CAPABILITIES, canCreate: false } });
    renderAt("/projects/new");
    expect(await screen.findByText(/cannot create projects/)).toBeInTheDocument();
  });

  it("shows a forbidden command error", async () => {
    stubApi({ commands: { onboarding_create: () => json(200, { ok: false, errorKind: "forbidden", reason: "Denied by policy" }) } });
    renderAt("/projects/new");
    await userEvent.click(await screen.findByRole("button", { name: "Start onboarding" }));
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
    expect(screen.getByText("Denied by policy")).toBeInTheDocument();
  });
});

describe("Wizard: identity and source validation", () => {
  it("rejects a credential-bearing repository URL client-side and never saves", async () => {
    const calls = stubApi({ session: () => makeSession({ status: "source_configured", draft: { ...makeSession().draft, identity: { name: "Acme", code: "ACME", priority: "normal", owner: "u1" } } }) });
    renderAt("/projects/onboarding/ob1");
    await userEvent.click(await screen.findByRole("button", { name: /Source/ }));
    await userEvent.type(await screen.findByLabelText(/Repository URL/), "https://user:ghp_secret@github.com/acme/app");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/must not contain a username, password or token/);
    expect(commandCalls(calls, "onboarding_update")).toHaveLength(0);
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
  });

  it("suggests an upper-case code from the name", async () => {
    stubApi({ session: () => makeSession() });
    renderAt("/projects/onboarding/ob1");
    await userEvent.type(await screen.findByLabelText(/Project name/), "Money Mind");
    expect(screen.getByLabelText(/Project code/)).toHaveValue("MONEYM");
  });
});

describe("Wizard: analysis", () => {
  const analyzed = () => makeSession({ status: "analyzed", analysis: ANALYSIS, revision: 3 });

  it("runs analysis with a loading state then renders evidence, unresolved items and env names only", async () => {
    let resolve: (r: Response) => void = () => {};
    stubApi({
      session: () => makeSession({ status: "source_configured", revision: 2 }),
      commands: { onboarding_analyze: () => new Promise<Response>((r) => { resolve = r; }) },
    });
    renderAt("/projects/onboarding/ob1");
    await userEvent.click(await screen.findByRole("button", { name: "Analyze Project" }));
    expect(await screen.findByText(/Analyzing the project/)).toBeInTheDocument();
    resolve(commandOk(analyzed()));
    const view = await screen.findByTestId("analysis-view");
    expect(within(view).getByText("TypeScript")).toBeInTheDocument();
    expect(within(view).getByText("VITE_API_KEY")).toBeInTheDocument();
    expect(within(view).getByText("Coverage could not be determined")).toBeInTheDocument();
    expect(within(view).getAllByText(/Evidence:/).length).toBeGreaterThan(0);
  });

  it("shows analysis failure and allows retry", async () => {
    const failed = makeSession({ status: "analysis_failed", failure: { code: "x", message: "Repository not reachable", at: "now" } });
    stubApi({ session: () => failed });
    renderAt("/projects/onboarding/ob1");
    expect(await screen.findByTestId("analysis-failed")).toHaveTextContent("Repository not reachable");
    expect(screen.getByRole("button", { name: "Retry analysis" })).toBeEnabled();
  });
});

describe("Wizard: plan steps", () => {
  it("shows an unknown build command as unresolved and secrets by name only", async () => {
    stubApi({ session: () => REVIEW_SESSION });
    renderAt("/projects/onboarding/ob1");
    await screen.findByTestId("review-step");
    const build = document.querySelector('[data-stage="build"]') as HTMLElement;
    expect(build.dataset.status).toBe("unresolved");
    expect(within(build).getByText("Unresolved")).toBeInTheDocument();
    const secrets = screen.getByTestId("secret-names");
    expect(secrets).toHaveTextContent("STRIPE_SECRET");
    expect(secrets.textContent).not.toMatch(/=|sk_/);
    expect(screen.getByText(/Recorded, not enforced/)).toBeInTheDocument();
    expect(screen.getByText(/visible within 5 minutes/)).toBeInTheDocument();
  });

  it("records an override with a differs-from-recommendation tag and asks to regenerate", async () => {
    const withOverride = { ...REVIEW_SESSION, status: "review_required" as const, revision: 6,
      draft: { ...REVIEW_SESSION.draft, overrides: [{ field: "language", value: "Go", recommended: "TypeScript" }] } };
    const calls = stubApi({ session: () => REVIEW_SESSION, commands: { onboarding_update: () => commandOk(withOverride) } });
    renderAt("/projects/onboarding/ob1");
    await userEvent.click(await screen.findByRole("button", { name: /^Technology/ }));
    await userEvent.type(await screen.findByLabelText("Your value"), "Go");
    await userEvent.click(screen.getByRole("button", { name: "Add override" }));
    expect(await screen.findByText("Differs from recommendation")).toBeInTheDocument();
    const [update] = commandCalls(calls, "onboarding_update");
    expect(update?.body).toMatchObject({ id: "ob1", expectedRevision: 5, patch: { overrides: [{ field: "language", value: "Go", recommended: "TypeScript" }] } });
    expect(screen.getByText(/plan is out of date/)).toBeInTheDocument();
  });
});

describe("Review, approve, provision", () => {
  it("approves the exact plan hash, then provisions exactly once on a double click", async () => {
    const approved = { ...REVIEW_SESSION, status: "approved" as const, revision: 6, approval: { planVersion: 2, planHash: PLAN.planHash, approvedBy: "u1", approvedAt: "now" } };
    const provisioning = { ...approved, status: "provisioning" as const, revision: 7, provisioning: { planVersion: 2, planHash: PLAN.planHash, attempt: 1, startedAt: "a", updatedAt: "b", steps: [] } };
    let resolveProvision: (r: Response) => void = () => {};
    const calls = stubApi({
      session: () => REVIEW_SESSION,
      commands: {
        onboarding_approve_plan: () => commandOk(approved),
        onboarding_provision: () => new Promise<Response>((r) => { resolveProvision = r; }),
      },
    });
    renderAt("/projects/onboarding/ob1");
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.getByText(PLAN.planHash.slice(0, 12))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Provision Project" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    const [approve] = commandCalls(calls, "onboarding_approve_plan");
    expect(approve?.body).toMatchObject({ planVersion: 2, planHash: PLAN.planHash, expectedRevision: 5 });
    const provision = await screen.findByRole("button", { name: "Provision Project" });
    await waitFor(() => expect(provision).toBeEnabled());
    await userEvent.dblClick(provision);
    resolveProvision(commandOk(provisioning));
    await screen.findByTestId("provisioning-progress");
    expect(commandCalls(calls, "onboarding_provision")).toHaveLength(1);
  });

  it("blocks approval and provisioning when the plan has blockers", async () => {
    const blocked = { ...REVIEW_SESSION, plan: { ...PLAN, blockers: [{ code: "B", message: "No repository access" }] } };
    stubApi({ session: () => blocked });
    renderAt("/projects/onboarding/ob1");
    expect(await screen.findByTestId("plan-blockers")).toHaveTextContent("No repository access");
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Provision Project" })).toBeDisabled();
  });
});

describe("Provisioning progress", () => {
  const steps = [
    { key: "registry_entry" as const, title: "Registry entry", status: "complete" as const, mandatory: true, external: false },
    { key: "repository_creation" as const, title: "Repository", status: "requirement_pending" as const, mandatory: false, external: true },
    { key: "git_workflow" as const, title: "Git workflow", status: "failed" as const, mandatory: true, external: false, error: "Quota exceeded" },
  ];
  const failed: OnboardingSession = {
    ...REVIEW_SESSION, status: "provisioning_failed", revision: 8,
    failure: { code: "step", message: "Git workflow step failed", at: "now" },
    approval: { planVersion: 2, planHash: PLAN.planHash, approvedBy: "u1", approvedAt: "now" },
    provisioning: { planVersion: 2, planHash: PLAN.planHash, attempt: 1, startedAt: "a", updatedAt: "b", steps },
  };

  it("renders real step statuses (text, not colour) and resumes provisioning", async () => {
    const calls = stubApi({ session: () => failed, commands: { onboarding_provision: () => commandOk({ ...failed, status: "provisioning", revision: 9 }) } });
    renderAt("/projects/onboarding/ob1");
    const list = await screen.findByRole("list", { name: "Provisioning steps" });
    expect(within(list).getByText("Complete")).toBeInTheDocument();
    expect(within(list).getByText("Requirement pending")).toBeInTheDocument();
    expect(within(list).getByText("Failed")).toBeInTheDocument();
    expect(within(list).getByText("Quota exceeded")).toBeInTheDocument();
    expect(list.querySelector('[aria-current="step"]')).toHaveTextContent("Git workflow");
    await userEvent.click(screen.getByRole("button", { name: "Resume provisioning" }));
    await waitFor(() => expect(commandCalls(calls, "onboarding_provision")).toHaveLength(1));
  });

  it("offers re-validation with blocking checks when validation failed", async () => {
    const vf: OnboardingSession = { ...failed, status: "validation_failed", validation: { checkedAt: "now", ready: false, checks: [], blocking: ["Deployment not verified"] } };
    stubApi({ session: () => vf });
    renderAt("/projects/onboarding/ob1");
    expect(await screen.findByTestId("validation-blocking")).toHaveTextContent("Deployment not verified");
    expect(screen.getByRole("button", { name: "Re-run validation" })).toBeEnabled();
  });

  it("links to the project when it is already ready", async () => {
    stubApi({ session: () => ({ ...failed, status: "ready" }) });
    renderAt("/projects/onboarding/ob1");
    expect(await screen.findByRole("link", { name: "Open Project Control Center" })).toHaveAttribute("href", "/projects/acme-app");
    expect(screen.getByRole("link", { name: "Open in Spatial Graph" })).toHaveAttribute("href", "/graph?project=acme-app");
  });

  it("redirects to /projects/:id when provisioning completes while open", async () => {
    let current: OnboardingSession = { ...failed, status: "validating", revision: 9 };
    stubApi({ session: () => current });
    renderAt("/projects/onboarding/ob1");
    await screen.findByTestId("provisioning-progress");
    current = { ...failed, status: "ready", revision: 10 };
    // Simulate the refetch that polling performs while validating.
    await userEvent.click(screen.getByRole("button", { name: /Provisioning/ }));
    await waitFor(() => expect(screen.getByText("PROJECT CONTROL CENTER")).toBeInTheDocument(), { timeout: 5000 });
  }, 10000);
});

describe("Error states", () => {
  it("offers reload-latest on a stale revision", async () => {
    stubApi({
      session: () => REVIEW_SESSION,
      commands: { onboarding_approve_plan: () => json(200, { ok: false, errorKind: "invalid_state", reason: "Revision is stale", details: { code: "revision_conflict", currentRevision: 9 } }) },
    });
    renderAt("/projects/onboarding/ob1");
    await userEvent.click(await screen.findByRole("button", { name: "Approve plan" }));
    expect(await screen.findByText("This onboarding changed elsewhere")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeInTheDocument();
  });

  it("reports a duplicate project", async () => {
    stubApi({
      session: () => REVIEW_SESSION,
      commands: { onboarding_approve_plan: () => json(200, { ok: false, errorKind: "invalid_state", reason: "Code ACME is taken", details: { code: "duplicate_project" } }) },
    });
    renderAt("/projects/onboarding/ob1");
    await userEvent.click(await screen.findByRole("button", { name: "Approve plan" }));
    expect(await screen.findByText("This project already exists")).toBeInTheDocument();
  });

  it("shows a load error with retry when the session cannot be loaded", async () => {
    stubApi({});
    renderAt("/projects/onboarding/missing");
    expect(await screen.findByText("Onboarding session not found")).toBeInTheDocument();
  });
});

describe("Cancel", () => {
  it("confirms before cancelling and does not claim to delete anything external", async () => {
    const calls = stubApi({ session: () => REVIEW_SESSION, commands: { onboarding_cancel: () => commandOk({ ...REVIEW_SESSION, status: "cancelled" }) } });
    renderAt("/projects/onboarding/ob1");
    await userEvent.click(await screen.findByRole("button", { name: "Abandon draft" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Nothing outside the Control Plane is deleted/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Abandon draft" }));
    await waitFor(() => expect(commandCalls(calls, "onboarding_cancel")).toHaveLength(1));
  });
});

describe("Auto mode and Dutch", () => {
  it("auto mode asks only for minimal input", async () => {
    stubApi({ session: () => makeSession({ mode: "auto" }) });
    renderAt("/projects/onboarding/ob1");
    expect(await screen.findByRole("button", { name: "Analyze and plan" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Repository URL/)).toBeInTheDocument();
  });

  it("renders Dutch strings", async () => {
    stubApi({});
    renderAt("/projects/new", "nl");
    expect(await screen.findByRole("radio", { name: /Lokaal project importeren/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Onboarding starten" })).toBeInTheDocument();
  });
});
