import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeConflict, makeContext, makeDetail, makeGraph, makeHit, makeMemory, makeOverview,
} from "../../../features/knowledge/__tests__/fixtures";
import { json, renderAt, stubApi, type Call } from "./harness";

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

const commandBody = (details: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  command: "knowledge_x", outcome: "executed", ok: true, reason: "done", correlationId: "corr-1", details, auditEventId: "a1", timestamp: "2026-05-01T10:00:00.000Z", ...over,
});
const executed = (details: Record<string, unknown> = {}) => json(200, commandBody(details));
const rejected = (reason: string, status = 200, errorKind = "invalid_state") =>
  json(status, commandBody({}, { outcome: "rejected", ok: false, errorKind, reason }));

const commandCalls = (calls: Call[], name: string) => calls.filter((c) => c.path === `/api/commands/${name}`);
const apiCalls = (calls: Call[], path: string) => calls.filter((c) => c.path === path);
const last = <T,>(list: T[]): T => list[list.length - 1] as T;
const locationText = () => screen.getByTestId("location").textContent;

describe("tab routing", () => {
  it("shows the overview by default with health cards, findings and honest capability notes", async () => {
    stubApi();
    renderAt("/knowledge?project=p1");
    expect(await screen.findByRole("heading", { name: "Knowledge health" })).toBeInTheDocument();
    const card = (key: string) => document.querySelector(`[data-health="${key}"]`)?.textContent ?? "";
    expect(card("total")).toContain("12");
    expect(card("active")).toContain("8");
    expect(card("superseded")).toContain("1");
    expect(card("potentiallyStale")).toContain("3");
    expect(card("conflicts")).toContain("1");
    expect(card("unverified")).toContain("4");
    expect(card("drafts")).toContain("2");
    expect(card("expiringSoon")).toContain("5");
    expect(card("documents")).toContain("7");
    expect(card("relationships")).toContain("9");
    expect(screen.getByText("Conflicting memory")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Two memories disagree about the database.")).toBeInTheDocument();
    expect(screen.getByText(/Semantic search uses keyword \+ similarity, no embedding model configured/)).toBeInTheDocument();
    expect(screen.getByText(/PDF files cannot be ingested yet/)).toBeInTheDocument();
  });

  it("moves between tabs through the URL and keeps the project scope", async () => {
    const user = userEvent.setup();
    stubApi();
    renderAt("/knowledge/documents?project=p1");
    expect(await screen.findByRole("heading", { name: "Ingested documents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Documents" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("link", { name: "Conflicts" }));
    expect(await screen.findByRole("heading", { name: "Conflicting knowledge" })).toBeInTheDocument();
    expect(locationText()).toBe("/knowledge/conflicts?project=p1");
    await user.click(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Knowledge health" })).toBeInTheDocument();
    expect(locationText()).toBe("/knowledge?project=p1");
  });

  it("sends an unknown tab back to the overview", async () => {
    stubApi();
    renderAt("/knowledge/bogus");
    expect(await screen.findByRole("heading", { name: "Knowledge health" })).toBeInTheDocument();
    expect(locationText()).toBe("/knowledge");
  });

  it("scopes by the selected project and offers All projects", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/knowledge/memories");
    await screen.findByText("Use PostgreSQL");
    expect(last(apiCalls(calls, "/api/knowledge/memories")).params.get("projectId")).toBe("p1");
    await user.selectOptions(document.querySelector(".kn-scope select") as HTMLSelectElement, "p2");
    await waitFor(() => expect(last(apiCalls(calls, "/api/knowledge/memories")).params.get("projectId")).toBe("p2"));
    expect(locationText()).toContain("project=p2");
    await user.selectOptions(document.querySelector(".kn-scope select") as HTMLSelectElement, "all");
    await waitFor(() => expect(last(apiCalls(calls, "/api/knowledge/memories")).params.has("projectId")).toBe(false));
  });

  it("asks for a project on single-project tabs when scope is All projects", async () => {
    const calls = stubApi();
    renderAt("/knowledge/graph?project=all");
    expect(await screen.findByText("Select a project")).toBeInTheDocument();
    expect(apiCalls(calls, "/api/knowledge/graph")).toHaveLength(0);
  });

  it("renders Dutch when the language is Dutch", async () => {
    stubApi();
    renderAt("/knowledge?project=p1", { language: "nl" });
    expect(await screen.findByRole("heading", { name: "Gezondheid van de kennis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kenniscentrum" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Herinneringen" })).toBeInTheDocument();
    expect(document.querySelector('[data-health="total"]')?.textContent).toContain("Totaal aantal herinneringen");
  });
});

describe("memories: list, search and filters", () => {
  it("lists with GET /knowledge/memories when the query is empty and searches with GET /knowledge/search otherwise", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ search: [makeHit(), makeHit({ memoryId: "m3", title: "Cache layer", reasons: ["tag match"], score: 0.4 })] });
    renderAt("/knowledge/memories?project=p1");
    expect(await screen.findByText("Use PostgreSQL")).toBeInTheDocument();
    expect(screen.getByTestId("memories-mode")).toHaveAttribute("data-mode", "list");
    expect(apiCalls(calls, "/api/knowledge/search")).toHaveLength(0);
    expect(last(apiCalls(calls, "/api/knowledge/memories")).params.get("limit")).toBe("100");
    expect(screen.getByText("Last updated", { exact: false })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search knowledge"), "postgres{Enter}");
    await waitFor(() => expect(screen.getByTestId("memories-mode")).toHaveAttribute("data-mode", "search"));
    const search = last(apiCalls(calls, "/api/knowledge/search"));
    expect(search.params.get("q")).toBe("postgres");
    expect(search.params.get("projectId")).toBe("p1");
    expect(screen.getByText("Score 0.82")).toBeInTheDocument();
    expect(screen.getByText("Score 0.40")).toBeInTheDocument();
    // reasons are hidden until "Why retrieved" is expanded
    expect(screen.queryByText("title matches the query")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Why retrieved" })[0] as HTMLElement);
    expect(screen.getByText("title matches the query")).toBeInTheDocument();
    expect(screen.getByText("recently reinforced")).toBeInTheDocument();
  });

  it("builds the query string from the filters", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderAt("/knowledge/memories?project=p1");
    await screen.findByText("Use PostgreSQL");
    await user.selectOptions(screen.getByLabelText("Type"), "ARCHITECTURAL");
    await user.selectOptions(screen.getByLabelText("Source"), "GITHUB");
    await user.selectOptions(screen.getByLabelText("Status"), "ACTIVE");
    await user.selectOptions(screen.getByLabelText("Confidence"), "VERIFIED");
    await user.selectOptions(screen.getByLabelText("Importance"), "CRITICAL");
    fireEvent.change(screen.getByLabelText("Updated since"), { target: { value: "2026-05-01" } });
    await waitFor(() => expect(last(apiCalls(calls, "/api/knowledge/memories")).params.get("since")).toBe("2026-05-01T00:00:00.000Z"));
    const params = last(apiCalls(calls, "/api/knowledge/memories")).params;
    expect(Object.fromEntries(params.entries())).toEqual({
      projectId: "p1", type: "ARCHITECTURAL", source: "GITHUB", status: "ACTIVE", confidence: "VERIFIED", importance: "CRITICAL",
      since: "2026-05-01T00:00:00.000Z", limit: "100",
    });
    // filters are kept in the URL so they survive navigation
    expect(locationText()).toContain("type=ARCHITECTURAL");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    // the unfiltered list is served from the query cache, so assert the state rather than a new request
    await waitFor(() => expect(screen.getByLabelText("Type")).toHaveValue(""));
    expect(locationText()).toBe("/knowledge/memories?project=p1");
  });

  it("applies filters to a search too", async () => {
    const calls = stubApi({ search: [makeHit()] });
    renderAt("/knowledge/memories?project=p1&q=database&status=ACTIVE");
    await screen.findByText("Score 0.82");
    const params = last(apiCalls(calls, "/api/knowledge/search")).params;
    expect(params.get("q")).toBe("database");
    expect(params.get("status")).toBe("ACTIVE");
  });

  it("shows an empty state and an API error with the reason", async () => {
    stubApi({ memories: [] });
    renderAt("/knowledge/memories?project=p1");
    expect(await screen.findByText("No memories match")).toBeInTheDocument();
  });

  it("surfaces a failing list endpoint", async () => {
    stubApi({ memories: () => json(500, { error: { message: "store unavailable" } }) });
    renderAt("/knowledge/memories?project=p1");
    expect(await screen.findByRole("alert")).toHaveTextContent("store unavailable");
  });
});

describe("memory detail", () => {
  const open = (details = makeDetail(), options: Parameters<typeof renderAt>[1] = {}, extra: Parameters<typeof stubApi>[0] = {}) => {
    const calls = stubApi({ details: { m1: details }, ...extra });
    renderAt("/knowledge/memories/m1?project=p1", options);
    return calls;
  };

  it("renders content as plain text with provenance, versions, usage, relations and links", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Use PostgreSQL" })).toBeInTheDocument();
    const content = screen.getByLabelText("Content");
    expect(content.textContent).toContain("<script>alert(1)</script>");
    expect(content.querySelector("script")).toBeNull();
    expect(screen.getByTestId("provenance-answer")).toHaveTextContent("Alice typed this in on 1 May.");
    expect(screen.getByText("user:alice", { selector: "dd" })).toBeInTheDocument();
    const versions = screen.getByRole("table", { name: "Version history" });
    expect(within(versions).getByText("edited content")).toBeInTheDocument();
    expect(within(versions).getAllByRole("row")).toHaveLength(3);
    const usage = screen.getByRole("table", { name: "Used by agents" });
    expect(within(usage).getByText("task-7")).toBeInTheDocument();
    expect(within(usage).getByText("backend-agent")).toBeInTheDocument();
    expect(within(usage).getByText("schema question")).toBeInTheDocument();
    expect(within(usage).getByText("Task succeeded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use PostgreSQL 17" })).toHaveAttribute("href", "/knowledge/memories/m9?project=p1");
    expect(screen.getByRole("link", { name: "PostgreSQL" })).toHaveAttribute("href", "/knowledge/memories/m5?project=p1");
    expect(screen.getByText("docs/db.md")).toBeInTheDocument();
    expect(screen.getByText("No conflicts.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All memories/ })).toHaveAttribute("href", "/knowledge/memories?project=p1");
  });

  it("lists conflicts that involve the memory", async () => {
    open(makeDetail({ conflicts: [makeConflict()] }));
    expect(await screen.findByText(/Use MySQL \(MySQL\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resolve conflicts" })).toHaveAttribute("href", "/knowledge/conflicts?project=p1");
  });

  it("shows no action buttons to a viewer", async () => {
    open(makeDetail(), { capabilities: ["view"], role: "viewer" });
    await screen.findByRole("heading", { name: "Use PostgreSQL" });
    for (const name of ["Edit", "Confirm", "Archive", "Restore", "Supersede", "Revoke", "Delete"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/needs the manage knowledge capability/)).toBeInTheDocument();
  });

  it("offers the right actions for an active memory and explains why it cannot be deleted", async () => {
    open();
    await screen.findByRole("heading", { name: "Use PostgreSQL" });
    for (const name of ["Edit", "Archive", "Supersede", "Revoke"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only drafts, archived and revoked memories can be deleted/)).toBeInTheDocument();
  });

  it("offers Confirm and Delete for a plain draft, Restore for archived", async () => {
    open(makeDetail({}, { status: "DRAFT" }));
    await screen.findByRole("heading", { name: "Use PostgreSQL" });
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supersede" })).not.toBeInTheDocument();
  });

  it("hides Delete for critical or architectural memory and says why", async () => {
    open(makeDetail({}, { status: "ARCHIVED", type: "ARCHITECTURAL" }));
    await screen.findByRole("heading", { name: "Use PostgreSQL" });
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText(/never deleted or overwritten\. Supersede it/)).toBeInTheDocument();
  });

  it("shows the server's reason when an edit is rejected and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const calls = open(makeDetail(), {}, {
      commands: { knowledge_update_memory: () => rejected("critical and architectural memory is never overwritten: supersede it", 409) },
    });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Title"));
    await user.type(within(dialog).getByLabelText("Title"), "Use PostgreSQL 16");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("critical and architectural memory is never overwritten: supersede it");
    expect(commandCalls(calls, "knowledge_update_memory")[0]?.body).toMatchObject({ memoryId: "m1", title: "Use PostgreSQL 16", tags: ["db"], importance: "NORMAL" });
  });

  it("shows a rejection that comes back as HTTP 200 with ok=false", async () => {
    const user = userEvent.setup();
    open(makeDetail(), {}, { commands: { knowledge_archive_memory: () => rejected("memory is already archived") } });
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "obsolete");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("memory is already archived");
  });

  it("archives with a reason and refetches the memory", async () => {
    const user = userEvent.setup();
    const calls = open(makeDetail(), {}, { commands: { knowledge_archive_memory: () => executed() } });
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "obsolete");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(commandCalls(calls, "knowledge_archive_memory")[0]?.body).toEqual({ memoryId: "m1", reason: "obsolete" });
    await waitFor(() => expect(apiCalls(calls, "/api/knowledge/memories/m1").length).toBeGreaterThan(1));
  });

  it("supersedes with replacement text and opens the new memory", async () => {
    const user = userEvent.setup();
    const calls = open(makeDetail(), {}, {
      details: { m1: makeDetail(), m10: makeDetail({}, { memoryId: "m10", title: "Replacement" }) },
      commands: { knowledge_supersede_memory: () => executed({ memoryId: "m10", supersededMemoryId: "m1" }) },
    });
    await user.click(await screen.findByRole("button", { name: "Supersede" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Supersede memory" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Replacement text"), "Use PostgreSQL 17");
    await user.click(within(dialog).getByRole("button", { name: "Supersede memory" }));
    await waitFor(() => expect(locationText()).toBe("/knowledge/memories/m10?project=p1"));
    expect(commandCalls(calls, "knowledge_supersede_memory")[0]?.body).toEqual({ memoryId: "m1", title: "Use PostgreSQL", content: "Use PostgreSQL 17", importance: "NORMAL" });
  });

  it("deletes a draft after confirmation and returns to the list", async () => {
    const user = userEvent.setup();
    const calls = open(makeDetail({}, { status: "DRAFT" }), {}, { commands: { knowledge_delete_memory: () => executed() } });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(commandCalls(calls, "knowledge_delete_memory")).toHaveLength(0);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(locationText()).toBe("/knowledge/memories?project=p1"));
    expect(commandCalls(calls, "knowledge_delete_memory")[0]?.body).toEqual({ memoryId: "m1" });
  });

  it("shows a not found error with a way back", async () => {
    stubApi({ details: {} });
    renderAt("/knowledge/memories/nope?project=p1");
    expect(await screen.findByRole("alert")).toHaveTextContent("memory not found");
    expect(screen.getByRole("link", { name: /All memories/ })).toBeInTheDocument();
  });
});

describe("create memory", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Create memory" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Prefer tabs");
    await user.type(within(dialog).getByLabelText("Content"), "The team prefers tabs.");
    return dialog;
  };

  it("sends the new memory and says when it was only reinforced", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { knowledge_create_memory: () => executed({ memoryId: "m1", status: "ACTIVE", outcome: "REINFORCED", decision: "duplicate", projectId: "p1" }) } });
    renderAt("/knowledge/memories?project=p1");
    const dialog = await fill(user);
    await user.type(within(dialog).getByLabelText("Tags"), "style, team,style");
    await user.click(within(dialog).getByLabelText("Save as draft"));
    await user.selectOptions(within(dialog).getByLabelText("Importance"), "HIGH");
    await user.click(within(dialog).getByRole("button", { name: "Create memory" }));
    expect(await screen.findByText(/This was already known; the existing memory was reinforced/)).toBeInTheDocument();
    expect(commandCalls(calls, "knowledge_create_memory")[0]?.body).toEqual({
      projectId: "p1", type: "PROJECT", title: "Prefer tabs", content: "The team prefers tabs.", importance: "HIGH", tags: ["style", "team"], draft: true,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reports a created memory and keeps the dialog open with the server's reason on failure", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubApi({
      commands: {
        knowledge_create_memory: () => {
          attempt += 1;
          return attempt === 1 ? rejected("content looks like a secret", 400, "invalid_request") : executed({ memoryId: "n1", status: "DRAFT", outcome: "CREATED" });
        },
      },
    });
    renderAt("/knowledge/memories?project=p1");
    const dialog = await fill(user);
    await user.click(within(dialog).getByRole("button", { name: "Create memory" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("content looks like a secret");
    await user.click(within(dialog).getByRole("button", { name: "Create memory" }));
    expect(await screen.findByText("The memory was saved with status DRAFT.")).toBeInTheDocument();
  });

  it("is not offered to a viewer", async () => {
    stubApi();
    renderAt("/knowledge/memories?project=p1", { capabilities: ["view"], role: "viewer" });
    await screen.findByText("Use PostgreSQL");
    expect(screen.queryByRole("button", { name: "Create memory" })).not.toBeInTheDocument();
  });
});

