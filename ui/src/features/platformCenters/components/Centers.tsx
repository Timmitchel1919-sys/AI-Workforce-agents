import { CenterShell } from "./CenterShell";
import { CatalogueTab, DetailTab, RegisterTab, RegistryTab } from "./ExtensionsScreens";
import { BoardTab, DecisionsTab, DepartmentsTab, ObjectivesTab, OrganizationTab, PlansTab } from "./BusinessScreens";
import { AskTab, DashboardTab, KnowledgeTab, PrioritiesTab, ProjectsTab, RelationsTab } from "./PortfolioScreens";
import { ApprovalsTab, AuditTab, AutonomyTab, IncidentsTab, OverviewTab as OpsOverview, WorkflowsTab } from "./OperationsScreens";
import { AgentsTab, CostTab, LessonsTab, OverviewTab as AnOverview, PredictionsTab, RecommendationsTab, WhatIfTab, WorkflowsProjectsTab } from "./AnalyticsScreens";

const EXTENSION_TABS = ["registry", "detail", "register", "catalogue"] as const;
export function ExtensionPlatform() {
  return (
    <CenterShell
      base="/extension-platform"
      group="ext"
      tabs={EXTENSION_TABS}
      defaultTab="registry"
      itemTabs={["detail"]}
      render={({ tab, itemId, scope }) =>
        tab === "detail" ? <DetailTab id={itemId} /> : tab === "register" ? <RegisterTab /> : tab === "catalogue" ? <CatalogueTab /> : <RegistryTab search={scope.search} />
      }
    />
  );
}

const BUSINESS_TABS = ["board", "organization", "departments", "objectives", "plans", "decisions"] as const;
export function BusinessLayer() {
  return (
    <CenterShell
      base="/business-layer"
      group="biz"
      tabs={BUSINESS_TABS}
      defaultTab="board"
      itemTabs={["objectives"]}
      render={({ tab, itemId, scope }) =>
        tab === "organization" ? <OrganizationTab /> : tab === "departments" ? <DepartmentsTab /> : tab === "objectives" ? <ObjectivesTab itemId={itemId} search={scope.search} /> : tab === "plans" ? <PlansTab /> : tab === "decisions" ? <DecisionsTab /> : <BoardTab />
      }
    />
  );
}

const PORTFOLIO_TABS = ["dashboard", "projects", "priorities", "relations", "ask", "knowledge"] as const;
export function ProjectPortfolio() {
  return (
    <CenterShell
      base="/project-portfolio"
      group="pf"
      tabs={PORTFOLIO_TABS}
      defaultTab="dashboard"
      render={({ tab }) =>
        tab === "projects" ? <ProjectsTab /> : tab === "priorities" ? <PrioritiesTab /> : tab === "relations" ? <RelationsTab /> : tab === "ask" ? <AskTab /> : tab === "knowledge" ? <KnowledgeTab /> : <DashboardTab />
      }
    />
  );
}

const OPERATIONS_TABS = ["overview", "approvals", "workflows", "autonomy", "incidents", "audit"] as const;
export function OperationsCenter() {
  return (
    <CenterShell
      base="/operations-center"
      group="ops"
      tabs={OPERATIONS_TABS}
      defaultTab="overview"
      itemTabs={["workflows"]}
      render={({ tab, itemId, scope }) =>
        tab === "approvals" ? <ApprovalsTab /> : tab === "workflows" ? <WorkflowsTab itemId={itemId} scope={scope} /> : tab === "autonomy" ? <AutonomyTab scope={scope} /> : tab === "incidents" ? <IncidentsTab /> : tab === "audit" ? <AuditTab scope={scope} /> : <OpsOverview scope={scope} />
      }
    />
  );
}

const ANALYTICS_TABS = ["overview", "agents", "workflows", "cost", "predictions", "recommendations", "whatif", "lessons"] as const;
export function AnalyticsCenter() {
  return (
    <CenterShell
      base="/analytics-center"
      group="an"
      tabs={ANALYTICS_TABS}
      defaultTab="overview"
      render={({ tab, scope }) =>
        tab === "agents" ? <AgentsTab /> : tab === "workflows" ? <WorkflowsProjectsTab scope={scope} /> : tab === "cost" ? <CostTab scope={scope} /> : tab === "predictions" ? <PredictionsTab /> : tab === "recommendations" ? <RecommendationsTab /> : tab === "whatif" ? <WhatIfTab scope={scope} /> : tab === "lessons" ? <LessonsTab /> : <AnOverview />
      }
    />
  );
}
