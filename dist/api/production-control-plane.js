import { FirebaseOperatorDirectory, FirestoreEventPublisher, createFirebaseServices, } from "../adapters/firebase/index.js";
import { AgentOperationalStore, WorkflowControlStore, WorkforceCommandService, WorkforceQueryService, } from "../control/index.js";
import { ApprovalSystem, AuditLog, HandoffSystem, Orchestrator, TaskSystem, WorkflowEngine, WorkflowSystem, } from "../core/index.js";
import { FirebaseRepositoryProvider } from "./firebase-repositories.js";
import { createControlPlaneApi } from "./http-api.js";
import { createProductionWorkforceBootstrap, } from "./production-workforce-bootstrap.js";
import { PRODUCTION_WORKFORCE_CONFIGURATION } from "./production-workforce-config.js";
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
    await repositories.hydrateAll();
    const audit = new AuditLog(undefined, auditRepository);
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
        orchestrator,
        workflowEngine,
        events: new FirestoreEventPublisher(services.firestore.collection("control_events")),
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
