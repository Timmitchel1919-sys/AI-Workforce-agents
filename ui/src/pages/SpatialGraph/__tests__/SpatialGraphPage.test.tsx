import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.fn();
vi.mock("../../../features/spatial-graph/hooks/useSpatialGraph", () => ({
  useSpatialGraph: (...a: unknown[]) => hook(...a),
}));

let projectsState: { status: string; projects: Array<{ projectId: string; displayName: string }> } = {
  status: "ready",
  projects: [{ projectId: "p1", displayName: "Apollo" }],
};
vi.mock("../../../features/executionPlans", () => ({
  useProjects: () => ({ ...projectsState, refetch: () => {} }),
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

const twoProjects = [
  { projectId: "p1", displayName: "Apollo" },
  { projectId: "p2", displayName: "Borealis" },
];

describe("SpatialGraphPage", () => {
  beforeEach(() => {
    hook.mockReset();
    projectsState = { status: "ready", projects: [{ projectId: "p1", displayName: "Apollo" }] };
    hook.mockImplementation((p: string, o: { mode: string }) => ({
      graph: makeProjection({ projectId: p, mode: o.mode as never }),
      loading: false,
      error: null,
    }));
  });

  describe("mode switching", () => {
    it("defaults to WORKFORCE and treats an invalid ?mode as WORKFORCE", () => {
      renderAt("/graph?mode=NOPE");
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "WORKFORCE", rootNodeId: undefined });
      expect(screen.getByRole("button", { name: "Workforce" })).toHaveAttribute("aria-pressed", "true");
    });

    it("reads a valid mode from the URL", () => {
      renderAt("/graph?mode=DEPENDENCY");
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "DEPENDENCY", rootNodeId: undefined });
      expect(screen.getByRole("button", { name: "Dependencies" })).toHaveAttribute("aria-pressed", "true");
    });

    it("switches mode without remounting, updates the URL, and fetches once per commit", async () => {
      renderAt("/graph");
      const canvas = screen.getByTestId("mock-canvas");
      await userEvent.click(screen.getByRole("button", { name: /Agent: Builder/ }));
      hook.mockClear();
      screen.getByRole("button", { name: "Workforce" }).focus();
      await userEvent.keyboard("{ArrowRight}{ArrowRight}");
      expect(hook).not.toHaveBeenCalled(); // moving focus does not refetch
      await userEvent.keyboard("{Enter}");
      expect(screen.getByTestId("where")).toHaveTextContent("mode=AGENT");
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "AGENT", rootNodeId: "agent-a1" });
      expect(new Set(hook.mock.calls.map((c) => JSON.stringify(c))).size).toBe(hook.mock.calls.length > 1 ? 2 : 1);
      expect(screen.getByTestId("mock-canvas")).toBe(canvas); // same DOM node: no remount / reload
    });

    it("drops rootNodeId when the selection is not valid for the new mode", async () => {
      renderAt("/graph");
      await userEvent.click(screen.getByRole("button", { name: /Task: Write API/ }));
      await userEvent.click(screen.getByRole("button", { name: "Agents" }));
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "AGENT", rootNodeId: undefined });
      await userEvent.click(screen.getByRole("button", { name: "Dependencies" }));
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "DEPENDENCY", rootNodeId: "task-t1" });
      await userEvent.click(screen.getByRole("button", { name: "Environments" }));
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "ENVIRONMENT", rootNodeId: undefined });
    });

    it("keeps the previous graph (no spinner-only view) while loading", () => {
      hook.mockReturnValue({ graph: makeProjection(), loading: true, error: null });
      renderAt("/graph");
      expect(screen.getByTestId("mock-canvas")).toBeInTheDocument();
      expect(screen.getByRole("toolbar", { name: "Graph view mode" })).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("project selection", () => {
    it("shows a single project as static text, with no selector", () => {
      renderAt("/graph");
      expect(screen.getByTestId("sg-project-static")).toHaveTextContent("Apollo");
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("offers only real registered projects and validates ?project= (invalid -> first)", () => {
      projectsState = { status: "ready", projects: twoProjects };
      renderAt("/graph?project=evil");
      const select = screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
      expect([...select.options].map((o) => o.value)).toEqual(["p1", "p2"]);
      expect(select.value).toBe("p1");
      expect(hook).toHaveBeenLastCalledWith("p1", expect.anything());
    });

    it("honours a valid ?project= and writes the choice to the URL", async () => {
      projectsState = { status: "ready", projects: twoProjects };
      renderAt("/graph?project=p2");
      expect(hook).toHaveBeenLastCalledWith("p2", expect.anything());
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), "p1");
      expect(screen.getByTestId("where")).toHaveTextContent("project=p1");
      expect(hook).toHaveBeenLastCalledWith("p1", expect.anything());
    });

    it("never sends a node id from project A as rootNodeId for project B, and resets selection", async () => {
      projectsState = { status: "ready", projects: twoProjects };
      renderAt("/graph?project=p1");
      await userEvent.click(screen.getByRole("button", { name: /Agent: Builder/ }));
      await userEvent.click(screen.getByRole("button", { name: "Agents" }));
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "AGENT", rootNodeId: "agent-a1" });

      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), "p2");
      expect(hook).toHaveBeenLastCalledWith("p2", { mode: "AGENT", rootNodeId: undefined });
      for (const call of hook.mock.calls) {
        if (call[0] === "p2") expect(call[1].rootNodeId).toBeUndefined();
      }
      // switching back must not resurrect A's root either
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), "p1");
      expect(hook).toHaveBeenLastCalledWith("p1", { mode: "AGENT", rootNodeId: undefined });
      // the workspace was re-keyed, so the old selection is gone (no inspector)
      expect(screen.queryByRole("heading", { name: "Builder" })).not.toBeInTheDocument();
    });

    it("still reports project-list failures instead of an empty state, and empty when there are none", () => {
      projectsState = { status: "forbidden", projects: [] };
      const { unmount } = renderAt("/graph");
      expect(screen.queryByText("No Projects")).not.toBeInTheDocument();
      unmount();
      projectsState = { status: "empty", projects: [] };
      renderAt("/graph");
      expect(screen.getByText("No Projects")).toBeInTheDocument();
    });
  });
});
