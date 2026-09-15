import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { WorkflowView } from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { WorkflowsPage } from "../WorkflowsPage";

const workflows: WorkflowView[] = [
  {
    workflowId: "workflow-1",
    name: "Money Mind review",
    description: "Review the current financial model",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: {
      completed: 1,
      total: 3,
      failed: 0,
      blocked: 0,
      fraction: 1 / 3,
    },
    pendingApprovals: 0,
    participatingAgents: ["research-agent", "qa-agent"],
    stages: [
      {
        specId: "research",
        type: "research",
        description: "Research",
        status: "running",
        retryCount: 0,
      },
    ],
    updatedAt: "2026-09-14T10:00:00.000Z",
  },
  {
    workflowId: "workflow-2",
    name: "AIMS release review",
    description: "Validate release readiness",
    projectId: "aims",
    status: "completed",
    paused: false,
    progress: { completed: 1, total: 1, failed: 0, blocked: 0, fraction: 1 },
    pendingApprovals: 0,
    participatingAgents: [],
    stages: [],
    updatedAt: "2026-09-14T09:00:00.000Z",
  },
];

function makeApi(
  error?: ApiError,
  data: WorkflowView[] = workflows,
): ApiClient {
  const get = vi.fn(async (path: string) => {
    if (path === "/workflows") {
      if (error) throw error;
      return { data, status: 200, correlationId: "workflows" };
    }
    return { data: { status: "ok" }, status: 200, correlationId: "other" };
  });
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as ApiClient;
}

describe("WorkflowsPage", () => {
  it("renders actual workflow metadata, summary, and detail navigation", async () => {
    renderWithProviders(<WorkflowsPage />, { apiClient: makeApi() });

    expect(
      await screen.findByRole("heading", { name: "Workflows" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Total workflows")).toBeInTheDocument();
    expect(screen.getByText("Money Mind review")).toHaveAttribute(
      "href",
      "/workflows/workflow-1",
    );
    expect(
      screen.getByRole("heading", { name: "Workflow registry" }),
    ).toBeInTheDocument();
  });

  it("filters loaded registry data without another Control Plane request", async () => {
    const client = makeApi();
    renderWithProviders(<WorkflowsPage />, { apiClient: client });
    await screen.findByText("Money Mind review");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search workflows" }),
      { target: { value: "aims" } },
    );
    expect(screen.queryByText("Money Mind review")).not.toBeInTheDocument();
    expect(screen.getByText("AIMS release review")).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("distinguishes no data from no filter results", async () => {
    renderWithProviders(<WorkflowsPage />, {
      apiClient: makeApi(undefined, []),
    });
    expect(await screen.findByText("No workflows found")).toBeInTheDocument();
  });

  it("shows the restricted state for an unauthorized registry response", async () => {
    renderWithProviders(<WorkflowsPage />, {
      apiClient: makeApi(
        new ApiError({ kind: "forbidden", message: "restricted", status: 403 }),
      ),
    });
    expect(
      await screen.findByText("You don't have access to the workflow registry"),
    ).toBeInTheDocument();
  });
});