describe("project knowledge", () => {
  it("confirms a draft candidate, sends the right command and refreshes the list", async () => {
    const user = userEvent.setup();
    let confirmed = false;
    const draft = makeMemory({ memoryId: "d1", title: "Candidate: use Redis", status: "DRAFT", confidence: "AGENT_GENERATED" });
    const calls = stubApi({
      candidates: () => (confirmed ? [] : [draft]),
      commands: { knowledge_confirm_memory: () => { confirmed = true; return executed({ memoryId: "d1", status: "ACTIVE" }); } },
    });
    renderAt("/knowledge/project?project=p1");
    expect(await screen.findByText("Candidate: use Redis")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("No candidate memories waiting for review.")).toBeInTheDocument();
    expect(commandCalls(calls, "knowledge_confirm_memory")[0]?.body).toEqual({ memoryId: "d1" });
  });

  it("archives a candidate", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      candidates: [makeMemory({ memoryId: "d1", title: "Candidate: use Redis", status: "DRAFT" })],
      commands: { knowledge_archive_memory: () => executed() },
    });
    renderAt("/knowledge/project?project=p1");
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(commandCalls(calls, "knowledge_archive_memory")).toHaveLength(1));
    expect(commandCalls(calls, "knowledge_archive_memory")[0]?.body).toEqual({ memoryId: "d1" });
  });

  it("shows the server's honest text when discovery has no readable source", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { knowledge_discover_project: () => rejected("no readable source for project p1", 409) } });
    renderAt("/knowledge/project?project=p1");
    await user.click(await screen.findByRole("button", { name: "Discover project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no readable source for project p1");
    expect(commandCalls(calls, "knowledge_discover_project")[0]?.body).toEqual({ projectId: "p1" });
  });

  it("summarises a refresh run", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      commands: { knowledge_refresh_project: () => executed({ projectId: "p1", source: "workspace", topics: 4, documents: 6, unchanged: 2, staleMarked: 1, conflicts: 1, truncated: true, unavailable: ["secrets.env"] }) },
    });
    renderAt("/knowledge/project?project=p1");
    await user.click(await screen.findByRole("button", { name: "Refresh project knowledge" }));
    const summary = await screen.findByTestId("project-run-summary");
    expect(summary).toHaveTextContent("Source: workspace");
    expect(summary).toHaveTextContent("4 topics, 6 documents read, 2 unchanged.");
    expect(summary).toHaveTextContent("1 marked potentially stale, 1 conflicts found.");
    expect(summary).toHaveTextContent("Not readable: secrets.env");
    expect(commandCalls(calls, "knowledge_refresh_project")[0]?.body).toEqual({ projectId: "p1" });
  });

  it("lists key memories grouped by type and hides commands from viewers", async () => {
    const calls = stubApi({ memories: [makeMemory(), makeMemory({ memoryId: "m4", type: "ARCHITECTURAL", title: "Hexagonal layout" })] });
    renderAt("/knowledge/project?project=p1", { capabilities: ["view"], role: "viewer" });
    expect(await screen.findByText("Hexagonal layout")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Architectural" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Project" })).toBeInTheDocument();
    expect(last(apiCalls(calls, "/api/knowledge/memories")).params.get("status")).toBe("ACTIVE");
    expect(screen.queryByRole("button", { name: "Discover project" })).not.toBeInTheDocument();
  });
});

