/* eslint-disable react-refresh/only-export-components -- route table module, not a component module */
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { RequireAuth } from "../auth/RequireAuth";
import { RequireRole } from "../auth/RequireRole";
import { useAuth } from "../auth/useAuth";
import { Spinner } from "../components/ui";
import { useI18n } from "../i18n";
import RouteError from "./RouteError";
import { loadAuthRoutes, loadControlCenterRoutes, loadLanding, loadProjectOnboarding } from "./routeModules";

type ChunkExports<T> = { [K in keyof T]: T[K] };

function fromChunk<T, K extends keyof T>(load: () => Promise<ChunkExports<T>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType }));
}

const LandingPage = lazy(loadLanding);

const AuthLayout = fromChunk(loadAuthRoutes, "AuthLayout");
const LoginPage = fromChunk(loadAuthRoutes, "LoginPage");

const AppShell = fromChunk(loadControlCenterRoutes, "AppShell");
const OverviewPage = fromChunk(loadControlCenterRoutes, "OverviewPage");
const AgentsPage = fromChunk(loadControlCenterRoutes, "AgentsPage");
const AgentDetailPage = fromChunk(loadControlCenterRoutes, "AgentDetailPage");
const TasksPage = fromChunk(loadControlCenterRoutes, "TasksPage");
const TaskDetailPage = fromChunk(loadControlCenterRoutes, "TaskDetailPage");
const WorkflowsPage = fromChunk(loadControlCenterRoutes, "WorkflowsPage");
const WorkflowDetailPage = fromChunk(loadControlCenterRoutes, "WorkflowDetailPage");
const WorkflowStudioPage = fromChunk(loadControlCenterRoutes, "WorkflowStudioPage");
const CommandCenterPage = fromChunk(loadControlCenterRoutes, "CommandCenterPage");
const SecurityCenterPage = fromChunk(loadControlCenterRoutes, "SecurityCenterPage");
const AnalyticsStudioPage = fromChunk(loadControlCenterRoutes, "AnalyticsStudioPage");
const CreativeStudioPage = fromChunk(loadControlCenterRoutes, "CreativeStudioPage");
const OptimizationPage = fromChunk(loadControlCenterRoutes, "OptimizationPage");
const AgentTeamsPage = fromChunk(loadControlCenterRoutes, "AgentTeamsPage");
const KnowledgePage = fromChunk(loadControlCenterRoutes, "KnowledgePage");
const DesignSystemPage = fromChunk(loadControlCenterRoutes, "DesignSystemPage");
const SettingsPage = fromChunk(loadControlCenterRoutes, "SettingsPage");
const ProfilePage = fromChunk(loadControlCenterRoutes, "ProfilePage");
const InfrastructurePage = fromChunk(loadControlCenterRoutes, "InfrastructurePage");
const SoftwareFactoryPage = fromChunk(loadControlCenterRoutes, "SoftwareFactoryPage");
const SoftwareFactoryProgramPage = fromChunk(loadControlCenterRoutes, "SoftwareFactoryProgramPage");
const UsersAccessPage = fromChunk(loadControlCenterRoutes, "UsersAccessPage");
const ApprovalsPage = fromChunk(loadControlCenterRoutes, "ApprovalsPage");
const AuditLogPage = fromChunk(loadControlCenterRoutes, "AuditLogPage");
const ProjectsPage = fromChunk(loadControlCenterRoutes, "ProjectsPage");
const ProjectDetailPage = fromChunk(loadControlCenterRoutes, "ProjectDetailPage");
const SpatialGraphPage = fromChunk(loadControlCenterRoutes, "SpatialGraphPage");
const GovernancePage = fromChunk(loadControlCenterRoutes, "GovernancePage");
const CostCenterPage = fromChunk(loadControlCenterRoutes, "CostCenterPage");
const IntelligencePage = fromChunk(loadControlCenterRoutes, "IntelligencePage");
const IntegrationsPage = fromChunk(loadControlCenterRoutes, "IntegrationsPage");
const NewProjectPage = fromChunk(loadProjectOnboarding, "NewProjectPage");
const OnboardingPage = fromChunk(loadProjectOnboarding, "OnboardingPage");
const ExtensionsPage = fromChunk(loadControlCenterRoutes, "ExtensionsPage");
const OrganizationPage = fromChunk(loadControlCenterRoutes, "OrganizationPage");
const BillingPage = fromChunk(loadControlCenterRoutes, "BillingPage");
const PlatformAdminPage = fromChunk(loadControlCenterRoutes, "PlatformAdminPage");
const CommercialAdminPage = fromChunk(loadControlCenterRoutes, "CommercialAdminPage");
const CustomerProfilePage = fromChunk(loadControlCenterRoutes, "CustomerProfilePage");
const IncidentsPage = fromChunk(loadControlCenterRoutes, "IncidentsPage");

