/**
 * The bundle of core services + control-plane stores that the query and command
 * services read from and act through. Everything is injected — the Control
 * Plane owns none of it and constructs none of it.
 */
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  Orchestrator,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowEngine,
  WorkflowSystem,
} from "../core/index.js";
import { type HealthProbe } from "./health.js";
import { type ControlEventPublisher } from "./ports.js";
import { AgentOperationalStore, WorkflowControlStore } from "./stores.js";

export interface ControlPlaneContext {
  agents: AgentRegistry;
  tasks: TaskSystem;
  workflows: WorkflowSystem;
  approvals: ApprovalSystem;
  permissions: PermissionSystem;
  tools: ToolRegistry;
  projects: ProjectRegistry;
  audit: AuditLog;
  agentOps: AgentOperationalStore;
  workflowControl: WorkflowControlStore;
  /**
   * Needed by command enactment (approve → resume). Structural: only these
   * methods are used, so a test can pass a stub.
   */
  orchestrator?: Pick<Orchestrator, "recordApprovalDecision" | "resume">;
  workflowEngine?: Pick<WorkflowEngine, "resume">;
  /** Health probes. Anything not listed is reported as `unknown` (unmeasured). */
  healthProbes?: readonly HealthProbe[];
  /**
   * Optional real-time fan-out. When present, a successful command publishes a
   * `command_result` event. A publisher that throws never breaks the command.
   */
  events?: ControlEventPublisher;
  clock?: () => number;
  /** Max task retries an operator may trigger from the Control Plane. Default 3. */
  maxOperatorRetries?: number;
}