describe("preview context", () => {
  it("requests the context for the project, question and role and renders budget and exclusions", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ context: makeContext() });
    renderAt("/knowledge/memories?project=p1");
    await user.type(await screen.findByLabelText("Question"), "How do we store invoices?");
    await user.selectOptions(screen.getByLabelText("Agent role"), "security");
    await user.click(screen.getByRole("button", { name: "Preview context" }));
    const result = await screen.findByTestId("context-result");
    const params = last(apiCalls(calls, "/api/knowledge/context")).params;
    expect(Object.fromEntries(params.entries())).toEqual({ projectId: "p1", q: "How do we store invoices?", role: "security" });
    expect(within(result).getByText("1000 of 4000 characters used (25%)")).toBeInTheDocument();
    expect(within(result).getByText(/2 memories excluded \(over budget: 1, not relevant: 1\)/)).toBeInTheDocument();
    expect(within(result).getByText("All services use PostgreSQL.")).toBeInTheDocument();
    expect(within(result).getByText("Source: mem:m1 v1")).toBeInTheDocument();
    expect(within(result).getByText("Why: matches billing")).toBeInTheDocument();
    expect(within(result).getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.queryByTestId("context-conflict-banner")).not.toBeInTheDocument();
  });

  it("shows a conflict banner when the package reports a knowledge conflict", async () => {
    const user = userEvent.setup();
    stubApi({ context: makeContext({ status: "KNOWLEDGE_CONFLICT_DETECTED", conflicts: [makeConflict()] }) });
    renderAt("/knowledge/project?project=p1");
    await user.type(await screen.findByLabelText("Question"), "database?");
    await user.click(screen.getByRole("button", { name: "Preview context" }));
    const banner = await screen.findByTestId("context-conflict-banner");
    expect(banner).toHaveTextContent("Knowledge conflict detected");
    expect(banner).toHaveTextContent("1 conflicts affect this question");
    expect(banner).toHaveTextContent("database: Use PostgreSQL / Use MySQL");
  });

  it("shows the error when the preview fails", async () => {
    const user = userEvent.setup();
    stubApi({ context: 400 });
    renderAt("/knowledge/project?project=p1");
    await user.type(await screen.findByLabelText("Question"), "x");
    await user.click(screen.getByRole("button", { name: "Preview context" }));
    expect(await screen.findByText("context failed")).toBeInTheDocument();
  });
});

