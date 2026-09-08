/**
 * The authoritative semantic model for every Control Plane API response.
 *
 * These view types are OWNED by the backend `contracts/` package and re-exported
 * here type-only — never redefined. `verbatimModuleSyntax` erases this module at
 * build time, so no backend code is bundled into the browser.
 */
export type {
  DashboardSnapshot,
  WorkforceStatus,
  WorkforceStatusCounts,
  AgentView,
  AgentStats,
  AgentOperationalStatus,
  TaskView,
  TaskQuery,
  WorkflowView,
  WorkflowStageView,
  ApprovalView,
  ApprovalRiskLevel,
  ProjectView,
  ProjectCapabilityView,
  ToolView,
  ToolExecutionStats,
  AuditEventView,
  AuditEventQuery,
  SystemHealth,
  HealthComponent,
  HealthStatus,
  PageResult,
  OperatorRole,
  OperatorPrincipal,
  ControlCommandResult,
  ControlCommandOutcome,
  ControlErrorKind,
} from "../../../contracts/index.js";
