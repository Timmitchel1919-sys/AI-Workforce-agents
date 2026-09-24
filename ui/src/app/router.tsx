/* eslint-disable react-refresh/only-export-components -- route table module, not a component module */
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { RequireAuth } from "../auth/RequireAuth";
import { Spinner } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { loadAuthRoutes, loadControlCenterRoutes, loadLanding } from "./routeModules";

type ChunkExports<T> = { [K in keyof T]: T[K] };

function fromChunk<T, K extends keyof T>(load: () => Promise<ChunkExports<T>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType }));
}

const LandingPage = lazy(loadLanding);

const AuthLayout = fromChunk(loadAuthRoutes, "AuthLayout");
const LoginPage = fromChunk(loadAuthRoutes, "LoginPage");
const SignupPage = fromChunk(loadAuthRoutes, "SignupPage");

const AppShell = fromChunk(loadControlCenterRoutes, "AppShell");
const OverviewPage = fromChunk(loadControlCenterRoutes, "OverviewPage");
const AgentsPage = fromChunk(loadControlCenterRoutes, "AgentsPage");
const AgentDetailPage = fromChunk(loadControlCenterRoutes, "AgentDetailPage");
const TasksPage = fromChunk(loadControlCenterRoutes, "TasksPage");
const TaskDetailPage = fromChunk(loadControlCenterRoutes, "TaskDetailPage");
const WorkflowsPage = fromChunk(loadControlCenterRoutes, "WorkflowsPage");
const WorkflowDetailPage = fromChunk(loadControlCenterRoutes, "WorkflowDetailPage");
const DesignSystemPage = fromChunk(loadControlCenterRoutes, "DesignSystemPage");
const SettingsPage = fromChunk(loadControlCenterRoutes, "SettingsPage");
const ProjectsPage = fromChunk(loadControlCenterRoutes, "ProjectsPage");
const ExecutionPlanPage = fromChunk(loadControlCenterRoutes, "ExecutionPlanPage");

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="auth-guard-loading" role="status" aria-live="polite">
      <Spinner />
      <span>{t("common.loading")}</span>
    </div>
  );
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

function PlaceholderPage({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useI18n();
  return (
    <div className="page">
      <section className="page-header">
        <p className="eyebrow">{t("common.brand")}</p>
        <h1>{t(titleKey)}</h1>
        <p className="page-description">
          {t("shell.reservedDescription")}
        </p>
      </section>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    // Public landing experience; the Control Center lives under the AppShell routes below.
    path: "/",
    element: withSuspense(<LandingPage />),
  },
  {
    // Secure gateway; the brand environment persists across both forms.
    element: withSuspense(<AuthLayout />),
    children: [
      { path: "login", element: withSuspense(<LoginPage />) },
      { path: "signup", element: withSuspense(<SignupPage />) },
    ],
  },
  {
    element: (
      <RequireAuth>
        {withSuspense(<AppShell />)}
      </RequireAuth>
    ),
    children: [
      { path: "overview", element: withSuspense(<OverviewPage />) },
      { path: "agents", element: withSuspense(<AgentsPage />) },
      { path: "agents/:agentId", element: withSuspense(<AgentDetailPage />) },
      { path: "tasks", element: withSuspense(<TasksPage />) },
      { path: "tasks/:taskId", element: withSuspense(<TaskDetailPage />) },
      { path: "workflows", element: withSuspense(<WorkflowsPage />) },
      { path: "workflows/:workflowId", element: withSuspense(<WorkflowDetailPage />) },
      { path: "projects", element: withSuspense(<ProjectsPage />) },
      {
        path: "projects/:projectId/execution-plan",
        element: withSuspense(<ExecutionPlanPage />),
      },
      { path: "approvals", element: <PlaceholderPage titleKey="nav.approvals" /> },
      { path: "audit-log", element: <PlaceholderPage titleKey="nav.auditLog" /> },
      { path: "knowledge", element: <PlaceholderPage titleKey="nav.knowledge" /> },
      { path: "settings", element: withSuspense(<SettingsPage />) },
      { path: "design-system", element: withSuspense(<DesignSystemPage />) },
    ],
  },
]);
