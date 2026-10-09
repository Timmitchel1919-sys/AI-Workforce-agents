import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "../NotificationProvider";
import { useNotifications } from "../useNotifications";

function Consumer() {
  const { notify } = useNotifications();
  return (
    <button
      type="button"
      onClick={() => notify({ title: "Saved", message: "Project created", duration: 0 })}
    >
      Notify
    </button>
  );
}

describe("NotificationProvider", () => {
  it("renders a notification and dismisses it from the close control", async () => {
    const user = userEvent.setup();
    render(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );

    expect(screen.queryByText("Project created")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByText("Project created")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByText("Project created")).not.toBeInTheDocument();
  });

  it("throws when used outside the provider", () => {
    expect(() => render(<Consumer />)).toThrow(
      /must be used within a NotificationProvider/,
    );
  });
});
