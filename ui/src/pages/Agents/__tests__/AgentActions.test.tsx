import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test/renderWithProviders";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { AgentView } from "../../../api/contracts";
import { AgentActions } from "../components/AgentActions";
import { toAgentListItem } from "../agentsView";

function mkAgent(over: Partial<AgentView> = {}): AgentView {
  return {
    agentId: "a1",
    name: "Research Agent",
    role: "research",
    capabilities: [],
    status: "available",
    enabled: true,
    allowedProjects: ["*"],
    stats: {
      taskCount: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      successRate: null,
    },
    ...over,
  };
}

function makeApi(handler: { error?: ApiError }): {
  client: ApiClient;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn(async () => {
    if (handler.error) throw handler.error;
    return {
      data: {
        command: "disable_agent",
        outcome: "executed",
        ok: true,
        reason: "agent disabled",
        correlationId: "c",
        auditEventId: "e1",
        timestamp: "2026-09-01T00:00:00.000Z",
      },
      status: 200,
      correlationId: "c",
    };
  });
  const client = {
    get: vi.fn(),
    post,
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient;
  return { client, post };
}

/** Open the dialog and return it, disambiguated from the trigger button that
 * shares its accessible name. */
async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: "Disable agent" }));
  return screen.findByRole("dialog");
}

describe("AgentActions", () => {
  it("shows the governed action disabled (not hidden) for a read-only role, with an explanation", async () => {
    const { client, post } = makeApi({});
    renderWithProviders(
      <AgentActions agent={toAgentListItem(mkAgent())} onChanged={() => {}} />,
      { apiClient: client, auth: { role: "viewer" } },
    );
    const button = screen.getByRole("button", { name: "Disable agent" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    // native `disabled` is intentionally NOT set — the button stays
    // focusable so its keyboard-accessible Tooltip explanation still works.
    expect(button).not.toBeDisabled();

    await userEvent.click(button);
    expect(post).not.toHaveBeenCalled();

    await userEvent.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "You do not have permission to operate this agent.",
    );
  });

  it("opens a confirmation dialog with real lifecycle copy, then submits and refreshes", async () => {
    const { client, post } = makeApi({});
    const onChanged = vi.fn();
    renderWithProviders(
      <AgentActions agent={toAgentListItem(mkAgent())} onChanged={onChanged} />,
      { apiClient: client, auth: { role: "admin" } },
    );

    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("Disable Research Agent?");
    expect(dialog).toHaveTextContent(/running tasks are unaffected/i);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Disable agent" }),
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      "/commands/disable-agent",
      expect.objectContaining({ agentId: "a1" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("disables the controls while submitting and never sends a duplicate request", async () => {
    let resolvePost: (() => void) | undefined;
    const post = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePost = () =>
            resolve({
              data: {
                command: "disable_agent",
                outcome: "executed",
                ok: true,
                reason: "",
                correlationId: "c",
                auditEventId: "e1",
                timestamp: "2026-09-01T00:00:00.000Z",
              },
              status: 200,
              correlationId: "c",
            });
        }),
    );
    const client = {
      get: vi.fn(),
      post,
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient;

    renderWithProviders(
      <AgentActions agent={toAgentListItem(mkAgent())} onChanged={() => {}} />,
      { apiClient: client, auth: { role: "admin" } },
    );

    const dialog = await openDialog();
    const confirmBtn = within(dialog).getByRole("button", {
      name: "Disable agent",
    });
    await userEvent.click(confirmBtn);

    // still submitting: cancel is disabled, a second click does not re-submit
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled(),
    );
    await userEvent.click(confirmBtn);
    expect(post).toHaveBeenCalledTimes(1);

    resolvePost?.();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a specific message and does not close on a forbidden (403) response", async () => {
    const { client } = makeApi({
      error: new ApiError({ kind: "forbidden", message: "no", status: 403 }),
    });
    renderWithProviders(
      <AgentActions agent={toAgentListItem(mkAgent())} onChanged={() => {}} />,
      { apiClient: client, auth: { role: "admin" } },
    );
    const dialog = await openDialog();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Disable agent" }),
    );
    expect(
      await within(dialog).findByText(
        "You are not authorized to perform this action.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a session-expired message on an unauthenticated (401) response", async () => {
    const { client } = makeApi({
      error: new ApiError({
        kind: "unauthorized",
        message: "no",
        status: 401,
      }),
    });
    renderWithProviders(
      <AgentActions agent={toAgentListItem(mkAgent())} onChanged={() => {}} />,
      { apiClient: client, auth: { role: "admin" } },
    );
    const dialog = await openDialog();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Disable agent" }),
    );
    expect(
      await within(dialog).findByText(
        "Your session has expired. Sign in again to continue.",
      ),
    ).toBeInTheDocument();
  });

  it("on a conflict (409) it refreshes the agent and explains why, without pretending success", async () => {
    const { client } = makeApi({
      error: new ApiError({ kind: "conflict", message: "no", status: 409 }),
    });
    const onChanged = vi.fn();
    renderWithProviders(
      <AgentActions agent={toAgentListItem(mkAgent())} onChanged={onChanged} />,
      { apiClient: client, auth: { role: "admin" } },
    );
    const dialog = await openDialog();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Disable agent" }),
    );
    expect(
      await within(dialog).findByText(/changed since the page loaded/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // dialog stays open for the operator to review, not silently closed
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
