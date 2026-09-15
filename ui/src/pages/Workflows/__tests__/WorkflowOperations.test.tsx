import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { WorkflowView } from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { WorkflowOperations } from "../components/WorkflowOperations";

function workflow(overrides: Partial<WorkflowView> = {}): WorkflowView {
  return {
    workflowId: "workflow-1",
    name: "Money Mind review",
    description: "Review current state",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: { completed: 0, total: 1, failed: 0, blocked: 0, fraction: 0 },
    pendingApprovals: 0,
    participatingAgents: ["research-agent"],
    stages: [],
    updatedAt: "2026-09-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeApi(error?: ApiError): {
  client: ApiClient;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn(async (path: string) => {
    if (error) throw error;
    return {
      data: {
        command: path.includes("pause")
          ? "pause_workflow"
          : path.includes("resume")
            ? "resume_workflow"
            : "cancel_workflow",
        outcome: "executed",
        ok: true,
        reason: "workflow operation accepted",
        correlationId: "corr-1",
        auditEventId: "audit-1",
        timestamp: "2026-09-15T10:01:00.000Z",
        details: {},
      },
      status: 200,
      correlationId: "corr-1",
    };
  });
  return {
    client: {
      get: vi.fn(),
      post,
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient,
    post,
  };
}

describe("WorkflowOperations", () => {
  it("submits pause through the Control Plane then refreshes authoritative data", async () => {
    const { client, post } = makeApi();
    const onChanged = vi.fn(async () => {});
    renderWithProviders(
      <WorkflowOperations workflow={workflow()} onChanged={onChanged} />,
      { apiClient: client, auth: { role: "operator" } },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Pause workflow" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Pause workflow-1?");
    await userEvent.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Awaiting review",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Pause workflow" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/commands/pause-workflow", {
        workflowId: "workflow-1",
        reason: "Awaiting review",
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("places cancel behind More actions and requires confirmation", async () => {
    const { client, post } = makeApi();
    renderWithProviders(
      <WorkflowOperations workflow={workflow()} onChanged={async () => {}} />,
      { apiClient: client, auth: { role: "operator" } },
    );

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Cancel workflow" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      /may require time to reach a safe terminal state/i,
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel workflow" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/commands/cancel-workflow", {
        workflowId: "workflow-1",
        reason: undefined,
      }),
    );
  });

  it("prevents a duplicate command while the first is pending", async () => {
    let resolvePost: (() => void) | undefined;
    const post = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePost = () =>
            resolve({
              data: {
                command: "pause_workflow",
                outcome: "executed",
                ok: true,
                reason: "paused",
                correlationId: "corr-1",
                auditEventId: "audit-1",
                timestamp: "2026-09-15T10:01:00.000Z",
                details: {},
              },
              status: 200,
              correlationId: "corr-1",
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
      <WorkflowOperations workflow={workflow()} onChanged={async () => {}} />,
      { apiClient: client, auth: { role: "operator" } },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Pause workflow" }),
    );
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Pause workflow",
    });
    await userEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    await userEvent.click(confirm);
    expect(post).toHaveBeenCalledTimes(1);

    resolvePost?.();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps an advisory read-only control visible without submitting it", async () => {
    const { client, post } = makeApi();
    renderWithProviders(
      <WorkflowOperations workflow={workflow()} onChanged={async () => {}} />,
      { apiClient: client, auth: { role: "viewer" } },
    );
    const button = screen.getByRole("button", { name: "Pause workflow" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(post).not.toHaveBeenCalled();
  });

  it("refetches after a Control Plane conflict and does not expose backend details", async () => {
    const { client } = makeApi(
      new ApiError({
        kind: "conflict",
        message: "internal details",
        status: 409,
      }),
    );
    const onChanged = vi.fn(async () => {});
    renderWithProviders(
      <WorkflowOperations workflow={workflow()} onChanged={onChanged} />,
      { apiClient: client, auth: { role: "operator" } },
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pause workflow" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Pause workflow" }),
    );

    expect(
      await within(dialog).findByText(/did not accept this operation/i),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("internal details")).not.toBeInTheDocument();
  });
});
