/**
 * The single production Control Plane composition root.
 *
 * It deliberately returns a Node-compatible HTTP handler rather than a
 * Firebase Functions object. DEPLOY-1B can add that thin hosting adapter
 * without changing this authoritative runtime graph.
 */
import {
  type AgentOperationalRecord,
  type Approval,
  type AuditEvent,
  type Handoff,
  type Task,
  type Workflow,
  type WorkflowControlRecord,
} from "../contracts/index.js";
import {
  FirebaseOperatorDirectory,
  FirestoreEventPublisher,
  type FirebaseServices,
  createFirebaseServices,
} from "../adapters/firebase/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  ApprovalSystem,
  AuditLog,
  HandoffSystem,
  Orchestrator,
  TaskSystem,
  WorkflowEngine,
  WorkflowSystem,
} from "../core/index.js";
import { FirebaseRepositoryProvider } from "./firebase-repositories.js";
import { createControlPlaneApi, type ApiHandler } from "./http-api.js";
import {
  createProductionWorkforceBootstrap,
  type ProductionWorkforceBootstrap,
  type ProductionWorkforceConfiguration,
} from "./production-workforce-bootstrap.js";
import { PRODUCTION_WORKFORCE_CONFIGURATION } from "./production-workforce-config.js";

export interface ProductionControlPlaneRuntime {
  readonly handler: ApiHandler;
  readonly context: ControlPlaneContext;
  readonly services: FirebaseServices;
  readonly repositories: FirebaseRepositoryProvider;
  readonly bootstrap: ProductionWorkforceBootstrap;
  readonly query: WorkforceQueryService;
  readonly command: WorkforceCommandService;
  /** Flushes pending Firestore-backed writes on an explicit graceful shutdown. */
  flush(): Promise<void>;
}

export interface ProductionControlPlaneRuntimeOptions {
  /** Injectable only for controlled tests or an alternate trusted host seam. */
  services?: FirebaseServices;
  /** Trusted compiled capability declaration. Defaults to the production one. */
  configuration?: ProductionWorkforceConfiguration;
  collectionPrefix?: string;
}

/**
 * Constructs and hydrates the complete production runtime once. Callers should
 * cache the returned runtime for a serverless warm instance, not per request.
 */
export async function createProductionControlPlaneRuntime(
  options: ProductionControlPlaneRuntimeOptions = {},
): Promise<ProductionControlPlaneRuntime> {
  const services = options.services ?? (await createFirebaseServices());
  const repositories = new FirebaseRepositoryProvider(services.firestore, {
    collectionPrefix: options.collectionPrefix,
  });

  // Allocate every durable collection before one deterministic hydrate pass.
  const taskRepository = repositories.repository<Task>("tasks");
  const workflowRepository = repositories.repository<Workflow>("workflows");
  const approvalRepository = repositories.repository<Approval>("approvals");
  const handoffRepository = repositories.repository<Handoff>("handoffs");
  const auditRepository = repositories.repository<AuditEvent>("audit_events");
  const agentOpsRepository =
    repositories.repository<AgentOperationalRecord>("agent_operations");
  const workflowControlRepository =
    repositories.repository<WorkflowControlRecord>("workflow_control");
  await repositories.hydrateAll();

  const audit = new AuditLog(undefined, auditRepository);
  const bootstrap = createProductionWorkforceBootstrap(
    options.configuration ?? PRODUCTION_WORKFORCE_CONFIGURATION,
    audit,
  );
  const tasks = new TaskSystem(taskRepository);
  const workflows = new WorkflowSystem(workflowRepository);
  const approvals = new ApprovalSystem(approvalRepository);
  const handoffs = new HandoffSystem(handoffRepository);
  const agentOps = new AgentOperationalStore(agentOpsRepository);
  const workflowControl = new WorkflowControlStore(workflowControlRepository);

  const orchestrator = new Orchestrator(
    bootstrap.agents,
    tasks,
    handoffs,
    audit,
    bootstrap.agentExecutors,
    approvals,
    {
      approvalPolicy: bootstrap.approvalPolicy,
      permissions: bootstrap.permissions,
      environment: "production",
      agentGate: agentOps,
    },
  );
  const workflowEngine = new WorkflowEngine({
    registry: bootstrap.agents,
    workflows,
    orchestrator,
    handoffs,
    audit,
    permissions: bootstrap.permissions,
    toolRegistry: bootstrap.tools,
  });
  const context: ControlPlaneContext = {
    agents: bootstrap.agents,
    tasks,
    workflows,
    approvals,
    permissions: bootstrap.permissions,
    tools: bootstrap.tools,
    projects: bootstrap.projects,
    audit,
    agentOps,
    workflowControl,
    orchestrator,
    workflowEngine,
    events: new FirestoreEventPublisher(
      services.firestore.collection("control_events"),
    ),
  };
  const query = new WorkforceQueryService(context);
  const command = new WorkforceCommandService(context);
  const handler = createControlPlaneApi({
    query,
    command,
    operatorDirectory: new FirebaseOperatorDirectory(services.auth),
  });

  return Object.freeze({
    handler,
    context,
    services,
    repositories,
    bootstrap,
    query,
    command,
    flush: () => repositories.flushAll(),
  });
}
