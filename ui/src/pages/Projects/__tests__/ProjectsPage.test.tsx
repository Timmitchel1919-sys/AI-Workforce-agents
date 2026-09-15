import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../api";
import { ApiError } from "../../../api";
import type { ProjectView } from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { ProjectsPage } from "../ProjectsPage";

const projects: ProjectView[] = [
  {
    projectId: "money-mind",
    displayName: "Money Mind",
    status: "available",
    adapterStatus: "healthy",
    capabilities: [{ operation: "read", description: "Read", action: "read" }],
    connectedAgents: ["research-agent"],
    activeWorkflows: 2,
    recentTaskIds: [],
    recentActivity: [],
  },
  {
    projectId: "aims",
    displayName: "AIMS",
    status: "degraded",
    adapterStatus: "degraded",
    capabilities: [],
    connectedAgents: [],
    activeWorkflows: 0,
    recentTaskIds: [],
    recentActivity: [],
  },
];
function makeApi(error?: ApiError, data: ProjectView[] = projects): ApiClient {
  const get = vi.fn(async (path: string) => {
    if (path === "/projects") {
      if (error) throw error;
      return { data, status: 200, correlationId: "projects" };
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

describe("ProjectsPage", () => {
  it("renders the Control Plane project registry and valid detail navigation", async () => {
    renderWithProviders(<ProjectsPage />, { apiClient: makeApi() });
    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    const moneyMind = await screen.findByRole("link", { name: "Money Mind" });
    expect(screen.getByText("Total projects")).toBeInTheDocument();
    expect(moneyMind).toHaveAttribute("href", "/projects/money-mind");
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
  });
  it("filters loaded projects locally without another Control Plane request", async () => {
    const client = makeApi();
    renderWithProviders(<ProjectsPage />, { apiClient: client });
    await screen.findByText("Money Mind");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search projects" }),
      { target: { value: "aims" } },
    );
    expect(screen.queryByText("Money Mind")).not.toBeInTheDocument();
    expect(screen.getByText("AIMS")).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(1);
  });
  it("renders empty and restricted registry states safely", async () => {
    const { unmount } = renderWithProviders(<ProjectsPage />, {
      apiClient: makeApi(undefined, []),
    });
    expect(await screen.findByText("No projects found")).toBeInTheDocument();
    unmount();
    renderWithProviders(<ProjectsPage />, {
      apiClient: makeApi(
        new ApiError({ kind: "forbidden", message: "restricted", status: 403 }),
      ),
    });
    expect(
      await screen.findByText("You don't have access to the project registry"),
    ).toBeInTheDocument();
  });
});
