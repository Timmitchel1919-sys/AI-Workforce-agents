import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentActivity } from "../RecentActivity";

describe("RecentActivity", () => {
  it("renders activity metadata with type, actor, timestamp, and status in a readable timeline", () => {
    render(
      <RecentActivity
        items={[
          {
            id: "task-1",
            type: "task",
            title: "Task completed",
            description: "Market analysis task completed successfully.",
            timestamp: "8 min ago",
            status: "completed",
            actor: "Research Agent",
            project: "Market Intelligence",
          },
        ]}
      />,
    );

    expect(screen.getByText("Task completed")).toBeInTheDocument();
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("8 min ago")).toBeInTheDocument();
  });
});
