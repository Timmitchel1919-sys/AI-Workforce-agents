import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: (props: SpatialGraphViewProps) => {
    viewHarness.props = props;
    return <div data-testid="mock-canvas" />;
  },
}));

import { I18nProvider } from "../../../i18n";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import type { SpatialGraphViewProps } from "../components/SpatialGraphView";
import { makeProjection, viewHarness } from "./fixtures";

function setup(projection = makeProjection()) {
  return render(
    <I18nProvider initialLanguage="en">
      <SpatialGraphWorkspace graph={projection} />
    </I18nProvider>,
  );
}

const listButtons = () => within(screen.getByRole("region", { name: "Node list" })).getAllByRole("button");

describe("SpatialGraphWorkspace", () => {
  it("renders a labelled region, live status counts and a node list with type, label and state", () => {
    setup();
    expect(screen.getByRole("region", { name: "Spatial graph explorer" })).toBeInTheDocument();
    expect(screen.getByTestId("sg-status")).toHaveTextContent("Showing 8 nodes and 8 relationships. Filter: All.");
    expect(screen.getByRole("button", { name: "Task: Write API, state Running" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Environment: Node runner, state Unavailable" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-canvas").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("shows the truncated notice only when the projection is truncated", () => {
    const { unmount } = setup();
    expect(screen.queryByTestId("sg-truncated")).not.toBeInTheDocument();
    unmount();
    setup(makeProjection({ truncated: true, appliedLimits: { depth: 2, maxNodes: 8, maxEdges: 10 } }));
    expect(screen.getByTestId("sg-truncated")).toHaveTextContent("limited it to 8 nodes at depth 2");
  });

  it("filters client-side and updates status and canvas data", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    expect(screen.getByRole("button", { name: /^Tasks/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sg-status")).toHaveTextContent("Showing 3 nodes and 1 relationships. Filter: Tasks.");
    expect(viewHarness.props.nodes).toHaveLength(3);
    expect(viewHarness.props.edges).toHaveLength(1);
    expect(listButtons()).toHaveLength(3);
  });

  it("selecting from the list syncs the canvas and inspector, and is keyboard operable", async () => {
    setup();
    const btn = screen.getByRole("button", { name: "Task: Write API, state Running" });
    act(() => btn.focus());
    await userEvent.keyboard("{Enter}");
    expect(viewHarness.props.selectedId).toBe("task-t1");
    expect(screen.getByRole("heading", { name: "Write API" })).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Selected Task Write API, state Running.");
  });

  it("Escape and the Deselect button clear the selection; empty-space click deselects", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Task: Write API, state Running" }));
    await userEvent.keyboard("{Escape}");
    expect(viewHarness.props.selectedId).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Task: Docs, state Completed" }));
    await userEvent.click(screen.getByRole("button", { name: "Deselect" }));
    expect(viewHarness.props.selectedId).toBeNull();
    act(() => viewHarness.props.onSelect("task-t2"));
    expect(viewHarness.props.selectedId).toBe("task-t2");
    act(() => viewHarness.props.onDeselect());
    expect(viewHarness.props.selectedId).toBeNull();
  });

  it("isolates a node with its neighbours and exits isolation", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Task: Write API, state Running" }));
    await userEvent.click(screen.getByRole("button", { name: "Isolate node" }));
    expect(viewHarness.props.nodes.map((n) => n.id).sort()).toEqual([
      "agent-a1",
      "project-p1",
      "task-t1",
      "task-t2",
    ]);
    expect(screen.getByTestId("sg-status")).toHaveTextContent("Isolated around Write API");
    await userEvent.click(screen.getByRole("button", { name: "Exit isolation" }));
    expect(viewHarness.props.nodes).toHaveLength(8);
  });

  it("expands relationships (emphasis) and collapses again", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Task: Write API, state Running" }));
    expect(viewHarness.props.emphasisIds).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand relationships" }));
    expect(viewHarness.props.emphasisIds!.has("agent-a1")).toBe(true);
    expect(viewHarness.props.emphasisIds!.has("task-t3")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Collapse relationships" }));
    expect(viewHarness.props.emphasisIds).toBeNull();
  });

  it("reset restores filter, selection and issues a reset camera command", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /^Agents/ }));
    await userEvent.click(screen.getByRole("button", { name: "Agent: Builder, state Active" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(viewHarness.props.selectedId).toBeNull();
    expect(viewHarness.props.nodes).toHaveLength(8);
    expect(viewHarness.props.cameraCommand.kind).toBe("reset");
  });

  it("toolbar buttons and keyboard shortcuts issue camera commands", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(viewHarness.props.cameraCommand.kind).toBe("zoomIn");
    await userEvent.click(screen.getByRole("button", { name: "Pan left" }));
    expect(viewHarness.props.cameraCommand.kind).toBe("panLeft");
    const frame = screen.getByRole("group", { name: /3D graph view/ });
    act(() => frame.focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(viewHarness.props.cameraCommand.kind).toBe("orbitRight");
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(viewHarness.props.cameraCommand.kind).toBe("panUp");
    await userEvent.click(screen.getByRole("button", { name: "Task: Docs, state Completed" }));
    await userEvent.click(screen.getByRole("button", { name: "Focus selected node" }));
    expect(viewHarness.props.cameraCommand).toMatchObject({ kind: "focus", nodeId: "task-t3" });
  });

  it("never issues write requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Task: Docs, state Completed" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("reduced motion", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("passes the reduced-motion preference to the scene", () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    setup();
    expect(viewHarness.props.reducedMotion).toBe(true);
  });

  it("defaults to animated camera transitions otherwise", () => {
    setup();
    expect(viewHarness.props.reducedMotion).toBe(false);
  });
});