const SsoSettingsPage = fromChunk(loadControlCenterRoutes, "SsoSettingsPage");
const PrivacySettingsPage = fromChunk(loadControlCenterRoutes, "PrivacySettingsPage");
const DeveloperPlatformPage = fromChunk(loadControlCenterRoutes, "DeveloperPlatformPage");
const SecOpsPage = fromChunk(loadControlCenterRoutes, "SecOpsPage");
const MarketingPage = fromChunk(loadControlCenterRoutes, "MarketingPage");
const ContinuityPage = fromChunk(loadControlCenterRoutes, "ContinuityPage");
const ITSMPage = fromChunk(loadControlCenterRoutes, "ITSMPage");
const OperationsPage = fromChunk(loadControlCenterRoutes, "OperationsPage");
const TrustCenterPage = fromChunk(loadControlCenterRoutes, "TrustCenterPage");
const AIGovernancePage = fromChunk(loadControlCenterRoutes, "AIGovernancePage");
const DataGovernancePage = fromChunk(loadControlCenterRoutes, "DataGovernancePage");
const SecurityPage = fromChunk(loadControlCenterRoutes, "SecurityPage");
const AuditPage = fromChunk(loadControlCenterRoutes, "AuditPage");
const PortfolioPage = fromChunk(loadControlCenterRoutes, "PortfolioPage");
const ProductPage = fromChunk(loadControlCenterRoutes, "ProductPage");
const WorkforcePage = fromChunk(loadControlCenterRoutes, "WorkforcePage");

function RootRoute() {
  const { access, loading, user } = useAuth();
  if (loading) return <RouteFallback />;
  if (user && access === "granted") return <Navigate to="/overview" replace />;
  return <LandingPage />;
}

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="auth-guard-loading" role="status" aria-live="polite">
      <Spinner />
      <span>{t("common.loading")}</span>
    </div>
  );
}

const adminOnly = (element: ReactNode) => <RequireRole role="admin">{element}</RequireRole>;

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

/** Every page gets the in-app error state (the shell stays usable). */
function withErrorElements<T extends { errorElement?: ReactNode; children?: T[] }>(routes: T[]): T[] {
  return routes.map((route) => ({
    ...route,
    errorElement: route.errorElement ?? <RouteError />,
    ...(route.children ? { children: withErrorElements(route.children) } : {}),
  }));
}

