import { FirebaseOperatorDirectory, FirestoreExecutionPlanStore, FirestoreOperatorAccountStore, FirestoreOperatorProfileStore, isTransactionalFirestore, FirestoreEventPublisher, createFirebaseServices, } from "../adapters/firebase/index.js";
import { AgentOperationalStore, WorkflowControlStore, WorkforceCommandService, WorkforceQueryService, } from "../control/index.js";
import { ApprovalSystem, AuditLog, EnvironmentDetector, EnvironmentRegistry, HandoffSystem, Orchestrator, ProbeRegistry, TaskSystem, WorkflowEngine, WorkflowSystem, AccessService, ProfileService, ExecutionPlanningService, ValidationError, } from "../core/index.js";
import { FirebaseRepositoryProvider } from "./firebase-repositories.js";
import { createControlPlaneApi } from "./http-api.js";
import { createProductionWorkforceBootstrap, } from "./production-workforce-bootstrap.js";
import { PRODUCTION_ENVIRONMENT_DESCRIPTORS, PRODUCTION_WORKFORCE_CONFIGURATION, } from "./production-workforce-config.js";
/**
 * Constructs and hydrates the complete production runtime once. Callers should
 * cache the returned runtime for a serverless warm instance, not per request.
 */
export async function createProductionControlPlaneRuntime(options = {}) {
    const services = options.services ?? (await createFirebaseServices());
    const repositories = new FirebaseRepositoryProvider(services.firestore, {
        collectionPrefix: options.collectionPrefix,
    });
    // Allocate every durable collection before one deterministic hydrate pass.
    const taskRepository = repositories.repository("tasks");
    const workflowRepository = repositories.repository("workflows");
    const approvalRepository = repositories.repository("approvals");
    const handoffRepository = repositories.repository("handoffs");
    const auditRepository = repositories.repository("audit_events");
    const agentOpsRepository = repositories.repository("agent_operations");
    const workflowControlRepository = repositories.repository("workflow_control");
    // Environment orchestration collections — empty until live discovery (EO-2B+)
    // registers real hosts/environments. No fake hosts are ever seeded.
    const hostRepository = repositories.repository("hosts");
    const environmentInstanceRepository = repositories.repository("environment_instances");
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
    const environmentDetector = new EnvironmentDetector(environmentRegistry, new ProbeRegistry(), audit);
    const bootstrap = createProductionWorkforceBootstrap(options.configuration ?? PRODUCTION_WORKFORCE_CONFIGURATION, audit);
    const tasks = new TaskSystem(taskRepository);
    const workflows = new WorkflowSystem(workflowRepository);
    const approvals = new ApprovalSystem(approvalRepository);
    const handoffs = new HandoffSystem(handoffRepository);
    const agentOps = new AgentOperationalStore(agentOpsRepository);
    const workflowControl = new WorkflowControlStore(workflowControlRepository);
    const orchestrator = new Orchestrator(bootstrap.agents, tasks, handoffs, audit, bootstrap.agentExecutors, approvals, {
        approvalPolicy: bootstrap.approvalPolicy,
        permissions: bootstrap.permissions,
        environment: "production",
        agentGate: agentOps,
    });
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
        throw new ValidationError("execution planning requires a Firestore client with transactions");
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
    const operatorAccounts = new FirestoreOperatorAccountStore(transactionalFirestore, { collectionPrefix: options.collectionPrefix });
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
    const operatorDirectory = new FirebaseOperatorDirectory(services.auth, operatorAccounts);
    const context = {
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
        access,
        orchestrator,
        workflowEngine,
        events: new FirestoreEventPublisher(services.firestore.collection("control_events")),
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
