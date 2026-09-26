import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const viewProps: { current: any } = { current: null };
vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: (props: any) => {
    viewProps.current = props;
    return <div data-testid="mock-canvas" />;
  },
}));

import { I18nProvider } from "../../../i18n";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import { edge, makeProjection, node } from "./fixtures";

const wrap = (ui: React.ReactElement, lang: "en" | "nl" = "en") => <I18nProvider initialLanguage={lang}>{ui}</I18nProvider>;

describe("mode switcher", () => {
  it("is a labelled radiogroup with roving tabindex and arrow-key selection", async () => {
    const onModeChange = vi.fn();
    render(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" onModeChange={onModeChange} />));
    const group = screen.getByRole("radiogroup", { name: "Graph view mode" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(7);
    expect(screen.getByRole("radio", { name: "Workforce" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Workforce" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Agents" })).toHaveAttribute("tabindex", "-1");
    act(() => screen.getByRole("radio", { name: "Workforce" }).focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(onModeChange).toHaveBeenLastCalledWith("PROJECT", null);
    await userEvent.keyboard("{ArrowLeft}");
    expect(onModeChange).toHaveBeenLastCalledWith("KNOWLEDGE", null);
  });

  it("passes the selected node so the caller can derive rootNodeId, and localizes labels", async () => {
    const onModeChange = vi.fn();
    render(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" onModeChange={onModeChange} />, "nl"));
    await userEvent.click(screen.getByRole("button", { name: /Agent: Builder/i }));
    await userEvent.click(screen.getByRole("radio", { name: "Afhankelijkheden" }));
    expect(onModeChange).toHaveBeenCalledWith("DEPENDENCY", expect.objectContaining({ id: "agent-a1" }));
  });

  it("keeps the graph visible while busy and announces the new mode once loaded", () => {
    const first = makeProjection();
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={first} mode="WORKFORCE" onModeChange={() => {}} />));
    rerender(wrap(<SpatialGraphWorkspace graph={first} mode="AGENT" busy onModeChange={() => {}} />));
    expect(screen.getByTestId("mock-canvas")).toBeInTheDocument();
    expect(screen.getByText("Updating graph…")).toBeInTheDocument();
    const next = makeProjection({ mode: "AGENT", nodes: first.nodes.slice(0, 3), edges: first.edges.slice(0, 2) });
    rerender(wrap(<SpatialGraphWorkspace graph={next} mode="AGENT" onModeChange={() => {}} />));
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Agents view loaded: 3 nodes and 2 relationships.");
    expect(viewProps.current.nodes).toHaveLength(3);
  });

  it("clears a selection that disappears in the new projection", async () => {
    const first = makeProjection();
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={first} mode="WORKFORCE" onModeChange={() => {}} />));
    await userEvent.click(screen.getByRole("button", { name: /Task: Write API/ }));
    expect(viewProps.current.selectedId).toBe("task-t1");
    rerender(wrap(<SpatialGraphWorkspace graph={makeProjection({ mode: "AGENT", nodes: first.nodes.slice(0, 3), edges: [] })} mode="AGENT" onModeChange={() => {}} />));
    expect(viewProps.current.selectedId).toBeNull();
  });

  it("hides the switcher when no handler is supplied", () => {
    render(wrap(<SpatialGraphWorkspace graph={makeProjection()} />));
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});

describe("notes, new types and edge statuses", () => {
  it("renders the backend note and the truncated notice", () => {
    render(wrap(<SpatialGraphWorkspace graph={makeProjection({ truncated: true, metadata: { note: "No workflows are registered." } })} />));
    expect(screen.getByTestId("sg-note")).toHaveTextContent("No workflows are registered.");
    expect(screen.getByTestId("sg-truncated")).toBeInTheDocument();
  });

  it("lists new node types with localized labels and offers filters for them", () => {
    const g = makeProjection({
      nodes: [node("cp", "CONTROL_PLANE", "Control plane"), node("ks-1", "KNOWLEDGE_SOURCE", "Arch doc"), node("ws-1", "WORKFLOW_STEP", "Build", "running")],
      edges: [],
    });
    render(wrap(<SpatialGraphWorkspace graph={g} />));
    expect(screen.getByRole("button", { name: "Knowledge source: Arch doc, state Active" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workflow step: Build, state Running" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Control plane (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Knowledge sources/ })).toBeInTheDocument();
  });

  it("labels blocking edges with text in the legend, the canvas label and the inspector", async () => {
    const g = makeProjection({ edges: [{ ...edge("task-t2", "task-t1", "DEPENDS_ON"), status: "blocking" }] });
    render(wrap(<SpatialGraphWorkspace graph={g} />));
    expect(screen.getAllByText("[blocking]").length).toBeGreaterThan(0); // legend
    expect(viewProps.current.edgeLabelFor(g.edges[0])).toBe("depends on [blocking]");
    await userEvent.click(screen.getByRole("button", { name: /Task: Write UI/ }));
    expect(screen.getAllByText("[blocking]").length).toBeGreaterThan(1); // + inspector
  });
});
