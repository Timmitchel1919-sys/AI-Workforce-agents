import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TasksPage from "../TasksPage";
import TaskDetailPage from "../TaskDetailPage";
import { AuthProvider } from "../../../auth/AuthProvider";

describe("Tasks Page Suite", () => {
  it("renders the task registry and summary metrics", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <AuthProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/tasks"]}>
            <Routes>
              <Route path="/tasks" element={<TasksPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText(/Total Tasks/i)).toBeInTheDocument();
    expect(await screen.findByText(/Codebase Security & Vulnerability Audit/i)).toBeInTheDocument();
  });

  it("renders task detail page with overview and timeline for valid taskId", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <AuthProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/tasks/task-101"]}>
            <Routes>
              <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText(/Codebase Security & Vulnerability Audit/i)).toBeInTheDocument();
    expect(screen.getByText(/ID: task-101/i)).toBeInTheDocument();
    expect(screen.getByText(/Task Lifecycle Timeline/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Execution Summary/i })).toBeInTheDocument();
  });

  it("renders not found state for invalid taskId", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <AuthProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/tasks/invalid-task-id-999"]}>
            <Routes>
              <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText(/Task Not Found/i)).toBeInTheDocument();
  });
});
