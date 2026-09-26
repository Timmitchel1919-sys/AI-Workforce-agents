import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.fn();
vi.mock("../../../features/spatial-graph/hooks/useSpatialGraph", () => ({
  useSpatialGraph: (...a: unknown[]) => hook(...a),
}));
const projectsHook = vi.fn();
vi.mock("../../../features/executionPlans", () => ({
  useProjects: () => projectsHook(),
}));
vi.mock("../../../features/spatial-graph/components/SpatialGraphView", () => ({
  SpatialGraphView: () => <div data-testid="mock-canvas" />,
}));

import SpatialGraphPage from "../SpatialGraphPage";
import { makeProjection } from "../../../features/spatial-graph/__tests__/fixtures";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/graph" element={<SpatialGraphPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SpatialGraphPage mode switching", () => {
  beforeEach(() => {
    hook.mockReset();
    projectsHook.mockReset();
    projectsHook.mockReturnValue({ status: "ready", projects: [{ projectId: "p1" }], refetch: vi.fn() });
    hook.mockImplementation((_p: string, o: { mode: string }) => ({
      graph: makeProjection({ mode: o.mode as never }),
      loading: false,
      error: null,
    }));
  });

  it("defaults to WORKFORCE and treats an invalid ?mode as WORKFORCE", () => {
    renderAt("/graph?mode=NOPE");
    expect(hook).toHaveBeenLastCalledWith("p1", { mode: "WORKFORCE", rootNodeId: undefined });
    expect(screen.getByRole("radio", { name: "Workforce" })).toHaveAttribute("aria-checked", "true");
  });

  it("reads a valid mode from the URL", () => {
    renderAt("/graph?mode=DEPENDENCY");
    expect(hook).toHaveBeenLastCalledWith("p1", { mode: "DEPENDENCY", rootNodeId: undefined });
    expect(screen.getByRole("radio", { name: "Dependencies" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches mode without remounting, updates the URL and scopes to a valid selected root", async () => {
    renderAt("/graph");
    const canvas = screen.getByTestId("mock-canvas");
    await userEvent.click(screen.getByRole("button", { name: /Agent: Builder/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Agents" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/graph?mode=AGENT");
    expect(hook).toHaveBeenLastCalledWith("p1", { mode: "AGENT", rootNodeId: "agent-a1" });
    expect(screen.getByTestId("mock-canvas")).toBe(canvas); // same DOM node: no remount / reload
  });

  it("drops rootNodeId when the selection is not valid for the new mode", async () => {
    renderAt("/graph");
    await userEvent.click(screen.getByRole("button", { name: /Task: Write API/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Agents" }));
    expect(hook).toHaveBeenLastCalledWith("p1", { mode: "AGENT", rootNodeId: undefined });
    await userEvent.click(screen.getByRole("radio", { name: "Dependencies" }));
    // a task is valid as the DEPENDENCY root
    expect(hook).toHaveBeenLastCalledWith("p1", { mode: "DEPENDENCY", rootNodeId: "task-t1" });
    await userEvent.click(screen.getByRole("radio", { name: "Environments" }));
    expect(hook).toHaveBeenLastCalledWith("p1", { mode: "ENVIRONMENT", rootNodeId: undefined });
  });

  it("keeps the previous graph (no spinner-only view) while loading", () => {
    hook.mockReturnValue({ graph: makeProjection(), loading: true, error: null });
    renderAt("/graph");
    expect(screen.getByTestId("mock-canvas")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
  });
});

describe("SpatialGraphPage project-list states", () => {
  beforeEach(() => {
    hook.mockReset();
    hook.mockReturnValue({ graph: null, loading: false, error: null });
    projectsHook.mockReset();
  });

  it("shows the real empty state only when the project list is genuinely empty", () => {
    projectsHook.mockReturnValue({ status: "empty", projects: [], refetch: vi.fn() });
    renderAt("/graph");
    expect(screen.getByText("No Projects")).toBeInTheDocument();
  });

  it.each([
    ["forbidden", "Project access denied"],
    ["unauthenticated", "Sign-in required"],
    ["error", "Could not load projects"],
    ["not_found", "Could not load projects"],
  ])("does not mask a %s project-list failure as 'No Projects'", (status, title) => {
    projectsHook.mockReturnValue({ status, projects: [], refetch: vi.fn() });
    renderAt("/graph");
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByText("No Projects")).not.toBeInTheDocument();
  });

  it("offers a retry for transient failures but not for permission errors", async () => {
    const refetch = vi.fn();
    projectsHook.mockReturnValue({ status: "error", projects: [], refetch });
    const { unmount } = renderAt("/graph");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    unmount();
    projectsHook.mockReturnValue({ status: "forbidden", projects: [], refetch });
    renderAt("/graph");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });
});
