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
  type EnvironmentCodeRoute,
  type EnvironmentInstance,
  type EnvironmentRequirement,
  type Handoff,
  type HostInstance,
  type SoftwareFactoryEnvironmentProvider,
  type Task,
  type Workflow,
  type WorkflowControlRecord,
} from "../contracts/index.js";
import {
  FirebaseOperatorDirectory,
  FirestoreExecutionPlanStore,
  FirestoreExecutionRecordStore,
  FirestoreExecutionSessionStore,
  FirestoreOperatorAccountStore,
  FirestoreOperatorProfileStore,
  isTransactionalFirestore,
  FirestoreEventPublisher,
  type FirebaseServices,
  createFirebaseServices,
} from "../adapters/firebase/index.js";
import { createPlatformAdapters } from "../adapters/environments/index.js";
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
  EnvironmentDetector,
  EnvironmentRegistry,
  EnvironmentRouter,
  HandoffSystem,
  Orchestrator,
  ProbeRegistry,
  SoftwareFactoryOrchestrator,
  TaskSystem,
  WorkflowEngine,
  WorkflowSystem,
  AccessService,
  BASELINE_DENY_ALL_POLICY,
  ExecutionManager,
  ExecutionOperationRegistry,
  ExecutionPolicyRegistry,
  InMemoryExecutionReceiptStore,
  EnvironmentAdapterRegistry,
  SandboxRegistry,
  ProfileService,
  ExecutionPlanningService,
  ValidationError,
} from "../core/index.js";
import { FirebaseRepositoryProvider } from "./firebase-repositories.js";
import { createControlPlaneApi, type ApiHandler } from "./http-api.js";
import {
  createProductionWorkforceBootstrap,
  type ProductionWorkforceBootstrap,
  type ProductionWorkforceConfiguration,
} from "./production-workforce-bootstrap.js";
import {
  PRODUCTION_ENVIRONMENT_DESCRIPTORS,
  PRODUCTION_WORKFORCE_CONFIGURATION,
} from "./production-workforce-config.js";

export interface ProductionControlPlaneRuntime {
  readonly handler: ApiHandler;
  readonly context: ControlPlaneContext;
  readonly services: FirebaseServices;
  readonly repositories: FirebaseRepositoryProvider;
  readonly bootstrap: ProductionWorkforceBootstrap;
  readonly query: WorkforceQueryService;
  readonly command: WorkforceCommandService;
  /** Environment discovery orchestration (no live probes wired in EO-2A). */
  readonly environmentDetector: EnvironmentDetector;
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
  // Environment orchestration collections — empty until live discovery (EO-2B+)
  // registers real hosts/environments. No fake hosts are ever seeded.
  const hostRepository = repositories.repository<HostInstance>("hosts");
  const environmentInstanceRepository =
    repositories.repository<EnvironmentInstance>("environment_instances");
  await repositories.hydrateAll();