describe("documents", () => {
  const doc = { projectId: "p1", ref: "docs/architecture.md", ingestedAt: "2026-05-01T10:00:00.000Z", chunks: 5, active: true, potentiallyStale: true, tags: ["arch"] };

  it("lists ingested documents with their state", async () => {
    stubApi({ documents: [doc] });
    renderAt("/knowledge/documents?project=p1");
    const table = await screen.findByRole("table", { name: "Ingested documents" });
    expect(within(table).getByText("docs/architecture.md")).toBeInTheDocument();
    expect(within(table).getByText("5")).toBeInTheDocument();
    expect(within(table).getByText("Active")).toBeInTheDocument();
    expect(within(table).getByText("Potentially stale")).toBeInTheDocument();
    expect(within(table).getByText("arch")).toBeInTheDocument();
  });

  it("ingests pasted text and displays the report", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      commands: {
        knowledge_ingest_document: () => executed({ ref: "docs/new.md", status: "ingested", chunks: 3, created: ["a", "b"], reinforced: ["c"], archived: [], staleMarked: ["z"], redacted: 2, steps: ["split into 3 chunks", "redacted 2 secrets"] }),
      },
    });
    renderAt("/knowledge/documents?project=p1");
    const ingest = await screen.findByRole("button", { name: "Ingest document" });
    expect(ingest).toBeDisabled();
    await user.type(screen.getByLabelText("Path or reference"), "docs/new.md");
    await user.type(screen.getByLabelText("Document text"), "Hello world");
    await user.click(ingest);
    const report = await screen.findByTestId("ingest-report");
    expect(commandCalls(calls, "knowledge_ingest_document")[0]?.body).toEqual({ projectId: "p1", ref: "docs/new.md", text: "Hello world" });
    expect(report).toHaveTextContent("Ingest report for docs/new.md");
    expect(report).toHaveTextContent("Ingested");
    expect(report).toHaveTextContent("3 chunks");
    expect(report).toHaveTextContent("2 redacted");
    expect(report).toHaveTextContent("1 marked stale");
    expect(report).toHaveTextContent("2 memories created");
    expect(report).toHaveTextContent("1 memories reinforced");
    expect(report).toHaveTextContent("redacted 2 secrets");
  });

  it("shows why a document was skipped", async () => {
    const user = userEvent.setup();
    stubApi({
      commands: { knowledge_ingest_document: () => executed({ ref: "big.pdf", status: "skipped", reason: "PDF text extraction is not available", chunks: 0, created: [], reinforced: [], archived: [], staleMarked: [], redacted: 0, steps: [] }) },
    });
    renderAt("/knowledge/documents?project=p1");
    await user.type(await screen.findByLabelText("Path or reference"), "big.pdf");
    await user.type(screen.getByLabelText("Document text"), "x");
    await user.click(screen.getByRole("button", { name: "Ingest document" }));
    const report = await screen.findByTestId("ingest-report");
    expect(report).toHaveTextContent("Skipped");
    expect(report).toHaveTextContent("PDF text extraction is not available");
  });

  it("hides the ingest form from viewers", async () => {
    stubApi({ documents: [doc] });
    renderAt("/knowledge/documents?project=p1", { capabilities: ["view"], role: "viewer" });
    await screen.findByRole("table", { name: "Ingested documents" });
    expect(screen.queryByRole("button", { name: "Ingest document" })).not.toBeInTheDocument();
  });
});

