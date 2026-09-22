import { createBrowserRouter } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import OverviewPage from "../pages/Overview/OverviewPage";
import AgentsPage from "../pages/Agents/AgentsPage";
import AgentDetailPage from "../pages/Agents/AgentDetailPage";
import TasksPage from "../pages/Tasks/TasksPage";
import TaskDetailPage from "../pages/Tasks/TaskDetailPage";
import DesignSystemPage from "../pages/DesignSystem/DesignSystemPage";

// eslint-disable-next-line react-refresh/only-export-components
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="page">
      <section className="page-header">
        <p className="eyebrow">AI Workforce</p>
        <h1>{title}</h1>
        <p className="page-description">
          This feature area is reserved for the next UI layer.
        </p>
      </section>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <OverviewPage />,
      },
      {
        path: "agents",
        element: <AgentsPage />,
      },
      {
        path: "agents/:agentId",
        element: <AgentDetailPage />,
      },
      {
        path: "tasks",
        element: <TasksPage />,
      },
      {
        path: "tasks/:taskId",
        element: <TaskDetailPage />,
      },
      {
        path: "workflows",
        element: <PlaceholderPage title="Workflows" />,
      },
      {
        path: "projects",
        element: <PlaceholderPage title="Projects" />,
      },
      {
        path: "approvals",
        element: <PlaceholderPage title="Approvals" />,
      },
      {
        path: "audit-log",
        element: <PlaceholderPage title="Audit Log" />,
      },
      {
        path: "knowledge",
        element: <PlaceholderPage title="Knowledge" />,
      },
      {
        path: "settings",
        element: <PlaceholderPage title="Settings" />,
      },
      {
        path: "design-system",
        element: <DesignSystemPage />,
      },
    ],
  },
]);