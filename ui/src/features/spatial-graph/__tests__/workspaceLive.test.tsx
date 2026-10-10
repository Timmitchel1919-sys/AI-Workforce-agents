import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: (props: SpatialGraphViewProps) => {
    viewHarness.props = props;
    return <div data-testid="mock-canvas" />;
  },
}));

import { I18nProvider } from "../../../i18n";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import type { SpatialGraphViewProps } from "../components/SpatialGraphView";
import type { LiveStatus } from "../lib/liveStatus";
import { diffGraphs } from "../lib/graphDiff";
import { makeProjection, viewHarness } from "./fixtures";

type Live = NonNullable<React.ComponentProps<typeof SpatialGraphWorkspace>["live"]>;
const liveOf = (status: LiveStatus, extra: Partial<Live> = {}): Live => ({
  status,
  lastConfirmedAt: "2026-09-26T00:00:10.000Z",
  transitions: [],
  ...extra,
});
const wrap = (ui: React.ReactElement, lang: "en" | "nl" = "en") => <I18nProvider initialLanguage={lang}>{ui}</I18nProvider>;

const completedT1 = () =>
  makeProjection({
    revision: 2,
    generatedAt: "2026-09-26T00:01:00.000Z",
    nodes: makeProjection().nodes.map((n) => (n.id === "task-t1" ? { ...n, state: "completed" as const, status: "completed" } : n)),
  });

describe("live status in the workspace", () => {
  it("shows the transport status with text (never colour alone) and no live claim without live props", () => {
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" />));
    expect(screen.queryByTestId("sg-live")).toBeNull();
    rerender(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" live={liveOf("live")} />));
    expect(screen.getByTestId("sg-live-badge")).toHaveTextContent("Live");
    expect(screen.getByTestId("sg-live")).toHaveAttribute("data-status", "live");
    rerender(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" live={liveOf("degraded")} />));
    expect(screen.getByTestId("sg-live-badge")).toHaveTextContent("Degraded");
  });

  it("does not move the camera for a live state change, and announces the real transition", () => {
    const before = makeProjection();
    const after = completedT1();
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={before} mode="WORKFORCE" live={liveOf("live")} />));
    const seq = viewHarness.props.cameraCommand?.seq;
    rerender(
      wrap(
        <SpatialGraphWorkspace
          graph={after}
          mode="WORKFORCE"
          live={liveOf("live", { transitions: diffGraphs(before, after) })}
        />,
      ),
    );
    expect(viewHarness.props.cameraCommand?.seq).toBe(seq); // not yanked
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Write API is now completed.");
    // The graph handed to the scene is the new authoritative state.
    expect(viewHarness.props.nodes.find((n) => n.id === "task-t1")?.state).toBe("completed");
  });

  it("does not announce routine polls, but announces degradation and recovery", () => {
    const g = makeProjection();
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("refreshing")} />));
    rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live")} />));
    expect(screen.getByTestId("sg-announcement")).toBeEmptyDOMElement();
    rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("reconnecting")} />));
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Reconnecting");
    rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live")} />));
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Live");
  });

  it("lists recent changes (bounded) inside the status bar and offers a manual refresh", () => {
    const onRefresh = vi.fn();
    const before = makeProjection();
    const after = completedT1();
    render(
      wrap(
        <SpatialGraphWorkspace
          graph={after}
          mode="WORKFORCE"
          live={liveOf("live", { transitions: diffGraphs(before, after), onRefresh })}
        />,
      ),
    );
    const recent = screen.getByTestId("sg-live-recent");
    expect(within(recent).getAllByRole("listitem")).toHaveLength(1);
    act(() => screen.getByRole("button", { name: "Refresh now" }).click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("says unreadable execution sources are UNKNOWN, not absent", () => {
    render(
      wrap(
        <SpatialGraphWorkspace
          graph={makeProjection({ metadata: { unavailableSources: "releases" } })}
          mode="EXECUTION"
          live={liveOf("live")}
        />,
      ),
    );
    expect(screen.getByTestId("sg-unavailable-sources")).toHaveTextContent(/deployments.*unknown, not absent/);
  });

  it("is fully translated in Dutch, with no missing keys", () => {
    render(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" live={liveOf("degraded")} />, "nl"));
    expect(screen.getByTestId("sg-live-badge")).toHaveTextContent("Verminderd");
    expect(screen.getByTestId("sg-live").textContent).not.toMatch(/spatial\.live\./);
  });

  it("a source this deployment does not have is shown as NOT CONNECTED (never as an empty history), in EN and NL", () => {
    const g = makeProjection({ metadata: { notConfiguredSources: "releases,sourceControl,verifications" } });
    const { unmount } = render(wrap(<SpatialGraphWorkspace graph={g} mode="EXECUTION" live={liveOf("live")} />));
    expect(screen.getByTestId("sg-not-configured")).toHaveTextContent("Not connected in this deployment: deployments, reviews and commits, verification");
    expect(screen.getByTestId("sg-not-configured")).toHaveTextContent(/not the same as nothing happening/);
    unmount(); // the language is chosen at mount
    render(wrap(<SpatialGraphWorkspace graph={g} mode="EXECUTION" live={liveOf("live")} />, "nl"));
    expect(screen.getByTestId("sg-not-configured")).toHaveTextContent("Niet gekoppeld in deze omgeving: uitrol");
    expect(screen.getByTestId("sg-not-configured").textContent).not.toMatch(/spatial\./);
  });

  it("INERT != IDLE: connected-but-unconfigured release capabilities are named, in EN and NL, and are not 'not connected'", () => {
    const g = makeProjection({ metadata: { inertCapabilities: "verification,sourceControl,deployment" } });
    const { unmount } = render(wrap(<SpatialGraphWorkspace graph={g} mode="EXECUTION" live={liveOf("live")} />));
    const note = screen.getByTestId("sg-inert-capabilities");
    expect(note).toHaveTextContent("Connected, but not configured in this deployment: running verification, committing and pushing, deploying");
    expect(note).toHaveTextContent(/does not mean an idle pipeline/);
    expect(screen.queryByTestId("sg-not-configured")).toBeNull();
    unmount();
    render(wrap(<SpatialGraphWorkspace graph={g} mode="EXECUTION" live={liveOf("live")} />, "nl"));
    expect(screen.getByTestId("sg-inert-capabilities")).toHaveTextContent("Gekoppeld, maar niet geconfigureerd in deze omgeving: verificatie uitvoeren, committen en pushen, uitrollen");
    expect(screen.getByTestId("sg-inert-capabilities").textContent).not.toMatch(/spatial\./);
  });
});
