import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowsPage from "../WorkflowsPage";
import WorkflowDetailPage from "../WorkflowDetailPage";
import { AuthProvider } from "../../../auth/AuthProvider";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <AuthProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe("Workflows Page Suite", () => {
  it("renders the workflow registry and summary metrics", async () => {
    renderAt("/workflows");

    expect(await screen.findByText(/Total Workflows/i)).toBeInTheDocument();
    expect(screen.getByText("Continuous Compliance Check")).toBeInTheDocument();
    expect(screen.getByText("1 approval")).toBeInTheDocument();
  });

  it("filters workflows by search query", async () => {
    renderAt("/workflows");

    const search = await screen.findByLabelText(/Search workflows/i);
    await userEvent.type(search, "ledger");

    expect(screen.getByText("Ledger Schema Migration Plan")).toBeInTheDocument();
    expect(screen.queryByText("Continuous Compliance Check")).not.toBeInTheDocument();
  });

  it("renders workflow detail with stages and the current stage", async () => {
    renderAt("/workflows/wf-sec-scan");

    expect(await screen.findByText(/ID: wf-sec-scan/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Stages/i })).toBeInTheDocument();
    const current = document.querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent("triage-findings");
  });

  it("shows stage errors for a failed workflow", async () => {
    renderAt("/workflows/wf-data-migration");

    expect(
      await screen.findByText(/Snapshot restore timed out after 3 attempts/i),
    ).toBeInTheDocument();
  });

  it("renders not found state for an unknown workflowId", async () => {
    renderAt("/workflows/does-not-exist");

    expect(await screen.findByText(/Workflow Not Found/i)).toBeInTheDocument();
  });
});
