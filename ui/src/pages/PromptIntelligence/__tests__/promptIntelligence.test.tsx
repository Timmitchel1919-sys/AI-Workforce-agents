import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeView, summaryOf } from "../../../features/promptIntelligence/__tests__/fixtures";
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

async function submitRequest(text = "Make the login card shorter") {
  await userEvent.type(await screen.findByLabelText("Request"), text);
  await userEvent.click(screen.getByRole("button", { name: /Analyze request/ }));
}

describe("access", () => {
  it("hides the form without prepare_prompt but keeps the history viewable", async () => {
    const view = makeView();
    stubApi({ history: [summaryOf(view)], views: { "req-1": view } });
    renderAt("/prompt-intelligence", { capabilities: ["view"] });
    expect(await screen.findByText("Read-only access")).toBeInTheDocument();
    expect(screen.queryByLabelText("Request")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Analyze request/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Make the login card shorter/ })).toBeInTheDocument();
  });

  it("shows the form with prepare_prompt, labelled controls and a live counter", async () => {
    stubApi({});
    renderAt("/prompt-intelligence");
    const textarea = await screen.findByLabelText("Request");
    expect(textarea).toHaveAttribute("maxlength", "4000");
    expect(screen.getByText(/Never paste secrets/)).toBeInTheDocument();
    expect(screen.getByTestId("request-counter")).toHaveTextContent("0 / 4000");
    await userEvent.type(textarea, "abc");
    expect(screen.getByTestId("request-counter")).toHaveTextContent("3 / 4000");
    const select = screen.getByLabelText("Project");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Money Mind" })).toBeInTheDocument());
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Detect from the request");
    expect(screen.getByLabelText("Task id (optional)")).toBeInTheDocument();
  });

  it("asks for a request before calling the backend", async () => {
    const calls = stubApi({});
    renderAt("/prompt-intelligence");
    await userEvent.click(await screen.findByRole("button", { name: /Analyze request/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a request before analyzing.");
    expect(commandCalls(calls, "prompt_prepare")).toHaveLength(0);
  });
});

describe("prepare", () => {
  it("issues exactly one prompt_prepare and renders the whole pipeline; PASS has no execute button", async () => {
    const view = makeView({ status: "PASS" });
    const calls = stubApi({ commands: { prompt_prepare: () => commandOk(view) } });
    renderAt("/prompt-intelligence");
    await userEvent.selectOptions(await screen.findByLabelText("Project"), "money-mind").catch(() => undefined);
    await submitRequest();

    expect(await screen.findByRole("heading", { name: /Next execution step/, level: 3 })).toBeInTheDocument();
    const prepares = commandCalls(calls, "prompt_prepare");
    expect(prepares).toHaveLength(1);
    expect(prepares[0]?.body).toMatchObject({ request: "Make the login card shorter" });

    for (const name of [/User request/, /Intent/, /Resolved context/, /Generated prompt/, /Validation/, /Required capability/, /Next execution step/]) {
      expect(screen.getByRole("heading", { name, level: 3 })).toBeInTheDocument();
    }
    expect(screen.getByText(/Ready for the Project Manager \/ Agent Router/)).toBeInTheDocument();
    expect(screen.getByText(/Execution is not started in this phase/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /execute|run|start/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request approval/ })).not.toBeInTheDocument();
    expect(screen.getByText(/These are requirements, not an assignment/)).toBeInTheDocument();
    expect(screen.getByText("frontend.ui")).toBeInTheDocument();
  });

  it("renders the stages: intent, context (why, conflicts, excluded, missing, sources) and prompt as plain text", async () => {
    const view = makeView();
    stubApi({ views: { "req-1": view } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByRole("heading", { name: /Intent/, level: 3 })).toBeInTheDocument();
    expect(screen.getByText("Reduce the vertical size of the login card")).toBeInTheDocument();
    expect(screen.getByText("Risk: Low")).toBeInTheDocument();
    expect(screen.getByText("Keep the existing colours")).toBeInTheDocument();
    expect(screen.getByText("Preserve accessibility")).toBeInTheDocument();
    expect(screen.getByText("Default applied")).toBeInTheDocument();
    expect(screen.getByText("Default used: Reduce padding by 20%")).toBeInTheDocument();
    expect(screen.getByText("Matches keyword login")).toBeInTheDocument();
    expect(screen.getByText("2 · Project security policy")).toBeInTheDocument();
    expect(screen.getByText("src/components/LoginCard.tsx")).toBeInTheDocument();
    expect(screen.getByText("Not relevant: 2")).toBeInTheDocument();
    expect(screen.getByText("Over budget: 1")).toBeInTheDocument();
    expect(screen.getByText("Repository not connected")).toBeInTheDocument();
    expect(screen.getByText("Unavailable", { selector: "span > span" })).toBeInTheDocument();
    // Prompt text is escaped, never interpreted as HTML.
    const pre = screen.getByLabelText("Generated prompt text");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain("<script>alert(1)</script>");
    expect(pre.querySelector("script")).toBeNull();
    expect(screen.getByText("Prompt version 2")).toBeInTheDocument();
  });

  it("disables the submit button while pending (no double submit)", async () => {
    let release: (r: Response) => void = () => {};
    const calls = stubApi({ commands: { prompt_prepare: () => new Promise<Response>((r) => { release = r; }) } });
    renderAt("/prompt-intelligence");
    await submitRequest();
    const button = await screen.findByRole("button", { name: /Analyzing/ });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(commandCalls(calls, "prompt_prepare")).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Analyzing the request" })).toBeInTheDocument();
    release(commandOk(makeView()));
    await screen.findByRole("heading", { name: /Next execution step/ });
    expect(screen.getByTestId("live-region")).toHaveTextContent("Request prepared. Validation result: Pass.");
  });
});

describe("next step by validation status", () => {
  it("APPROVAL_REQUIRED offers Request approval once, then shows the waiting state", async () => {
    const required = makeView({ status: "APPROVAL_REQUIRED" });
    const requested = makeView({ status: "APPROVAL_REQUIRED", approval: "requested", blockedBy: ["Waiting for approval"] });
    const calls = stubApi({
      views: { "req-1": required },
      commands: { prompt_request_approval: () => commandOk(requested) },
    });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByText("Approval required", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", "/approvals");
    await userEvent.click(screen.getByRole("button", { name: "Request approval" }));
    expect(await screen.findByText("Waiting for human approval")).toBeInTheDocument();
    const approvals = commandCalls(calls, "prompt_request_approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.body).toEqual({ requestId: "req-1" });
    expect(screen.queryByRole("button", { name: "Request approval" })).not.toBeInTheDocument();
    expect(screen.getByTestId("live-region")).toHaveTextContent("Approval requested");
  });

  it("shows waiting without a button when approval was already requested", async () => {
    stubApi({ views: { "req-1": makeView({ status: "APPROVAL_REQUIRED", approval: "requested" }) } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByText("Waiting for human approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request approval" })).not.toBeInTheDocument();
  });

  it.each([["rejected", "Approval rejected"], ["expired", "Approval expired"]] as const)("%s approval is blocked", async (state, title) => {
    stubApi({ views: { "req-1": makeView({ status: "APPROVAL_REQUIRED", approval: state, blockedBy: ["Approval was not granted"] }) } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText("Approval was not granted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request approval" })).not.toBeInTheDocument();
  });

  it("CLARIFY shows the questions", async () => {
    stubApi({ views: { "req-1": makeView({ status: "CLARIFY" }) } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByText("Clarification needed", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText("Which login card do you mean?").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs clarification")).toBeInTheDocument();
  });

  it("BLOCKED shows the reasons and the security override as not applied", async () => {
    stubApi({ views: { "req-1": makeView({ status: "BLOCKED" }) } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByText("Blocked", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText("Request tries to disable authentication").length).toBeGreaterThan(0);
    expect(screen.getByText("Not applied")).toBeInTheDocument();
    expect(screen.getByText("disable authentication")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /execute|run|start/i })).not.toBeInTheDocument();
  });

  it("every validation status has distinct text", async () => {
    stubApi({ views: { "req-1": makeView({ status: "WARN" }) } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByText("The prompt is usable, but some checks raised warnings.")).toBeInTheDocument();
    expect(screen.getByText("Pass", { selector: ".pi-tag span" })).toBeInTheDocument();
    expect(screen.getAllByText("Warning").length).toBeGreaterThan(0);
  });

  it("shows a conflict error when approval cannot be requested (409)", async () => {
    stubApi({
      views: { "req-1": makeView({ status: "APPROVAL_REQUIRED" }) },
      commands: { prompt_request_approval: () => json(409, { ok: false, errorKind: "invalid_state", reason: "Approval was already requested." }) },
    });
    renderAt("/prompt-intelligence/req-1");
    await userEvent.click(await screen.findByRole("button", { name: "Request approval" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "CONFLICT");
    expect(alert).toHaveTextContent("Approval was already requested.");
  });
});

describe("history and resume", () => {
  it("lists newest first and loads a request when clicked", async () => {
    const older = makeView({ requestId: "req-old", request: "Older request" });
    const newer = makeView({ requestId: "req-new", request: "Newer request", status: "CLARIFY" });
    const calls = stubApi({
      history: [summaryOf(older, "2026-05-01T09:00:00.000Z"), summaryOf(newer, "2026-05-02T09:00:00.000Z")],
      views: { "req-old": older, "req-new": newer },
    });
    renderAt("/prompt-intelligence");
    const items = await screen.findAllByRole("link", { name: /request/i });
    expect(items[0]).toHaveTextContent("Newer request");
    expect(items[1]).toHaveTextContent("Older request");
    await userEvent.click(items[1]!);
    expect(await screen.findByRole("heading", { name: /User request/, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("blockquote")).toHaveTextContent("Older request");
    expect(calls.some((c) => c.url.endsWith("/api/prompt-intelligence/req-old"))).toBe(true);
  });

  it("resumes from /prompt-intelligence/:requestId", async () => {
    stubApi({ views: { "req-9": makeView({ requestId: "req-9", request: "Resumed request" }) } });
    renderAt("/prompt-intelligence/req-9");
    expect(await screen.findByRole("blockquote")).toHaveTextContent("Resumed request");
    expect(screen.getByText("req-9")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    stubApi({ history: [] });
    renderAt("/prompt-intelligence");
    expect(await screen.findByText("No prepared requests yet")).toBeInTheDocument();
  });

  it("shows project not identified for the unresolved project", async () => {
    stubApi({ views: { "req-1": makeView({ projectId: "unresolved" }) } });
    renderAt("/prompt-intelligence/req-1");
    await screen.findByRole("blockquote");
    expect(screen.getAllByText("Not identified").length).toBeGreaterThan(0);
  });
});

describe("error states", () => {
  it("prepare 400 shows the server reason and allows retry", async () => {
    let attempts = 0;
    const calls = stubApi({
      commands: {
        prompt_prepare: () => {
          attempts += 1;
          return attempts === 1
            ? json(400, { ok: false, errorKind: "invalid_request", reason: "The request appears to contain a credential." })
            : commandOk(makeView());
        },
      },
    });
    renderAt("/prompt-intelligence");
    await submitRequest("my key is abc");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "INVALID");
    expect(alert).toHaveTextContent("The request appears to contain a credential.");
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: /Next execution step/ })).toBeInTheDocument();
    expect(commandCalls(calls, "prompt_prepare")).toHaveLength(2);
  });

  it.each([
    [403, { ok: false, errorKind: "forbidden", reason: "Not allowed" }, "FORBIDDEN"],
    [401, { message: "unauthenticated" }, "UNAUTHENTICATED"],
    [500, { message: "boom" }, "DEGRADED"],
  ] as const)("prepare %i maps to %s", async (status, body, code) => {
    stubApi({ commands: { prompt_prepare: () => json(status, body) } });
    renderAt("/prompt-intelligence");
    await submitRequest();
    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", code);
  });

  it("detail 404 shows not found with retry", async () => {
    stubApi({ views: {} });
    renderAt("/prompt-intelligence/missing");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "NOT_FOUND");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("detail 403 shows forbidden", async () => {
    stubApi({ detailStatus: 403, detailBody: { ok: false, errorKind: "forbidden", reason: "No access" } });
    renderAt("/prompt-intelligence/req-1");
    expect(await screen.findByRole("alert")).toHaveAttribute("data-error-code", "FORBIDDEN");
  });

  it("network failure shows a retryable error for history and detail", async () => {
    stubApi({ networkFailure: true });
    renderAt("/prompt-intelligence/req-1");
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2));
    for (const alert of screen.getAllByRole("alert")) {
      expect(alert).toHaveAttribute("data-error-code", "NETWORK");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    }
  });

  it("history failure is surfaced and does not hide the form", async () => {
    stubApi({ historyStatus: 500 });
    renderAt("/prompt-intelligence");
    expect(await screen.findByText("Control Plane problem")).toBeInTheDocument();
    expect(screen.getByLabelText("Request")).toBeInTheDocument();
  });
});

describe("copy prompt", () => {
  it("copies the prompt text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    stubApi({ views: { "req-1": makeView() } });
    renderAt("/prompt-intelligence/req-1");
    await userEvent.click(await screen.findByRole("button", { name: /Copy prompt/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("OBJECTIVE: reduce the login card height"));
    expect(await screen.findByText("Prompt copied to the clipboard.")).toBeInTheDocument();
  });

  it("fails gracefully when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    stubApi({ views: { "req-1": makeView() } });
    renderAt("/prompt-intelligence/req-1");
    await userEvent.click(await screen.findByRole("button", { name: /Copy prompt/ }));
    expect(await screen.findByText(/could not be copied/)).toBeInTheDocument();
  });
});

describe("Dutch", () => {
  it("renders the page and result in Dutch", async () => {
    stubApi({ views: { "req-1": makeView({ status: "APPROVAL_REQUIRED" }) } });
    renderAt("/prompt-intelligence/req-1", { language: "nl" });
    expect(await screen.findByRole("heading", { name: /Volgende uitvoeringsstap/, level: 3 })).toBeInTheDocument();
    expect(screen.getByLabelText("Verzoek")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Goedkeuring aanvragen" })).toBeInTheDocument();
    expect(screen.getByText("Dit zijn eisen, geen toewijzing. De Agent Router (volgende fase) kiest de agents die eraan voldoen.")).toBeInTheDocument();
  });
});
