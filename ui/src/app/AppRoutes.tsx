import { Navigate, Route, Routes } from "react-router-dom";
import { DEFAULT_ROUTE } from "./routes";
import { ControlCenterLayout } from "../layouts/ControlCenterLayout";
import { LoginPage } from "../pages/Login";
import { NotFoundPage } from "../pages/NotFound";
import { OverviewPage } from "../pages/Overview";
import { AgentsPage, AgentDetailPage } from "../pages/Agents";
import { TaskDetailPage, TasksPage } from "../pages/Tasks";
import { WorkflowDetailPage, WorkflowsPage } from "../pages/Workflows";
import { ProjectDetailPage, ProjectsPage } from "../pages/Projects";
import { ApprovalsPage } from "../pages/Approvals";
import { AuditLogPage } from "../pages/AuditLog";
import { KnowledgePage } from "../pages/Knowledge";
import { SettingsPage } from "../pages/Settings";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ControlCenterLayout />}>
        <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />

        <Route path="/overview" element={<OverviewPage />} />

        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:agentId" element={<AgentDetailPage />} />

        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:taskId" element={<TaskDetailPage />} />

        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />

        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />

        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/settings" element={<SettingsPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
