import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { NodeInspector } from "../components/NodeInspector";
import { makeProjection, node } from "./fixtures";

const g = makeProjection();
const byId = (id: string) => g.nodes.find((n) => n.id === id)!;

function renderInspector(nodeId: string | null, onSelect = vi.fn(), lang: "en" | "nl" = "en") {
  return render(
    <I18nProvider initialLanguage={lang}>
      <NodeInspector node={nodeId ? byId(nodeId) : null} graph={g} onSelectNode={onSelect} onClose={() => {}} />
    </I18nProvider>,
  );
}

describe("NodeInspector", () => {
  it("shows a prompt with no selection", () => {
    renderInspector(null);
    expect(screen.getByText("Select a node to inspect it.")).toBeInTheDocument();
  });

  it("renders task fields derived from relations and localized edge labels", async () => {
    const onSelect = vi.fn();
    renderInspector("task-t1", onSelect);
    expect(screen.getByRole("heading", { name: "Write API" })).toBeInTheDocument();
    const assigned = screen.getByText("Assigned agent").closest("div")!;
    await userEvent.click(within(assigned).getByRole("button", { name: /Builder/ }));
    expect(onSelect).toHaveBeenCalledWith("agent-a1");
    expect(screen.getByText("assigned to")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows Unavailable for missing values and never fabricates fields", () => {
    renderInspector("task-t3");
    const assigned = screen.getByText("Assigned agent").closest("div")!;
    expect(within(assigned).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Priority")).not.toBeInTheDocument();
    expect(screen.queryByText(/{|}/)).not.toBeInTheDocument(); // no raw JSON dump
  });

  it("uses agent-specific fields, with role Unavailable when absent", () => {
    renderInspector("agent-a2");
    const role = screen.getByText("Role").closest("div")!;
    expect(within(role).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Assigned tasks")).toBeInTheDocument();
  });

  it("falls back to generic fields for other types and localizes to Dutch", () => {
    const only = node("commit-c1", "COMMIT", "Fix bug", "failed", { sha: "abc123" });
    render(
      <I18nProvider initialLanguage="nl">
        <NodeInspector node={only} graph={{ nodes: [only], edges: [] }} onSelectNode={() => {}} onClose={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText("Mislukt")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(screen.getByText("Geen relaties in de huidige weergave.")).toBeInTheDocument();
  });
});
