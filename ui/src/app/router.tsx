/* eslint-disable react-refresh/only-export-components -- route table module, not a component module */
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { RequireAuth } from "../auth/RequireAuth";
import { Spinner } from "../components/ui";
import { useI18n } from "../i18n";
import RouteError from "./RouteError";
import { loadAuthRoutes, loadControlCenterRoutes, loadLanding, loadProjectOnboarding, loadPromptIntelligence, loadExecutionCenter, loadLiveWorkspace, loadKnowledge, loadSecurityCenter, loadIntegrationCenter, loadPlatformCenters } from "./routeModules";

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
const ProfilePage = fromChunk(loadControlCenterRoutes, "ProfilePage");
const InfrastructurePage = fromChunk(loadControlCenterRoutes, "InfrastructurePage");
const SoftwareFactoryPage = fromChunk(loadControlCenterRoutes, "SoftwareFactoryPage");
const SoftwareFactoryProgramPage = fromChunk(loadControlCenterRoutes, "SoftwareFactoryProgramPage");
const UsersAccessPage = fromChunk(loadControlCenterRoutes, "UsersAccessPage");
const ApprovalsPage = fromChunk(loadControlCenterRoutes, "ApprovalsPage");
const ApprovalDetailPage = fromChunk(loadControlCenterRoutes, "ApprovalDetailPage");
const AuditLogPage = fromChunk(loadControlCenterRoutes, "AuditLogPage");
const AuditDetailPage = fromChunk(loadControlCenterRoutes, "AuditDetailPage");
const ProjectsPage = fromChunk(loadControlCenterRoutes, "ProjectsPage");
const ProjectDetailPage = fromChunk(loadControlCenterRoutes, "ProjectDetailPage");
const SpatialGraphPage = fromChunk(loadControlCenterRoutes, "SpatialGraphPage");
const GovernancePage = fromChunk(loadControlCenterRoutes, "GovernancePage");
const CostCenterPage = fromChunk(loadControlCenterRoutes, "CostCenterPage");
const IntelligencePage = fromChunk(loadControlCenterRoutes, "IntelligencePage");
const IntegrationsPage = fromChunk(loadControlCenterRoutes, "IntegrationsPage");
const NewProjectPage = fromChunk(loadProjectOnboarding, "NewProjectPage");
const OnboardingPage = fromChunk(loadProjectOnboarding, "OnboardingPage");
const PromptIntelligencePage = fromChunk(loadPromptIntelligence, "PromptIntelligencePage");
const ExecutionCenterPage = fromChunk(loadExecutionCenter, "ExecutionCenterPage");
const LiveWorkspacePage = fromChunk(loadLiveWorkspace, "LiveWorkspacePage");
const KnowledgePage = fromChunk(loadKnowledge, "KnowledgePage");
const SecurityCenterPage = fromChunk(loadSecurityCenter, "SecurityCenterPage");
const IntegrationCenterPage = fromChunk(loadIntegrationCenter, "IntegrationCenterPage");
const ExtensionPlatformPage = fromChunk(loadPlatformCenters, "ExtensionPlatformPage");
const BusinessLayerPage = fromChunk(loadPlatformCenters, "BusinessLayerPage");
const ProjectPortfolioPage = fromChunk(loadPlatformCenters, "ProjectPortfolioPage");
const OperationsCenterPage = fromChunk(loadPlatformCenters, "OperationsCenterPage");
const AnalyticsCenterPage = fromChunk(loadPlatformCenters, "AnalyticsCenterPage");
const ExtensionsPage = fromChunk(loadControlCenterRoutes, "ExtensionsPage");
const PlatformAdminPage = fromChunk(loadControlCenterRoutes, "PlatformAdminPage");

