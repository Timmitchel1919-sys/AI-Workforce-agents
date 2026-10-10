import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";

// --- Mocked R3F: lets tests drive onCreated / renderer failure without WebGL. ---
const canvasBehaviour: { mode: "ok" | "throw" } = { mode: "ok" };
const glElement = document.createElement("canvas");
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ onCreated }: { onCreated?: (s: unknown) => void; children?: ReactNode }) => {
    if (canvasBehaviour.mode === "throw") throw new Error("WebGL not supported");
    // Like R3F, onCreated fires once after the renderer exists (not on every render).
    useEffect(() => {
      onCreated?.({ gl: { domElement: glElement, dispose: () => {} } });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="r3f-canvas" />;
  },
  useFrame: () => {},
  useThree: () => null,
}));
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null, Html: () => null }));

import { I18nProvider } from "../../../i18n";
import { SpatialGraphView } from "../components/SpatialGraphView";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import { makeProjection, node } from "./fixtures";

const noop = () => {};
const baseProps = {
  nodes: makeProjection().nodes,
  edges: makeProjection().edges,
  positions: new Map(),
  selectedId: null,
  hoveredId: null,
  emphasisIds: null,
  cameraCommand: null,
  reducedMotion: false,
  tooltipFor: () => "",
  edgeLabelFor: () => "",
  onHover: noop,
  onSelect: noop,
  onDeselect: noop,
};
const wrap = (ui: React.ReactElement) => <I18nProvider initialLanguage="en">{ui}</I18nProvider>;

describe("SpatialGraphView WebGL evidence attributes", () => {
  afterEach(() => {
    canvasBehaviour.mode = "ok";
  });

  it("reports ready with the rendered counts once the renderer is created", () => {
    render(wrap(<SpatialGraphView {...baseProps} />));
    const el = screen.getByTestId("spatial-graph-canvas");
    expect(el).toHaveAttribute("data-webgl-status", "ready");
    expect(el).toHaveAttribute("data-node-count", String(baseProps.nodes.length));
    expect(el).toHaveAttribute("data-edge-count", String(baseProps.edges.length));
  });

  it("reports unavailable with a visible localized fallback when the renderer cannot start", () => {
    canvasBehaviour.mode = "throw";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(wrap(<SpatialGraphView {...baseProps} />));
    spy.mockRestore();
    const el = screen.getByTestId("spatial-graph-canvas");
    expect(el).toHaveAttribute("data-webgl-status", "unavailable");
    expect(el).toHaveAttribute("data-node-count", "0");
    expect(within(el).getByRole("status")).toHaveTextContent(/3D view unavailable/);
    expect(screen.queryByTestId("r3f-canvas")).not.toBeInTheDocument();
  });

  it("reports lost on context loss and ready again on restore", () => {
    render(wrap(<SpatialGraphView {...baseProps} />));
    const el = screen.getByTestId("spatial-graph-canvas");
    act(() => {
      glElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(el).toHaveAttribute("data-webgl-status", "lost");
    expect(within(el).getByRole("status")).toHaveTextContent(/lost its graphics context/);
    act(() => {
      glElement.dispatchEvent(new Event("webglcontextrestored"));
    });
    expect(el).toHaveAttribute("data-webgl-status", "ready");
  });
});

describe("Workspace: search, inspector, Focus Mode, fullscreen", () => {
  const g = makeProjection();
  const open = () => render(wrap(<SpatialGraphWorkspace graph={g} />));

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
    document.body.style.overflow = "";
  });

  it("searches nodes by label and narrows the accessible list", async () => {
    open();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search nodes by label" }), "write");
    expect(screen.getByTestId("sg-search-status")).toHaveTextContent("2 matching nodes.");
    const list = screen.getByRole("region", { name: "Node list" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    await userEvent.type(screen.getByRole("searchbox"), "{Enter}");
    expect(screen.getByRole("heading", { name: /Write/ })).toBeInTheDocument(); // first match selected
  });

  it("shows the inspector only on selection and closes it with the close control", async () => {
    open();
    expect(screen.queryByRole("region", { name: "Node inspector" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Task: Write API/ }));
    expect(screen.getByRole("region", { name: "Node inspector" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByRole("region", { name: "Node inspector" })).not.toBeInTheDocument();
  });

  it("enters Focus Mode: inert background, scroll lock, exit control; Esc exits and restores focus", async () => {
    render(
      wrap(
        <div>
          <nav data-testid="background">nav</nav>
          <SpatialGraphWorkspace graph={g} />
        </div>,
      ),
    );
    const trigger = screen.getByRole("button", { name: "Focus Mode" });
    await userEvent.click(trigger);
    const region = screen.getByRole("region", { name: "Spatial graph explorer" });
    expect(region).toHaveAttribute("data-focus-mode", "true");
    expect(screen.getByTestId("background")).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Exit Focus Mode" })).toHaveFocus();
    // list and toolbar stay reachable inside
    expect(screen.getByRole("button", { name: "Task: Write API, state Running" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(region).toHaveAttribute("data-focus-mode", "false");
    expect(screen.getByTestId("background")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("exits Focus Mode with the visible Exit button and restores focus to the trigger", async () => {
    open();
    const trigger = screen.getByRole("button", { name: "Focus Mode" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Exit Focus Mode" }));
    expect(screen.queryByRole("button", { name: "Exit Focus Mode" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("Escape in the search box clears the query first and does NOT also exit Focus Mode", async () => {
    render(wrap(<SpatialGraphWorkspace graph={g} />));
    await userEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
    const region = screen.getByRole("region", { name: "Spatial graph explorer" });
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "api");
    expect(search).toHaveValue("api");
    await userEvent.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(region).toHaveAttribute("data-focus-mode", "true");
    await userEvent.keyboard("{Escape}");
    expect(region).toHaveAttribute("data-focus-mode", "false");
  });

  it("Escape from inside the region also exits Focus Mode", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
    fireEvent.keyDown(screen.getByRole("group", { name: /3D graph view/ }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Exit Focus Mode" })).not.toBeInTheDocument();
  });

  it("hides the fullscreen control when the Fullscreen API is unsupported (and is separate from Focus Mode)", () => {
    open();
    expect(screen.queryByRole("button", { name: "Fullscreen" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus Mode" })).toBeInTheDocument();
  });

  it("uses the Fullscreen API when supported and fails gracefully when refused", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const original = HTMLElement.prototype.requestFullscreen;
    const request = vi.fn().mockRejectedValue(new Error("denied"));
    HTMLElement.prototype.requestFullscreen = request;
    try {
      open();
      await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
      expect(request).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("The browser did not allow fullscreen.")).toBeInTheDocument();
      // Focus Mode is untouched by fullscreen
      expect(screen.getByRole("region", { name: "Spatial graph explorer" })).toHaveAttribute("data-focus-mode", "false");
    } finally {
      HTMLElement.prototype.requestFullscreen = original;
    }
  });

  it("keeps the accessible list usable even with new node types", () => {
    render(wrap(<SpatialGraphWorkspace graph={makeProjection({ nodes: [node("cp", "CONTROL_PLANE", "Hub")], edges: [] })} />));
    expect(screen.getByRole("button", { name: "Control plane: Hub, state Active" })).toBeInTheDocument();
  });
});
