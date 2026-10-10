/* eslint-disable react-refresh/only-export-components -- route table module, not a component module */
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { RequireAuth } from "../auth/RequireAuth";
import { Spinner } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import RouteError from "./RouteError";
import { loadAuthRoutes, loadControlCenterRoutes, loadLanding, loadProjectOnboarding, loadPromptIntelligence } from "./routeModules";

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
const PromptIntelligencePage = fromChunk(loadPromptIntelligence, "PromptIntelligencePage");
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
      { path: "knowledge", element: <PlaceholderPage titleKey="nav.knowledge" /> },
      { path: "profile", element: withSuspense(<ProfilePage />) },
      { path: "settings", element: withSuspense(<SettingsPage />) },
      { path: "settings/access", element: withSuspense(<UsersAccessPage />) },
      { path: "design-system", element: withSuspense(<DesignSystemPage />) },
      { path: "extensions", element: withSuspense(<ExtensionsPage />) },
      { path: "organizations", element: withSuspense(<OrganizationPage />) },
      { path: "billing", element: withSuspense(<BillingPage />) },
      { path: "sso-settings", element: withSuspense(<SsoSettingsPage />) },
      { path: "admin", element: withSuspense(<PlatformAdminPage />) },
      { path: "commercial-admin", element: withSuspense(<CommercialAdminPage />) },
      { path: "customer-operations", element: withSuspense(<CustomerProfilePage />) },
      { path: "incidents", element: withSuspense(<IncidentsPage />) },
      { path: "privacy", element: withSuspense(<PrivacySettingsPage />) },
      { path: "developer-platform", element: withSuspense(<DeveloperPlatformPage />) },
      { path: "secops", element: withSuspense(<SecOpsPage />) },
      { path: "marketing", element: withSuspense(<MarketingPage />) },
      { path: "trust", element: withSuspense(<TrustCenterPage />) },
    ],
  },
]));
