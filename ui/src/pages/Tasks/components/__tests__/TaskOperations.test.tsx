import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../../api";
import { ApiError } from "../../../../api";
import type { TaskView } from "../../../../api/contracts";
import { renderWithProviders } from "../../../../test/renderWithProviders";
import { TaskOperations } from "../TaskOperations";

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: "task-1",
    type: "research",
    description: "Inspect a source",
    projectId: "money-mind",
    status: "running",
    priority: "normal",
    dependsOn: [],
    retryCount: 0,
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

function makeApi(error?: ApiError): {
  client: ApiClient;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn(async () => {
    if (error) throw error;
    return {
      data: {
        command: "cancel_task",
        outcome: "executed",
        ok: true,
        reason: "task cancelled",
        correlationId: "corr-1",
        auditEventId: "audit-1",
        timestamp: "2026-09-14T10:01:00.000Z",
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

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
  return screen.findByRole("dialog");
}

describe("TaskOperations", () => {
  it("submits the authorized cancel command, then refreshes authoritative data", async () => {
    const { client, post } = makeApi();
    const onChanged = vi.fn(async () => {});
    renderWithProviders(
      <TaskOperations task={task()} onChanged={onChanged} />,
      {
        apiClient: client,
        auth: { role: "operator" },
      },
    );

    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("Cancel task-1?");
    expect(dialog).toHaveTextContent(/stops only if cancellation is accepted/i);
    await userEvent.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "No longer needed",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel task" }),
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/commands/cancel-task", {
      taskId: "task-1",
      reason: "No longer needed",
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("submits retry only for a failed standalone task", async () => {
    const post = vi.fn(async () => ({
      data: {
        command: "retry_task",
        outcome: "executed",
        ok: true,
        reason: "task re-queued (attempt 1)",
        correlationId: "corr-2",
        auditEventId: "audit-2",
        timestamp: "2026-09-14T10:01:00.000Z",
      },
      status: 200,
      correlationId: "corr-2",
    }));
    const client = {
      get: vi.fn(),
      post,
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient;
    const onChanged = vi.fn(async () => {});
    renderWithProviders(
      <TaskOperations
        task={task({ status: "failed" })}
        onChanged={onChanged}
      />,
      { apiClient: client, auth: { role: "operator" } },
    );

    await userEvent.click(screen.getByRole("button", { name: "Retry task" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Retry task" }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/commands/retry-task", {
        taskId: "task-1",
        reason: undefined,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("prevents duplicate submissions while a command is pending", async () => {
    let resolvePost: (() => void) | undefined;
    const post = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePost = () =>
            resolve({
              data: {
                command: "cancel_task",
                outcome: "executed",
                ok: true,
                reason: "task cancelled",
                correlationId: "corr-1",
                auditEventId: "audit-1",
                timestamp: "2026-09-14T10:01:00.000Z",
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
      <TaskOperations task={task()} onChanged={async () => {}} />,
      {
        apiClient: client,
        auth: { role: "operator" },
      },
    );

    const dialog = await openDialog();
    const confirm = within(dialog).getByRole("button", { name: "Cancel task" });
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Keep task unchanged" }),
      ).toBeDisabled(),
    );
    await userEvent.click(confirm);
    expect(post).toHaveBeenCalledTimes(1);

    resolvePost?.();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps an advisory disabled action visible to a read-only operator", async () => {
    const { client, post } = makeApi();
    renderWithProviders(
      <TaskOperations task={task()} onChanged={async () => {}} />,
      {
        apiClient: client,
        auth: { role: "viewer" },
      },
    );
    const button = screen.getByRole("button", { name: "Cancel task" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    expect(post).not.toHaveBeenCalled();
  });

  it("shows a safe authorization error and preserves the current task display", async () => {
    const { client } = makeApi(
      new ApiError({
        kind: "forbidden",
        message: "server internals",
        status: 403,
      }),
    );
    renderWithProviders(
      <TaskOperations task={task()} onChanged={async () => {}} />,
      {
        apiClient: client,
        auth: { role: "operator" },
      },
    );
    const dialog = await openDialog();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel task" }),
    );

    expect(
      await within(dialog).findByText(
        "You are not authorized to perform this action.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("server internals")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