const PrivacySettingsPage = fromChunk(loadControlCenterRoutes, "PrivacySettingsPage");
const DeveloperPlatformPage = fromChunk(loadControlCenterRoutes, "DeveloperPlatformPage");
const SecOpsPage = fromChunk(loadControlCenterRoutes, "SecOpsPage");
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
const KnowledgeItemsPage = fromChunk(loadControlCenterRoutes, "KnowledgeItemsPage");

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
      { path: "graph", element: withSuspense(<SpatialGraphPage />) },
      { path: "projects", element: withSuspense(<ProjectsPage />) },
      { path: "projects/new", element: withSuspense(<NewProjectPage />) },
      { path: "projects/onboarding/:onboardingId", element: withSuspense(<OnboardingPage />) },
      { path: "prompt-intelligence", element: withSuspense(<PromptIntelligencePage />) },
      { path: "prompt-intelligence/:requestId", element: withSuspense(<PromptIntelligencePage />) },
      { path: "execution-center", element: withSuspense(<ExecutionCenterPage />) },
      { path: "execution-center/:runId", element: withSuspense(<ExecutionCenterPage />) },
      { path: "workspace", element: withSuspense(<LiveWorkspacePage />) },
      { path: "workspace/:executionId", element: withSuspense(<LiveWorkspacePage />) },
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
      { path: "approvals/:approvalId", element: withSuspense(<ApprovalDetailPage />) },
      { path: "audit-log", element: withSuspense(<AuditLogPage />) },
      { path: "audit-log/:eventId", element: withSuspense(<AuditDetailPage />) },
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
      { path: "knowledge/:tab", element: withSuspense(<KnowledgePage />) },
      { path: "knowledge/:tab/:memoryId", element: withSuspense(<KnowledgePage />) },
      { path: "knowledge-items", element: withSuspense(<KnowledgeItemsPage />) },
      { path: "knowledge-items/:knowledgeId", element: withSuspense(<KnowledgeItemsPage />) },
      { path: "security-center", element: withSuspense(<SecurityCenterPage />) },
      { path: "security-center/:tab", element: withSuspense(<SecurityCenterPage />) },
      { path: "security-center/:tab/:itemId", element: withSuspense(<SecurityCenterPage />) },
      { path: "integration-center", element: withSuspense(<IntegrationCenterPage />) },
      { path: "integration-center/:tab", element: withSuspense(<IntegrationCenterPage />) },
      { path: "integration-center/:tab/:itemId", element: withSuspense(<IntegrationCenterPage />) },
      { path: "extension-platform", element: withSuspense(<ExtensionPlatformPage />) },
      { path: "extension-platform/:tab", element: withSuspense(<ExtensionPlatformPage />) },
      { path: "extension-platform/:tab/:itemId", element: withSuspense(<ExtensionPlatformPage />) },
      { path: "business-layer", element: withSuspense(<BusinessLayerPage />) },
      { path: "business-layer/:tab", element: withSuspense(<BusinessLayerPage />) },
      { path: "business-layer/:tab/:itemId", element: withSuspense(<BusinessLayerPage />) },
      { path: "project-portfolio", element: withSuspense(<ProjectPortfolioPage />) },
      { path: "project-portfolio/:tab", element: withSuspense(<ProjectPortfolioPage />) },
      { path: "operations-center", element: withSuspense(<OperationsCenterPage />) },
      { path: "operations-center/:tab", element: withSuspense(<OperationsCenterPage />) },
      { path: "operations-center/:tab/:itemId", element: withSuspense(<OperationsCenterPage />) },
      { path: "analytics-center", element: withSuspense(<AnalyticsCenterPage />) },
      { path: "analytics-center/:tab", element: withSuspense(<AnalyticsCenterPage />) },
      { path: "profile", element: withSuspense(<ProfilePage />) },
      { path: "settings", element: withSuspense(<SettingsPage />) },
      { path: "settings/access", element: withSuspense(<UsersAccessPage />) },
      { path: "design-system", element: withSuspense(<DesignSystemPage />) },
      { path: "extensions", element: withSuspense(<ExtensionsPage />) },
      { path: "admin", element: withSuspense(<PlatformAdminPage />) },
      { path: "privacy", element: withSuspense(<PrivacySettingsPage />) },
      { path: "developer-platform", element: withSuspense(<DeveloperPlatformPage />) },
      { path: "secops", element: withSuspense(<SecOpsPage />) },
      { path: "trust", element: withSuspense(<TrustCenterPage />) },
    ],
  },
]));
