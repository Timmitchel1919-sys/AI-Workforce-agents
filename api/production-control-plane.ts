import { GraphQueryService } from "../control/services/graph-query-service.js";
/**
 * The single production Control Plane composition root.
 *
 * It deliberately returns a Node-compatible HTTP handler rather than a
 * Firebase Functions object. DEPLOY-1B can add that thin hosting adapter
 * without changing this authoritative runtime graph.
 */
import { randomUUID } from "node:crypto";
import {
  type AgentOperationalRecord,
  type Approval,
  type AuditEvent,
  type EnvironmentCodeRoute,
  type EnvironmentInstance,
  type EnvironmentRequirement,
  type Handoff,
  type HostInstance,
  type ModelRequirementProfile,
  type SoftwareFactoryEnvironmentProvider,
  type SoftwareFactoryProgram,
  type SoftwareFactoryTaskAlias,
  type Workstream,
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
  FirestoreOnboardingSessionStore,
  FirestoreProvisionedProjectStore,
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
  BudgetEnforcer,
  BudgetPolicyStore,
  EnvironmentDetector,
  EnvironmentRegistry,
  EnvironmentRouter,
  HandoffSystem,
  SpecialistHandoffService,
  InMemoryAssignmentRepository,
  InMemoryLeaseRepository,
  SpecialistAssignmentService,
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
  GitHubRepositoryReader,
  OnboardingService,
  ProjectProvisioningService,
  ArtifactManager,
  DeploymentOrchestrator,
  GovernancePolicyEngine,
  GovernancePolicyStore,
  ModelCapabilityRegistry,
  ModelProviderRegistry,
  ModelRouter,
  RoutedModelProvider,
  RuleAuditor,
  SourceControlOrchestrator,
  UnavailableArtifactSource,
  UnavailableGovernedGit,
  UnavailableWorkspaceControl,
  UsageLedger,
  VerificationService,
  deriveCostCenterCapabilities,
  deriveReleaseCapabilities,
  now,
} from "../core/index.js";
import {
  CONTROL_PLANE_ANALYSIS_AGENT_ID,
  LazyOpenAIModelProvider,
  createProductionOpenAIAgentExecutor,
} from "../agents/control-plane-analysis/index.js";
import {
  DEVELOPER_AGENT_ID,
  DeveloperAgent,
} from "../agents/developer/index.js";
import { QA_AGENT_ID, QaAgent } from "../agents/qa/index.js";
import {
  PROJECT_MANAGER_AGENT_ID,
  ProjectManagerAgent,
} from "../agents/project-manager/index.js";
import { SpecialistAgent } from "../agents/specialists/index.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import { OnboardingControlService } from "../control/services/onboarding-control-service.js";
import { ProvisionedProjectAdapter } from "../adapters/projects/provisioned/provisioned-project-adapter.js";
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
  /**
   * The FULL release services. The control-plane context exposes only their read views; the
   * trusted host (and tests) hold the whole thing. No HTTP route reaches the mutating methods.
   */
  readonly release: {
    readonly verification: VerificationService;
    readonly sourceControl: SourceControlOrchestrator;
    readonly deployments: DeploymentOrchestrator;
  };
  /**
   * The FULL EO-6.2/6.3 Cost Center + Governance services, including the model-provider registry a
   * future real adapter registers with. The context exposes only read views and the admin-gated
   * `set` writers (which self-authorize); no HTTP route can register a provider.
   */
  readonly costCenter: {
    readonly modelProviders: ModelProviderRegistry;
    readonly usage: UsageLedger;
    readonly budgetPolicies: BudgetPolicyStore;
    readonly enforcer: BudgetEnforcer;
    readonly auditor: RuleAuditor;
    readonly governancePolicies: GovernancePolicyStore;
    readonly governanceEngine: GovernancePolicyEngine;
  };
  /** EO-7: the FULL Model Router services. The context exposes only read views. */
  readonly routing: {
    readonly modelCapabilities: ModelCapabilityRegistry;
    readonly router: ModelRouter;
  };
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
  const softwareFactoryProgramRepository =
    repositories.repository<SoftwareFactoryProgram>(
      "software_factory_programs",
    );
  const softwareFactoryWorkstreamRepository =
    repositories.repository<Workstream>("software_factory_workstreams");
  const softwareFactoryAliasRepository =
    repositories.repository<SoftwareFactoryTaskAlias>(
      "software_factory_task_aliases",
    );
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
  // EO-7: a REAL, declared capability profile for the one real provider this deployment has —
  // never fabricated (no vision/coding/large_context claimed; only what this agent actually
  // exercises: `generateStructured` and general text reasoning). No `model` is pinned — the
  // profile matches whatever `OPENAI_MODEL` the provider is actually configured with at call
  // time, which this composition root never reads (that stays inside the provider adapter).
  const modelCapabilities = new ModelCapabilityRegistry([
    {
      id: "openai-default",
      providerId: "openai",
      capabilities: ["reasoning", "structured_output"],
    },
  ]);
  const bootstrap = createProductionWorkforceBootstrap(
    options.configuration ?? PRODUCTION_WORKFORCE_CONFIGURATION,
    audit,
  );
  const tasks = new TaskSystem(taskRepository, {
    newId: () => `task_${randomUUID()}`,
  });
  const workflows = new WorkflowSystem(workflowRepository);
  const approvals = new ApprovalSystem(approvalRepository);
  const handoffs = new HandoffSystem(handoffRepository);
  // The specialist layer, composed against the SAME registry the executor uses.
  // A second, independent copy of the workforce here would let routing and
  // execution disagree about who exists and who is enabled — which is precisely
  // the failure this layer exists to remove.
  const agentOps = new AgentOperationalStore(agentOpsRepository);
  const assignmentRepository = new InMemoryAssignmentRepository();
  const specialistAssignments = new SpecialistAssignmentService(
    assignmentRepository,
    () => bootstrap.agents.listDescriptors(),
    new InMemoryLeaseRepository(),
    () => new Date().toISOString(),
    audit,
    environmentRegistry,
  );
  const specialistHandoffs = new SpecialistHandoffService(
    () => bootstrap.agents.listDescriptors(),
    (agentId, projectId) => agentOps.isEnabled(agentId, projectId),
    handoffRepository,
  );
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
    models: modelCapabilities,
    // Authoritative + transactional (EO-3.2): no write-through cache, so
    // concurrent instances cannot fork or overwrite plan history.
    store: new FirestoreExecutionPlanStore(transactionalFirestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    isAgentEnabled: (agentId, projectId) =>
      agentOps.isEnabled(agentId, projectId),
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
  // Shared with the verification service below: it must see exactly the operations and sandbox
  // providers the execution manager sees — one registry each, never a second copy.
  const executionOperations = new ExecutionOperationRegistry();
  const executionSandboxes = new SandboxRegistry();
  const execution = new ExecutionManager({
    planning,
    approvals,
    agents: bootstrap.agents,
    isAgentEnabled: (agentId, projectId) =>
      agentOps.isEnabled(agentId, projectId),
    environments: environmentRegistry,
    tools: bootstrap.tools,
    projects: bootstrap.projects,
    operations: executionOperations,
    policies: executionPolicies,
    sandboxes: executionSandboxes,
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
  // EO-6.1: the release pipeline (verification → review → commit/push → deployment), composed
  // against the SAME approvals, audit, durable record store and execution manager as everything
  // else. Production has no workspace, no Git and no deployment adapter, so every capability that
  // needs one is a fail-closed "unavailable" port: the services read their durable records and
  // enforce their state machines, and anything that would act is DENIED (never simulated).
  const unavailableWorkspace = new UnavailableWorkspaceControl();
  const unavailableArtifactSource = new UnavailableArtifactSource();
  const unavailableGit = new UnavailableGovernedGit();
  const artifacts = new ArtifactManager({
    source: unavailableArtifactSource,
    maxArtifactBytes: 50 * 1024 * 1024,
  });
  const verification = new VerificationService({
    manager: execution,
    planning,
    operations: executionOperations,
    environments: environmentRegistry,
    sandboxes: executionSandboxes,
    projects: bootstrap.projects,
    audit,
    artifacts,
    workspaceControl: unavailableWorkspace,
    store: executionRecords,
  });
  const sourceControl = new SourceControlOrchestrator({
    git: unavailableGit,
    verification,
    manager: execution,
    workspaceControl: unavailableWorkspace,
    approvals,
    projects: bootstrap.projects,
    audit,
    store: executionRecords,
  });
  const deployments = new DeploymentOrchestrator({
    sourceControl,
    verification,
    artifacts,
    approvals,
    projects: bootstrap.projects,
    audit,
    store: executionRecords,
  });
  // DERIVED, at read time, from the ports and registries the services were composed with — never
  // declared. A capability turns on only when a real provider/adapter is registered.
  const releaseCapabilities = deriveReleaseCapabilities({
    sandboxes: executionSandboxes,
    operations: executionOperations,
    git: unavailableGit,
    workspace: unavailableWorkspace,
    artifactSource: unavailableArtifactSource,
    deployments,
  });
  // EO-6.2/6.3: the AI Cost Center, rule-based Auditor and Governance Policy Engine. None of these
  // need a model provider to exist — they are always composed here.
  // EO-7 registers the ONE real provider this deployment has: the SAME `LazyOpenAIModelProvider`
  // the control-plane-analysis agent's executor uses, so `costCenterCapabilities.enforcement`
  // truthfully flips to `true` — there IS a real, governable model-call path now, whether or not
  // `OPENAI_API_KEY`/`OPENAI_MODEL` are actually configured (the provider itself still fails
  // closed if they are absent; registering the FACTORY reads no secret).
  const modelProviders = new ModelProviderRegistry();
  modelProviders.register("openai", () => new LazyOpenAIModelProvider());
  const usageLedger = new UsageLedger(executionRecords, now);
  const budgetPolicies = new BudgetPolicyStore(executionRecords, now, audit);
  const budgetEnforcer = new BudgetEnforcer(budgetPolicies, usageLedger, now);
  const ruleAuditor = new RuleAuditor(now, audit);
  const costCenterCapabilities = deriveCostCenterCapabilities({
    providers: modelProviders,
  });
  const governancePolicies = new GovernancePolicyStore(
    executionRecords,
    now,
    audit,
  );
  const governanceEngine = new GovernancePolicyEngine(
    governancePolicies,
    budgetEnforcer,
    now,
    approvals,
    audit,
  );
  const modelRouter = new ModelRouter(
    modelCapabilities,
    modelProviders,
    governanceEngine,
    now,
    executionRecords,
    audit,
    budgetEnforcer,
    governancePolicies,
  );
  // This agent has no per-call cost pre-estimate to offer yet (see ADR-0029), so its one allowed
  // project explicitly permits proceeding on unknown cost — the REAL budget hard-stop still
  // applies regardless (`BudgetEnforcer.evaluateInternal`, checked unconditionally). Every OTHER
  // project stays fail-closed by default (EO-6.3's reviewed, unchanged behavior).
  await governancePolicies.setTrusted("money-mind", { allowUnknownCost: true });
  bootstrap.agentExecutors.replace(
    CONTROL_PLANE_ANALYSIS_AGENT_ID,
    createProductionOpenAIAgentExecutor(audit, {
      router: modelRouter,
      usageLedger,
    }),
  );
  // EO-8: the three specialist agents (Developer/QA/Project Manager) were fully implemented and
  // tested but never wired into any production composition root. Same two-phase pattern as the
  // control-plane analysis agent above: `production-workforce-config.ts` binds each to a real but
  // UNROUTED provider at bootstrap time (before the Router/Cost Center exist), and this replaces
  // that binding with one wrapped in `RoutedModelProvider` — routed before every call, metered
  // after a successful one, requested-vs-actual model mismatches audited — the SAME reviewed EO-7
  // pipeline, generalized to any plain `ModelProvider`-based agent. Nothing reaches the unrouted
  // binding for a real request; it exists only for the instant between bootstrap and this call.
  const specialistRequirement: ModelRequirementProfile = {
    requiredCapabilities: ["reasoning", "structured_output"],
  };
  bootstrap.agentExecutors.replace(
    DEVELOPER_AGENT_ID,
    new DeveloperAgent({
      audit,
      model: new RoutedModelProvider({
        inner: new LazyOpenAIModelProvider(),
        router: modelRouter,
        agent: bootstrap.agents.require(DEVELOPER_AGENT_ID),
        requirement: specialistRequirement,
        usageLedger,
        audit,
      }),
    }),
  );
  bootstrap.agentExecutors.replace(
    QA_AGENT_ID,
    new QaAgent({
      audit,
      model: new RoutedModelProvider({
        inner: new LazyOpenAIModelProvider(),
        router: modelRouter,
        agent: bootstrap.agents.require(QA_AGENT_ID),
        requirement: specialistRequirement,
        usageLedger,
        audit,
      }),
    }),
  );
  bootstrap.agentExecutors.replace(
    PROJECT_MANAGER_AGENT_ID,
    new ProjectManagerAgent({
      audit,
      model: new RoutedModelProvider({
        inner: new LazyOpenAIModelProvider(),
        router: modelRouter,
        agent: bootstrap.agents.require(PROJECT_MANAGER_AGENT_ID),
        requirement: specialistRequirement,
        usageLedger,
        audit,
      }),
    }),
  );

  for (const agent of V1_SPECIALIST_WORKFORCE) {
    bootstrap.agentExecutors.replace(
      agent.id,
      new SpecialistAgent({
        descriptor: agent,
        audit,
        model: new RoutedModelProvider({
          inner: new LazyOpenAIModelProvider(),
          router: modelRouter,
          agent: bootstrap.agents.require(agent.id),
          requirement: specialistRequirement,
          usageLedger,
          audit,
        }),
      }),
    );
  }
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
    // READ-ONLY views: the context can list history/activity/releases and nothing else, at runtime
    // as well as by type. The full services live on `runtime.release` for the trusted host.
    verification: {
      listHistory: (...a: Parameters<typeof verification.listHistory>) =>
        verification.listHistory(...a),
    },
    sourceControl: {
      activity: (...a: Parameters<typeof sourceControl.activity>) =>
        sourceControl.activity(...a),
    },
    deployments: {
      listReleases: (...a: Parameters<typeof deployments.listReleases>) =>
        deployments.listReleases(...a),
      listTargets: (...a: Parameters<typeof deployments.listTargets>) =>
        deployments.listTargets(...a),
    },
    releaseCapabilities,
    costCenter: {
      usage: {
        listByProject: (...a: Parameters<typeof usageLedger.listByProject>) =>
          usageLedger.listByProject(...a),
      },
      budgetPolicy: {
        get: (...a: Parameters<typeof budgetPolicies.get>) =>
          budgetPolicies.get(...a),
        set: (...a: Parameters<typeof budgetPolicies.set>) =>
          budgetPolicies.set(...a),
      },
      enforcer: {
        evaluate: (...a: Parameters<typeof budgetEnforcer.evaluate>) =>
          budgetEnforcer.evaluate(...a),
      },
    },
    costCenterCapabilities,
    auditor: {
      run: (...a: Parameters<typeof ruleAuditor.run>) => ruleAuditor.run(...a),
    },
    governance: {
      policy: {
        get: (...a: Parameters<typeof governancePolicies.get>) =>
          governancePolicies.get(...a),
        set: (...a: Parameters<typeof governancePolicies.set>) =>
          governancePolicies.set(...a),
      },
      engine: {
        evaluate: (...a: Parameters<typeof governanceEngine.evaluate>) =>
          governanceEngine.evaluate(...a),
      },
    },
    routing: {
      router: {
        get: (...a: Parameters<typeof modelRouter.get>) =>
          modelRouter.get(...a),
        listByProject: (...a: Parameters<typeof modelRouter.listByProject>) =>
          modelRouter.listByProject(...a),
      },
    },
    executionReceipts,
    executionRecords,
    environmentAdapters,
    access,
    orchestrator,
    softwareFactory: new SoftwareFactoryOrchestrator(
      orchestrator,
      tasks,
      await buildSoftwareFactoryEnvironmentProvider(environmentRegistry),
      {
        persistence: {
          programs: softwareFactoryProgramRepository,
          workstreams: softwareFactoryWorkstreamRepository,
          executionAliases: softwareFactoryAliasRepository,
        },
        projectExists: (projectId) => bootstrap.projects.has(projectId),
      },
    ),
    workflowEngine,
    events: new FirestoreEventPublisher(
      services.firestore.collection("control_events"),
    ),
  };
  // PROJECT-2: onboarding & provisioning. Sessions and provisioned projects are
  // authoritative + transactional in Firestore; the browser never touches them.
  const provisionedProjects = new FirestoreProvisionedProjectStore(
    transactionalFirestore,
    { collectionPrefix: options.collectionPrefix },
  );
  const provisioning = new ProjectProvisioningService({
    sessions: new FirestoreOnboardingSessionStore(transactionalFirestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    projects: provisionedProjects,
    registry: bootstrap.projects,
    audit,
    adapterFactory: (project) => new ProvisionedProjectAdapter(project),
  });
  const onboardingService = new OnboardingService({
    sessions: new FirestoreOnboardingSessionStore(transactionalFirestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    projects: provisionedProjects,
    registry: bootstrap.projects,
    audit,
    reader: new GitHubRepositoryReader(),
    provisioning,
    platform: () => ({
      descriptors: environmentRegistry.listDescriptors(),
      usableDescriptorIds: new Set(
        environmentRegistry.usableInstances().map((i) => i.descriptorId),
      ),
      agents: bootstrap.agents.list(),
    }),
  });
  const onboarding = new OnboardingControlService(
    onboardingService,
    audit,
    budgetPolicies,
  );
  // READY projects become discoverable through the existing Project Registry.
  // Other warm instances pick them up through this throttled sync.
  const syncProjects = async (): Promise<void> => {
    for (const project of await provisionedProjects.list()) {
      if (project.readiness === "ready") provisioning.activate(project);
    }
  };
  await syncProjects();
  let lastSync = Date.now();
  const projectSync = async (): Promise<void> => {
    if (Date.now() - lastSync < 10_000) return;
    lastSync = Date.now();
    try {
      await syncProjects();
    } catch {
      /* a transient read failure must not fail an unrelated request */
    }
  };
  const query = new WorkforceQueryService(context);
  const command = new WorkforceCommandService(context);
  const graphQuery = new GraphQueryService(context);
  const handler = createControlPlaneApi({
    onboarding,
    projectSync,
    graphQuery,
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
    /**
     * The authoritative specialist workforce layer. Exposed so the API reads
     * assignments and handoffs from the same services that create them,
     * rather than reconstructing state from denormalised task fields.
     */
    specialist: {
      assignments: specialistAssignments,
      assignmentRepository,
      handoffs: specialistHandoffs,
      writeLeases: specialistAssignments.leases,
    },
    release: { verification, sourceControl, deployments },
    costCenter: {
      modelProviders,
      usage: usageLedger,
      budgetPolicies,
      enforcer: budgetEnforcer,
      auditor: ruleAuditor,
      governancePolicies,
      governanceEngine,
    },
    routing: { modelCapabilities, router: modelRouter },
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