export const router = createBrowserRouter(withErrorElements([
  {
    // Public landing experience; the Control Center lives under the AppShell routes below.
    path: "/",
    element: withSuspense(<RootRoute />),
  },
  {
    // Secure gateway; the brand environment persists across both forms.
    element: withSuspense(<AuthLayout />),
    children: [
      { path: "login", element: withSuspense(<LoginPage />) },
      { path: "signup", element: <Navigate to="/login" replace /> },
      { path: "forgot-password", element: withSuspense(<LoginPage />) },
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
      { path: "workflow-studio", element: withSuspense(<WorkflowStudioPage />) },
      { path: "command", element: withSuspense(<CommandCenterPage />) },
      { path: "security-center", element: withSuspense(<SecurityCenterPage />) },
      { path: "analytics", element: withSuspense(<AnalyticsStudioPage />) },
      { path: "creative", element: withSuspense(<CreativeStudioPage />) },
      { path: "optimization", element: withSuspense(<OptimizationPage />) },
      { path: "agent-teams", element: withSuspense(<AgentTeamsPage />) },
      { path: "graph", element: withSuspense(<SpatialGraphPage />) },
      { path: "projects", element: withSuspense(<ProjectsPage />) },
      { path: "projects/new", element: withSuspense(<NewProjectPage />) },
      { path: "projects/onboarding/:onboardingId", element: withSuspense(<OnboardingPage />) },
      { path: "projects/:projectId", element: withSuspense(<ProjectDetailPage />) },
      { path: "projects/:projectId/operations", element: withSuspense(<ProjectDetailPage />) },
      { path: "projects/:projectId/operations/:sessionId", element: withSuspense(<ProjectDetailPage />) },
      { path: "projects/:projectId/cost", element: withSuspense(<ProjectDetailPage />) },
      { path: "projects/:projectId/model-routing", element: withSuspense(<ProjectDetailPage />) },
      { path: "projects/:projectId/model-routing/:routingDecisionId", element: withSuspense(<ProjectDetailPage />) },
      {
        path: "projects/:projectId/execution-plan",
        element: withSuspense(<ProjectDetailPage />),
      },
      { path: "approvals", element: withSuspense(<ApprovalsPage />) },
      { path: "audit-log", element: withSuspense(<AuditLogPage />) },
      { path: "governance", element: withSuspense(<GovernancePage />) },
      { path: "continuity", element: withSuspense(<ContinuityPage />) },
      { path: "itsm", element: withSuspense(<ITSMPage />) },
      { path: "operations", element: withSuspense(<OperationsPage />) },
      { path: "trust-center", element: withSuspense(<TrustCenterPage />) },
      { path: "ai-governance", element: withSuspense(<AIGovernancePage />) },
      { path: "data-governance", element: withSuspense(<DataGovernancePage />) },
      { path: "security", element: withSuspense(<SecurityPage />) },
      { path: "audit", element: withSuspense(<AuditPage />) },
      { path: "portfolio", element: withSuspense(<PortfolioPage />) },
      { path: "product", element: withSuspense(<ProductPage />) },
      { path: "workforce", element: withSuspense(<WorkforcePage />) },
      { path: "cost", element: withSuspense(<CostCenterPage />) },
      { path: "intelligence", element: withSuspense(<IntelligencePage />) },
      { path: "integrations", element: withSuspense(<IntegrationsPage />) },
      { path: "infrastructure", element: withSuspense(<InfrastructurePage />) },
      { path: "infrastructure/hosts", element: withSuspense(<InfrastructurePage />) },
      { path: "infrastructure/tools", element: withSuspense(<InfrastructurePage />) },
      { path: "software-factory", element: withSuspense(<SoftwareFactoryPage />) },
      { path: "software-factory/:projectId/:programId", element: withSuspense(<SoftwareFactoryProgramPage />) },
      { path: "knowledge", element: withSuspense(<KnowledgePage />) },
      { path: "profile", element: withSuspense(<ProfilePage />) },
      { path: "settings", element: withSuspense(<SettingsPage />) },
      { path: "settings/access", element: adminOnly(withSuspense(<UsersAccessPage />)) },
      { path: "design-system", element: withSuspense(<DesignSystemPage />) },
      { path: "extensions", element: withSuspense(<ExtensionsPage />) },
      { path: "organizations", element: adminOnly(withSuspense(<OrganizationPage />)) },
      { path: "billing", element: adminOnly(withSuspense(<BillingPage />)) },
      { path: "sso-settings", element: adminOnly(withSuspense(<SsoSettingsPage />)) },
      { path: "admin", element: adminOnly(withSuspense(<PlatformAdminPage />)) },
      { path: "commercial-admin", element: adminOnly(withSuspense(<CommercialAdminPage />)) },
      { path: "customer-operations", element: adminOnly(withSuspense(<CustomerProfilePage />)) },
      { path: "incidents", element: withSuspense(<IncidentsPage />) },
      { path: "privacy", element: adminOnly(withSuspense(<PrivacySettingsPage />)) },
      { path: "developer-platform", element: adminOnly(withSuspense(<DeveloperPlatformPage />)) },
      { path: "secops", element: adminOnly(withSuspense(<SecOpsPage />)) },
      { path: "marketing", element: adminOnly(withSuspense(<MarketingPage />)) },
      { path: "trust", element: withSuspense(<TrustCenterPage />) },
    ],
  },
]));
