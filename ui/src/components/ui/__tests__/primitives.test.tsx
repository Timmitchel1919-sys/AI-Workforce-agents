import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  RiskBadge,
  Skeleton,
  StatusBadge,
  Switch,
  Tabs,
  type Column,
} from "../index";

describe("Button", () => {
  it("renders children and default type=button", () => {
    render(<Button>Approve</Button>);
    const btn = screen.getByRole("button", { name: "Approve" });
    expect(btn).toHaveAttribute("type", "button");
  });

  it("applies variant + size classes", () => {
    render(
      <Button variant="danger" size="lg">
        Reject
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Reject" });
    expect(btn.className).toContain("ui-btn--danger");
    expect(btn.className).toContain("ui-btn--lg");
  });

  it("disables and sets aria-busy while loading, blocking clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is keyboard operable", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Badge / StatusBadge / RiskBadge", () => {
  it("Badge tone maps to a class", () => {
    render(<Badge tone="success">OK</Badge>);
    expect(screen.getByText("OK").className).toContain("ui-badge--success");
  });

  it("StatusBadge derives label + colour var from the status key", () => {
    render(<StatusBadge status="awaiting_approval" />);
    const el = screen.getByText("Awaiting Approval");
    expect(el).toHaveAttribute(
      "style",
      expect.stringContaining("--status-awaiting_approval"),
    );
  });

  it("RiskBadge marks high risk with icon + text (not colour alone)", () => {
    const { container } = render(<RiskBadge level="high" />);
    expect(screen.getByText(/high risk/i)).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("Field + Input", () => {
  it("associates the label with the control (accessible name)", () => {
    render(
      <Field label="Email">
        <Input type="email" />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("shows an error with role=alert and sets aria-invalid", () => {
    render(
      <Field label="Name" error="Required">
        <Input invalid />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("Checkbox and Switch are real inputs and toggle", async () => {
    render(
      <>
        <Checkbox label="Accept" />
        <Switch label="Live" />
      </>,
    );
    const checkbox = screen.getByLabelText("Accept");
    const toggle = screen.getByRole("switch", { name: "Live" });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
  });
});

describe("Feedback: Skeleton / EmptyState / ErrorState / Alert", () => {
  it("Skeleton renders `count` placeholders", () => {
    const { container } = render(<Skeleton count={3} />);
    expect(container.querySelectorAll(".ui-skeleton")).toHaveLength(3);
  });

  it("EmptyState shows title + detail + action", () => {
    render(
      <EmptyState
        title="No agents"
        detail="Register an agent to begin."
        action={<Button>Add</Button>}
      />,
    );
    expect(screen.getByText("No agents")).toBeInTheDocument();
    expect(screen.getByText("Register an agent to begin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("ErrorState uses role=alert and a forbidden variant", () => {
    render(<ErrorState variant="forbidden" title="No access" />);
    const el = screen.getByRole("alert");
    expect(el).toHaveTextContent("No access");
    expect(el.className).toContain("ui-state--forbidden");
  });

  it("Alert danger is announced", () => {
    render(
      <Alert tone="danger" title="Failed">
        Try again
      </Alert>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });
});

describe("DataTable", () => {
  interface Row {
    id: string;
    name: string;
  }
  const columns: Column<Row>[] = [
    { id: "name", header: "Name", cell: (r) => r.name, sortable: true },
  ];

  it("renders rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "a", name: "Alpha" }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("shows a loading state then an empty state", () => {
    const { rerender, container } = render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />,
    );
    expect(container.querySelector(".ui-skeleton")).toBeTruthy();
    rerender(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyTitle="No rows"
      />,
    );
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });

  it("fires onSortChange when a sortable header is activated", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "a", name: "Alpha" }]}
        rowKey={(r) => r.id}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole("columnheader", { name: /name/i }));
    expect(onSortChange).toHaveBeenCalledWith("name");
  });
});

describe("Tabs", () => {
  it("switches panels and keeps ARIA wiring", async () => {
    render(
      <Tabs
        items={[
          { id: "one", label: "One", content: <p>Panel one</p> },
          { id: "two", label: "Two", content: <p>Panel two</p> },
        ]}
      />,
    );
    expect(screen.getByText("Panel one")).toBeInTheDocument();
    const tabTwo = screen.getByRole("tab", { name: "Two" });
    await userEvent.click(tabTwo);
    expect(tabTwo).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel two")).toBeInTheDocument();
  });
});
