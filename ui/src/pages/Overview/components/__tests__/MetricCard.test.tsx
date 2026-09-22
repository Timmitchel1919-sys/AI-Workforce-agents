import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MetricCard } from "../MetricCard";

describe("MetricCard", () => {
  it("renders the value, label, context, and accessible trend text", () => {
    render(
      <MetricCard
        label="Active Agents"
        value={12}
        context="Currently operational"
        trend={2}
        trendDirection="up"
        status="positive"
      />,
    );

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Active Agents")).toBeInTheDocument();
    expect(screen.getByText("Currently operational")).toBeInTheDocument();
    expect(screen.getByText("↑ +2")).toBeInTheDocument();
    expect(screen.getByText("Increase of 2")).toBeInTheDocument();
  });

  it("supports a navigation target with accessible link semantics", () => {
    render(
      <MemoryRouter>
        <MetricCard
          label="Pending Approvals"
          value={3}
          context="Require operator attention"
          trend={1}
          trendDirection="up"
          status="warning"
          linkTo="/approvals"
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /Pending Approvals/i });
    expect(link).toHaveAttribute("href", "/approvals");
  });
});