  const audit = new AuditLog(undefined, auditRepository);
  const environmentRegistry = new EnvironmentRegistry({
    hosts: hostRepository,
    instances: environmentInstanceRepository,
  });
  for (const descriptor of PRODUCTION_ENVIRONMENT_DESCRIPTORS) {
    environmentRegistry.registerDescriptor(descriptor);
  }
  // EO-2A ships the environment discovery *framework*; production wires no live
  // probes yet, so hosts/environments remain derived from future platform
  // probes only. The detector is built now to prove the production graph.
  const environmentDetector = new EnvironmentDetector(
    environmentRegistry,
    new ProbeRegistry(),
    audit,
  );
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
  // Planning uses the REAL registries. Production declares no model
  // capability profiles yet, so model requirements are reported as missing
  // (MISSING_MODEL_CAPABILITY) rather than assumed.
  const firestore = services.firestore;
  if (!isTransactionalFirestore(firestore)) {
    throw new ValidationError(
      "execution planning requires a Firestore client with transactions",
    );
  }
  const transactionalFirestore = firestore;
  const planning = new ExecutionPlanningService({
    environments: environmentRegistry,
    agents: bootstrap.agents,
    audit,
    approvals,
    // Authoritative + transactional (EO-3.2): no write-through cache, so
    // concurrent instances cannot fork or overwrite plan history.
    store: new FirestoreExecutionPlanStore(transactionalFirestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    isAgentEnabled: (agentId) => agentOps.isEnabled(agentId),
    projectExists: (projectId) => bootstrap.projects.has(projectId),
  });
  // AUTHZ-1: operator accounts (Firestore, transactional) are the only source
  // of authorization. A valid Firebase token alone grants nothing.
  const operatorAccounts = new FirestoreOperatorAccountStore(
    transactionalFirestore,
    { collectionPrefix: options.collectionPrefix },
  );
  const access = new AccessService({
    store: operatorAccounts,
    audit,
    projects: bootstrap.projects,
  });
  const profile = new ProfileService({
    profiles: new FirestoreOperatorProfileStore(transactionalFirestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    accounts: operatorAccounts,
    audit,
  });
  const operatorDirectory = new FirebaseOperatorDirectory(
    services.auth,
    operatorAccounts,
  );
  // EO-4.1: the execution CONTROL BOUNDARY only. A versioned baseline policy
  // that permits nothing, no registered operations and no sandbox provider:
  // every pre-flight is DENIED until a later EO registers real, bounded
  // operations, a provider and an explicit project policy. Nothing executes.
  const executionPolicies = new ExecutionPolicyRegistry({
    policyId: BASELINE_DENY_ALL_POLICY.policyId,
    version: BASELINE_DENY_ALL_POLICY.version,
  });
  executionPolicies.register(BASELINE_DENY_ALL_POLICY);
  // EO-4.5/4.7: platform adapter CONTRACTS only — no runner is registered in
  // production, so every family reports `not_configured` and nothing runs.
  const environmentAdapters = new EnvironmentAdapterRegistry({
    environments: environmentRegistry,
    audit,
  });
  createPlatformAdapters({
    containerPolicy: { approvedImages: [], requireDigest: true },
  }).forEach((adapter) => environmentAdapters.registerAdapter(adapter));
  const executionReceipts = new InMemoryExecutionReceiptStore();
  const executionRecords = new FirestoreExecutionRecordStore(
    transactionalFirestore,
    { collectionPrefix: options.collectionPrefix },
  );
  const execution = new ExecutionManager({
    planning,
    approvals,
    agents: bootstrap.agents,
    isAgentEnabled: (agentId) => agentOps.isEnabled(agentId),
    environments: environmentRegistry,
    tools: bootstrap.tools,
    projects: bootstrap.projects,
    operations: new ExecutionOperationRegistry(),
    policies: executionPolicies,
    sandboxes: new SandboxRegistry(),
    // EO-4.8: sessions are transactional in Firestore (CAS across instances);
    // every receipt is also written create-only before a response returns.
    sessions: new FirestoreExecutionSessionStore(transactionalFirestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    audit,
    receipts: executionReceipts,
    receiptStore: executionRecords,
    environmentAdapters,
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
    environments: environmentRegistry,
    planning,
    execution,
    executionReceipts,
    executionRecords,
    environmentAdapters,
    access,
    orchestrator,
    softwareFactory: new SoftwareFactoryOrchestrator(
      orchestrator,
      tasks,
      await buildSoftwareFactoryEnvironmentProvider(environmentRegistry),
    ),
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
    operatorDirectory,
    identityVerifier: operatorDirectory,
    access,
    profile,
  });

  return Object.freeze({
    handler,
    context,
    services,
    repositories,
    bootstrap,
    query,
    command,
    environmentDetector,
    flush: () => repositories.flushAll(),
  });
}

/**
 * EO-5.1 software-factory environment provider, built from the production
 * `EnvironmentRouter` (derived from the `EnvironmentRegistry` in this
 * composition root). The environment stack owns
 * `core/environments/software-factory-router.ts`; if that module (or a router)
 * is not usable at runtime, we deny every environment code (`UNSUPPORTED`)
 * rather than crash startup — a software-factory task that needs an environment
 * simply stays `created`, never auto-executes.
 */
async function buildSoftwareFactoryEnvironmentProvider(
  environmentRegistry: EnvironmentRegistry,
): Promise<SoftwareFactoryEnvironmentProvider> {
  try {
    const router = new EnvironmentRouter(environmentRegistry);
    const { createSoftwareFactoryEnvironmentProvider } =
      await import("../core/environments/software-factory-router.js");
    return createSoftwareFactoryEnvironmentProvider(router);
  } catch (error) {
    void error;
    return denyByDefaultEnvironmentProvider();
  }
}

/** Deny-by-default provider: every code is unsupported; nothing routes. */
function denyByDefaultEnvironmentProvider(): SoftwareFactoryEnvironmentProvider {
  const reason =
    "no environment router available — this environment code is unsupported";
  return {
    requirementFor(): EnvironmentRequirement | null {
      return null;
    },
    route(codes: readonly string[]): readonly EnvironmentCodeRoute[] {
      return codes.map((code) => ({
        code,
        requirement: null,
        outcome: { outcome: "UNSUPPORTED", reason },
      }));
    },
  };
}