describe("decisions", () => {
  it("shows architectural decisions as a timeline with the supersession chain", async () => {
    const old = makeMemory({ memoryId: "d2", type: "ARCHITECTURAL", title: "Monolith", status: "SUPERSEDED", createdAt: "2026-01-01T00:00:00.000Z" });
    const current = makeMemory({ memoryId: "d3", type: "ARCHITECTURAL", title: "Modular monolith", importance: "CRITICAL", createdAt: "2026-03-01T00:00:00.000Z" });
    stubApi({
      decisions: [current, old],
      details: { d2: makeDetail({ supersededBy: { memoryId: "d3", title: "Modular monolith", status: "ACTIVE" } }, { memoryId: "d2", status: "SUPERSEDED" }) },
    });
    renderAt("/knowledge/decisions?project=p1");
    const timeline = await screen.findByRole("list", { name: "Architectural decisions" });
    const items = within(timeline).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Monolith");
    expect(items[1]).toHaveTextContent("Modular monolith");
    expect(items[1]).toHaveTextContent("Critical");
    const note = await within(items[0] as HTMLElement).findByTestId("chain-note");
    expect(note).toHaveTextContent("Replaced by");
    expect(within(note).getByRole("link", { name: "Modular monolith" })).toHaveAttribute("href", "/knowledge/memories/d3?project=p1");
  });

  it("explains an empty timeline", async () => {
    stubApi({ decisions: [] });
    renderAt("/knowledge/decisions?project=p1");
    expect(await screen.findByText("No decisions recorded")).toBeInTheDocument();
  });
});

describe("conflicts", () => {
  const open = async (extra: Parameters<typeof stubApi>[0] = {}, options: Parameters<typeof renderAt>[1] = {}) => {
    const calls = stubApi({ conflicts: [makeConflict()], commands: { knowledge_resolve_conflict: () => executed() }, ...extra });
    renderAt("/knowledge/conflicts?project=p1", options);
    await screen.findByText("Disagreement about: database");
    return calls;
  };

  it("shows both memories, their values and the server's suggestion with links to detail", async () => {
    await open();
    expect(screen.getByRole("link", { name: "Use PostgreSQL" })).toHaveAttribute("href", "/knowledge/memories/m1?project=p1");
    expect(screen.getByRole("link", { name: "Use MySQL" })).toHaveAttribute("href", "/knowledge/memories/m2?project=p1");
    expect(screen.getByText("PostgreSQL", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByTestId("conflict-suggestion")).toHaveTextContent("Keep the newer memory and supersede the older one.");
  });

  it("never resolves without an explicit confirmation", async () => {
    const user = userEvent.setup();
    const calls = await open();
    await user.click(screen.getByRole("button", { name: "Keep Use PostgreSQL and supersede the other" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Keep \"Use PostgreSQL\". The other memory will be marked superseded.");
    expect(commandCalls(calls, "knowledge_resolve_conflict")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(commandCalls(calls, "knowledge_resolve_conflict")).toHaveLength(0);
  });

  it("sends SUPERSEDED_OTHER with the winner after confirming", async () => {
    const user = userEvent.setup();
    const calls = await open();
    await user.click(screen.getByRole("button", { name: "Keep Use PostgreSQL and supersede the other" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep this one" }));
    await waitFor(() => expect(commandCalls(calls, "knowledge_resolve_conflict")).toHaveLength(1));
    expect(commandCalls(calls, "knowledge_resolve_conflict")[0]?.body).toEqual({ conflictId: "c1", resolution: "SUPERSEDED_OTHER", winner: "m1" });
    expect(await screen.findByText("The conflict was resolved.")).toBeInTheDocument();
  });

  it("sends ARCHIVED_OTHER for the second memory, with an optional note", async () => {
    const user = userEvent.setup();
    const calls = await open();
    await user.click(screen.getByRole("button", { name: "Keep Use MySQL and archive the other" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Note (optional)"), "newer decision");
    await user.click(within(dialog).getByRole("button", { name: "Archive the other" }));
    await waitFor(() => expect(commandCalls(calls, "knowledge_resolve_conflict")).toHaveLength(1));
    expect(commandCalls(calls, "knowledge_resolve_conflict")[0]?.body).toEqual({ conflictId: "c1", resolution: "ARCHIVED_OTHER", winner: "m2", note: "newer decision" });
  });

  it("sends KEPT_BOTH without a winner", async () => {
    const user = userEvent.setup();
    const calls = await open();
    await user.click(screen.getByRole("button", { name: "Keep both" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(commandCalls(calls, "knowledge_resolve_conflict")).toHaveLength(1));
    expect(commandCalls(calls, "knowledge_resolve_conflict")[0]?.body).toEqual({ conflictId: "c1", resolution: "KEPT_BOTH" });
  });

  it("shows the server's reason in the dialog when resolution is refused", async () => {
    const user = userEvent.setup();
    await open({ commands: { knowledge_resolve_conflict: () => rejected("conflict c1 is already resolved", 409) } });
    await user.click(screen.getByRole("button", { name: "Keep both" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Keep both" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("conflict c1 is already resolved");
  });

  it("offers no resolution to a viewer", async () => {
    await open({}, { capabilities: ["view"], role: "viewer" });
    expect(screen.queryByRole("button", { name: "Keep both" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Keep Use PostgreSQL/ })).not.toBeInTheDocument();
  });

  it("says when there are no conflicts", async () => {
    stubApi({ conflicts: [] });
    renderAt("/knowledge/conflicts?project=p1");
    expect(await screen.findByText("No conflicts")).toBeInTheDocument();
  });
});

describe("knowledge graph", () => {
  const open = async (graph = makeGraph()) => {
    const calls = stubApi({ graph });
    renderAt("/knowledge/graph?project=p1");
    await screen.findAllByTestId("graph-node");
    return calls;
  };
  const edgeTypes = () => screen.getAllByTestId("graph-edge").map((e) => e.getAttribute("data-edge-type"));

  it("renders nodes and relationships from the API (memory nodes included)", async () => {
    const calls = await open();
    expect(screen.getAllByTestId("graph-node")).toHaveLength(5);
    expect(screen.getAllByTestId("graph-edge")).toHaveLength(4);
    expect(screen.getByTestId("graph-counts")).toHaveTextContent("5 nodes, 4 relationships shown");
    const request = last(apiCalls(calls, "/api/knowledge/graph")).params;
    expect(request.get("projectId")).toBe("p1");
    expect(request.get("memories")).toBe("1");
    expect(screen.getByRole("img", { name: "Graph of 5 nodes and 4 relationships" })).toBeInTheDocument();
  });

  it("selects a node, shows its relations and follows a relation to the neighbour", async () => {
    const user = userEvent.setup();
    await open();
    expect(screen.getByText("Select a node to see what it is connected to.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "React (Technology)" }));
    const inspector = screen.getByTestId("graph-inspector");
    expect(within(inspector).getByText("Relations (1)")).toBeInTheDocument();
    expect(within(inspector).getByText("tech:react")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "React (Technology)" })).toHaveAttribute("data-selected", "true");
    await user.click(within(inspector).getByRole("button", { name: "Go to Money Mind" }));
    expect(within(inspector).getByText("Relations (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Money Mind (Project)" })).toHaveAttribute("data-selected", "true");
    // only the edges of the selected node get a visible label
    expect(document.querySelectorAll(".kn-edge__label")).toHaveLength(2);
  });

  it("links a memory node to its detail page", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Use PostgreSQL (Memory)" }));
    expect(within(screen.getByTestId("graph-inspector")).getByRole("link", { name: "Open memory" })).toHaveAttribute("href", "/knowledge/memories/m1?project=p1");
  });

  it("filters by relation type", async () => {
    const user = userEvent.setup();
    await open();
    expect(edgeTypes().sort()).toEqual(["BELONGS_TO", "DEPENDS_ON", "USES", "USES"]);
    await user.click(screen.getByRole("checkbox", { name: "uses (2)" }));
    expect(edgeTypes().sort()).toEqual(["BELONGS_TO", "DEPENDS_ON"]);
    expect(screen.getByTestId("graph-counts")).toHaveTextContent("5 nodes, 2 relationships shown");
    await user.click(screen.getByRole("checkbox", { name: "uses (2)" }));
    expect(edgeTypes()).toHaveLength(4);
  });

  it("searches nodes, highlights matches and centres on the chosen one", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByLabelText("Find a node"), "postg");
    const matches = screen.getByTestId("graph-matches");
    expect(matches).toHaveTextContent("2 matching nodes");
    expect(document.querySelectorAll('[data-match="true"]')).toHaveLength(2);
    await user.click(within(matches).getByRole("button", { name: "PostgreSQL" }));
    expect(screen.getByRole("button", { name: "PostgreSQL (Technology)" })).toHaveAttribute("data-selected", "true");
    await user.clear(screen.getByLabelText("Find a node"));
    await user.type(screen.getByLabelText("Find a node"), "zzz");
    expect(screen.getByText("No node matches.")).toBeInTheDocument();
  });

  it("zooms and resets with buttons, wheel and keyboard", async () => {
    const user = userEvent.setup();
    await open();
    const zoom = () => screen.getByTestId("graph-zoom").textContent;
    expect(zoom()).toBe("100%");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toBe("120%");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom()).toBe("100%");
    fireEvent.wheel(screen.getByRole("img", { name: /Graph of/ }), { deltaY: -120 });
    await waitFor(() => expect(zoom()).toBe("115%"));
    const canvas = screen.getByRole("group", { name: "Knowledge graph canvas" });
    canvas.focus();
    await user.keyboard("+");
    expect(zoom()).toBe("138%");
    await user.keyboard("-");
    await user.keyboard("0");
    expect(zoom()).toBe("100%");
    const transform = () => document.querySelector(".kn-graph__svg > g")?.getAttribute("transform");
    const before = transform();
    await user.keyboard("{ArrowRight}");
    expect(transform()).not.toBe(before);
  });

  it("offers an accessible list view with tables of nodes and relationships", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByTestId("graph-node")).not.toBeInTheDocument();
    const nodes = screen.getByRole("table", { name: "Nodes" });
    expect(within(nodes).getAllByRole("row")).toHaveLength(6);
    const edges = screen.getByRole("table", { name: "Relationships" });
    expect(within(edges).getAllByRole("row")).toHaveLength(5);
    expect(within(edges).getByText("depends on")).toBeInTheDocument();
    await user.click(within(nodes).getByRole("button", { name: "Inspect React" }));
    expect(within(screen.getByTestId("graph-inspector")).getByText("Relations (1)")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "uses (2)" }));
    expect(within(screen.getByRole("table", { name: "Relationships" })).getAllByRole("row")).toHaveLength(3);
  });

  it("warns when the graph was truncated and handles an empty graph and API errors", async () => {
    await open(makeGraph({ truncated: true }));
    expect(screen.getByText("This graph is large. Only part of it is shown.")).toBeInTheDocument();
  });

  it("explains an empty graph", async () => {
    stubApi({ graph: makeGraph({ nodes: [], edges: [] }) });
    renderAt("/knowledge/graph?project=p1");
    expect(await screen.findByText("The graph is empty")).toBeInTheDocument();
  });

  it("shows the API error", async () => {
    stubApi({ graph: 500 });
    renderAt("/knowledge/graph?project=p1");
    expect(await screen.findByRole("alert")).toHaveTextContent("graph failed");
  });
});

describe("settings", () => {
  it("explains write policy and retention, and lists the capabilities", async () => {
    stubApi();
    renderAt("/knowledge/settings?project=p1");
    expect(await screen.findByRole("heading", { name: "Write policy" })).toBeInTheDocument();
    expect(screen.getByText(/Permanent memories stay until someone archives or revokes them/)).toBeInTheDocument();
    expect(screen.getByText(/Temporary memories carry an expiry date/)).toBeInTheDocument();
    expect(await screen.findByText("keyword+similarity")).toBeInTheDocument();
  });

  it("lets an administrator apply retention after confirming", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ commands: { knowledge_apply_retention: () => executed({ archived: 3 }) } });
    renderAt("/knowledge/settings?project=p1", { role: "admin" });
    await user.click(await screen.findByRole("button", { name: "Apply retention now" }));
    expect(commandCalls(calls, "knowledge_apply_retention")).toHaveLength(0);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply retention now" }));
    expect(await screen.findByText("Retention applied: 3 memories archived.")).toBeInTheDocument();
    expect(commandCalls(calls, "knowledge_apply_retention")[0]?.body).toEqual({});
  });

  it("does not offer retention to a non-admin", async () => {
    stubApi();
    renderAt("/knowledge/settings?project=p1", { role: "operator" });
    expect(await screen.findByText("Only an administrator can apply retention manually.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply retention now" })).not.toBeInTheDocument();
  });

  it("shows a refusal from the server", async () => {
    const user = userEvent.setup();
    stubApi({ commands: { knowledge_apply_retention: () => rejected("retention is already running", 409) } });
    renderAt("/knowledge/settings?project=p1", { role: "admin" });
    await user.click(await screen.findByRole("button", { name: "Apply retention now" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Apply retention now" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("retention is already running");
  });
});

describe("overview errors and capability notes", () => {
  it("hides the embeddings note when embeddings are configured", async () => {
    stubApi({ overview: makeOverview({ capabilities: { retrieval: "hybrid", embeddings: true, pdfExtraction: true, canWrite: false } }) });
    renderAt("/knowledge?project=p1");
    await screen.findByRole("heading", { name: "Knowledge health" });
    expect(screen.queryByText(/no embedding model configured/)).not.toBeInTheDocument();
    expect(screen.getByText("Knowledge is read-only here")).toBeInTheDocument();
  });

  it("says there are no findings", async () => {
    stubApi({ overview: makeOverview({ findings: [] }) });
    renderAt("/knowledge?project=p1");
    expect(await screen.findByText("No findings")).toBeInTheDocument();
  });
});
