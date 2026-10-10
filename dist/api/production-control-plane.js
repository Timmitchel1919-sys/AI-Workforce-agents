import { GraphQueryService } from "../control/services/graph-query-service.js";
import { ITSMControlService } from "../control/services/itsm-control-service.js";
import { OperationsControlService } from "../control/services/operations-service.js";
import { GrcControlService } from "../control/services/grc-service.js";
import { AIGovernanceControlService } from "../control/services/ai-governance-service.js";
import { DataGovernanceService } from "../control/services/data-governance-service.js";
import { SecurityControlService } from "../control/services/security-service.js";
import { AuditControlService } from "../control/services/audit-service.js";
import { PortfolioControlService } from "../control/services/portfolio-service.js";
import { ProductManagementService } from "../control/services/product-service.js";
import { WorkforceManagementService } from "../control/services/workforce-service.js";
/**
 * The single production Control Plane composition root.
 *
 * It deliberately returns a Node-compatible HTTP handler rather than a
 * Firebase Functions object. DEPLOY-1B can add that thin hosting adapter
 * without changing this authoritative runtime graph.
 */
import { randomUUID } from "node:crypto";
import { FirebaseOperatorDirectory, FirestoreExecutionPlanStore, FirestoreExecutionRecordStore, FirestoreExecutionSessionStore, FirestoreOperatorAccountStore, FirestoreOperatorProfileStore, FirestoreOnboardingSessionStore, FirestoreProvisionedProjectStore, isTransactionalFirestore, FirestoreEventPublisher, createFirebaseServices, } from "../adapters/firebase/index.js";
import { createPlatformAdapters } from "../adapters/environments/index.js";
import { AgentOperationalStore, WorkflowControlStore, WorkforceCommandService, WorkforceQueryService, } from "../control/index.js";
import { ApprovalSystem, AuditLog, BudgetEnforcer, BudgetPolicyStore, EnvironmentDetector, EnvironmentRegistry, EnvironmentRouter, HandoffSystem, SpecialistHandoffService, InMemoryAssignmentRepository, InMemoryLeaseRepository, ProjectWorkforcePlanner, SpecialistAssignmentService, Orchestrator, OperationalAuditSink, OperationalDataSystem, ProbeRegistry, SoftwareFactoryOrchestrator, TaskSystem, WorkflowEngine, WorkflowSystem, AccessService, BASELINE_DENY_ALL_POLICY, ExecutionManager, ExecutionOperationRegistry, ExecutionPolicyRegistry, InMemoryExecutionReceiptStore, EnvironmentAdapterRegistry, SandboxRegistry, ProfileService, ExecutionPlanningService, ValidationError, GitHubRepositoryReader, OnboardingService, ProjectProvisioningService, ArtifactManager, DeploymentOrchestrator, GovernancePolicyEngine, GovernancePolicyStore, ModelCapabilityRegistry, ModelProviderRegistry, ModelRouter, RoutedModelProvider, RuleAuditor, SourceControlOrchestrator, UnavailableArtifactSource, UnavailableGovernedGit, UnavailableWorkspaceControl, UsageLedger, VerificationService, deriveCostCenterCapabilities, deriveReleaseCapabilities, RepositorySecurityEventStore, now, } from "../core/index.js";
import { CONTROL_PLANE_ANALYSIS_AGENT_ID, LazyOpenAIModelProvider, createProductionOpenAIAgentExecutor, } from "../agents/control-plane-analysis/index.js";
import { DEVELOPER_AGENT_ID, DeveloperAgent, } from "../agents/developer/index.js";
import { QA_AGENT_ID, QaAgent } from "../agents/qa/index.js";
import { PROJECT_MANAGER_AGENT_ID, ProjectManagerAgent, } from "../agents/project-manager/index.js";
import { SpecialistAgent } from "../agents/specialists/index.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import { OnboardingControlService } from "../control/services/onboarding-control-service.js";
import { ProvisionedProjectAdapter } from "../adapters/projects/provisioned/provisioned-project-adapter.js";
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
    const operationalEventsRepository = repositories.repository("operational_events");
    const operationalOutcomesRepository = repositories.repository("operational_outcomes");
    const agentOpsRepository = repositories.repository("agent_operations");
    const workflowControlRepository = repositories.repository("workflow_control");
    const softwareFactoryProgramRepository = repositories.repository("software_factory_programs");
    const softwareFactoryWorkstreamRepository = repositories.repository("software_factory_workstreams");
    const softwareFactoryAliasRepository = repositories.repository("software_factory_task_aliases");
    // Environment orchestration collections — empty until live discovery (EO-2B+)
    // registers real hosts/environments. No fake hosts are ever seeded.
    const hostRepository = repositories.repository("hosts");
    const environmentInstanceRepository = repositories.repository("environment_instances");
    // ITSM Repositories
    const itsmServicesRepository = repositories.repository("itsm_services");
    const itsmIncidentsRepository = repositories.repository("itsm_incidents");
    const itsmProblemsRepository = repositories.repository("itsm_problems");
    const itsmChangesRepository = repositories.repository("itsm_changes");
    const itsmReleasesRepository = repositories.repository("itsm_releases");
    const itsmCisRepository = repositories.repository("itsm_cis");
    const itsmRequestsRepository = repositories.repository("itsm_requests");
    const itsmRunbooksRepository = repositories.repository("itsm_runbooks");
    const itsmCiRelsRepository = repositories.repository("itsm_cirels");
    // Operations Repositories
    const opsHealthRepository = repositories.repository("ops_health_signals");
    const opsInventoryRepository = repositories.repository("ops_service_inventory");
    const opsAlertsRepository = repositories.repository("ops_alerts");
    const opsConfigRepository = repositories.repository("ops_platform_config");
    const opsRolloutsRepository = repositories.repository("ops_feature_rollouts");
    // AI Governance Repositories
    const aiModelsRepository = repositories.repository("ai_models");
    const aiUseCasesRepository = repositories.repository("ai_use_cases");
    const aiEvaluationsRepository = repositories.repository("ai_evaluations");
    const aiIncidentsRepository = repositories.repository("ai_incidents");
    // Data Governance Repositories
    const dataAssetsRepository = repositories.repository("data_assets");
    const dataRetentionPoliciesRepository = repositories.repository("data_retention_policies");
    const dsrRepository = repositories.repository("dsr_records");
    // Security Repositories
    const securityEventsRepository = repositories.repository("security_events");
    const canonicalSecurityEventsRepository = repositories.repository("canonical_security_events");
    const zeroTrustPoliciesRepository = repositories.repository("zero_trust_policies");
    const threatIntelRepository = repositories.repository("threat_intel");
    // Audit Repositories
    const auditLogsRepository = repositories.repository("audit_logs");
    const complianceFindingsRepository = repositories.repository("compliance_findings");
    // Portfolio Repositories
    const strategicObjectivesRepository = repositories.repository("strategic_objectives");
    const enterprisePortfoliosRepository = repositories.repository("enterprise_portfolios");
    const portfolioProgramsRepository = repositories.repository("portfolio_programs");
    // Product Repositories
    const productPortfoliosRepository = repositories.repository("product_portfolios");
    const productsRepository = repositories.repository("products");
    const problemsRepository = repositories.repository("customer_problems");
    const opportunitiesRepository = repositories.repository("product_opportunities");
    const featuresRepository = repositories.repository("product_features");
    // Workforce Repositories
    const departmentsRepository = repositories.repository("organization_departments");
    const teamsRepository = repositories.repository("workforce_teams");
    const humanAgentsRepository = repositories.repository("human_agents");
    const skillsRepository = repositories.repository("skill_definitions");
    const resourceAssignmentsRepository = repositories.repository("resource_assignments");
    // GRC Repositories
    const grcControlsRepository = repositories.repository("grc_controls");
    const grcFrameworksRepository = repositories.repository("grc_frameworks");
    const grcPoliciesRepository = repositories.repository("grc_policies");
    const grcControlInstancesRepository = repositories.repository("grc_control_instances");
    const grcRisksRepository = repositories.repository("grc_risks");
    const grcExceptionsRepository = repositories.repository("grc_exceptions");
    const grcVendorsRepository = repositories.repository("grc_vendors");
    const grcPrivacyRequestsRepository = repositories.repository("grc_privacy_requests");
    const grcRetentionPoliciesRepository = repositories.repository("grc_retention_policies");
    const grcDlpPoliciesRepository = repositories.repository("grc_dlp_policies");
    const grcPosturesRepository = repositories.repository("grc_postures");
    const grcAuditsRepository = repositories.repository("grc_audits");
    const grcAuditPackagesRepository = repositories.repository("grc_audit_packages");
    const grcCertificationsRepository = repositories.repository("grc_certifications");
    const grcTrustContentRepository = repositories.repository("grc_trust_content");
    const grcFindingsRepository = repositories.repository("grc_findings");
    await repositories.hydrateAll();
    const operations = new OperationalDataSystem({
        events: operationalEventsRepository,
        outcomes: operationalOutcomesRepository,
    });
    const audit = new AuditLog(new OperationalAuditSink(operations), auditRepository);
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
    const bootstrap = createProductionWorkforceBootstrap(options.configuration ?? PRODUCTION_WORKFORCE_CONFIGURATION, audit);
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
    const specialistAssignments = new SpecialistAssignmentService(assignmentRepository, () => bootstrap.agents.listDescriptors(), new InMemoryLeaseRepository(), () => new Date().toISOString(), audit, environmentRegistry);
    const projectWorkforcePlanner = new ProjectWorkforcePlanner(specialistAssignments, () => bootstrap.agents.listDescriptors());
    const specialistHandoffs = new SpecialistHandoffService(() => bootstrap.agents.listDescriptors(), (agentId, projectId) => agentOps.isEnabled(agentId, projectId), handoffRepository);
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
        models: modelCapabilities,
        // Authoritative + transactional (EO-3.2): no write-through cache, so
        // concurrent instances cannot fork or overwrite plan history.
        store: new FirestoreExecutionPlanStore(transactionalFirestore, {
            collectionPrefix: options.collectionPrefix,
        }),
        isAgentEnabled: (agentId, projectId) => agentOps.isEnabled(agentId, projectId),
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
    const executionRecords = new FirestoreExecutionRecordStore(transactionalFirestore, { collectionPrefix: options.collectionPrefix });
    // Shared with the verification service below: it must see exactly the operations and sandbox
    // providers the execution manager sees — one registry each, never a second copy.
    const executionOperations = new ExecutionOperationRegistry();
    const executionSandboxes = new SandboxRegistry();
    const execution = new ExecutionManager({
        planning,
        approvals,
        agents: bootstrap.agents,
        isAgentEnabled: (agentId, projectId) => agentOps.isEnabled(agentId, projectId),
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
    const governancePolicies = new GovernancePolicyStore(executionRecords, now, audit);
    const governanceEngine = new GovernancePolicyEngine(governancePolicies, budgetEnforcer, now, approvals, audit);
    const modelRouter = new ModelRouter(modelCapabilities, modelProviders, governanceEngine, now, executionRecords, audit, budgetEnforcer, governancePolicies);
    // This agent has no per-call cost pre-estimate to offer yet (see ADR-0029), so its one allowed
    // project explicitly permits proceeding on unknown cost — the REAL budget hard-stop still
    // applies regardless (`BudgetEnforcer.evaluateInternal`, checked unconditionally). Every OTHER
    // project stays fail-closed by default (EO-6.3's reviewed, unchanged behavior).
    await governancePolicies.setTrusted("money-mind", { allowUnknownCost: true });
    bootstrap.agentExecutors.replace(CONTROL_PLANE_ANALYSIS_AGENT_ID, createProductionOpenAIAgentExecutor(audit, {
        router: modelRouter,
        usageLedger,
    }));
    // EO-8: the three specialist agents (Developer/QA/Project Manager) were fully implemented and
    // tested but never wired into any production composition root. Same two-phase pattern as the
    // control-plane analysis agent above: `production-workforce-config.ts` binds each to a real but
    // UNROUTED provider at bootstrap time (before the Router/Cost Center exist), and this replaces
    // that binding with one wrapped in `RoutedModelProvider` — routed before every call, metered
    // after a successful one, requested-vs-actual model mismatches audited — the SAME reviewed EO-7
    // pipeline, generalized to any plain `ModelProvider`-based agent. Nothing reaches the unrouted
    // binding for a real request; it exists only for the instant between bootstrap and this call.
    const specialistRequirement = {
        requiredCapabilities: ["reasoning", "structured_output"],
    };
    bootstrap.agentExecutors.replace(DEVELOPER_AGENT_ID, new DeveloperAgent({
        audit,
        model: new RoutedModelProvider({
            inner: new LazyOpenAIModelProvider(),
            router: modelRouter,
            agent: bootstrap.agents.require(DEVELOPER_AGENT_ID),
            requirement: specialistRequirement,
            usageLedger,
            audit,
        }),
    }));
    bootstrap.agentExecutors.replace(QA_AGENT_ID, new QaAgent({
        audit,
        model: new RoutedModelProvider({
            inner: new LazyOpenAIModelProvider(),
            router: modelRouter,
            agent: bootstrap.agents.require(QA_AGENT_ID),
            requirement: specialistRequirement,
            usageLedger,
            audit,
        }),
    }));
    bootstrap.agentExecutors.replace(PROJECT_MANAGER_AGENT_ID, new ProjectManagerAgent({
        audit,
        model: new RoutedModelProvider({
            inner: new LazyOpenAIModelProvider(),
            router: modelRouter,
            agent: bootstrap.agents.require(PROJECT_MANAGER_AGENT_ID),
            requirement: specialistRequirement,
            usageLedger,
            audit,
        }),
    }));
    for (const agent of V1_SPECIALIST_WORKFORCE) {
        bootstrap.agentExecutors.replace(agent.id, new SpecialistAgent({
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
        }));
    }
    const context = {
        agents: bootstrap.agents,
        tasks,
        workflows,
        approvals,
        permissions: bootstrap.permissions,
        tools: bootstrap.tools,
        projects: bootstrap.projects,
        audit,
        operations,
        agentOps,
        workflowControl,
        environments: environmentRegistry,
        planning,
        execution,
        // READ-ONLY views: the context can list history/activity/releases and nothing else, at runtime
        // as well as by type. The full services live on `runtime.release` for the trusted host.
        verification: {
            listHistory: (...a) => verification.listHistory(...a),
        },
        sourceControl: {
            activity: (...a) => sourceControl.activity(...a),
        },
        deployments: {
            listReleases: (...a) => deployments.listReleases(...a),
            listTargets: (...a) => deployments.listTargets(...a),
        },
        releaseCapabilities,
        costCenter: {
            usage: {
                listByProject: (...a) => usageLedger.listByProject(...a),
            },
            budgetPolicy: {
                get: (...a) => budgetPolicies.get(...a),
                set: (...a) => budgetPolicies.set(...a),
            },
            enforcer: {
                evaluate: (...a) => budgetEnforcer.evaluate(...a),
            },
        },
        costCenterCapabilities,
        auditor: {
            run: (...a) => ruleAuditor.run(...a),
        },
        governance: {
            policy: {
                get: (...a) => governancePolicies.get(...a),
                set: (...a) => governancePolicies.set(...a),
            },
            engine: {
                evaluate: (...a) => governanceEngine.evaluate(...a),
            },
        },
        routing: {
            router: {
                get: (...a) => modelRouter.get(...a),
                listByProject: (...a) => modelRouter.listByProject(...a),
            },
        },
        executionReceipts,
        executionRecords,
        environmentAdapters,
        // The specialist layer, exposed to the Control Plane as READ-ONLY ports.
        // Queries can read assignments, handoffs, instances and staffing plans;
        // only the trusted host (`runtime.specialist`) can create or change them.
        specialist: {
            assignments: {
                currentForTask: (taskId) => specialistAssignments.currentForTask(taskId),
                historyForTask: (taskId) => specialistAssignments.historyForTask(taskId),
                require: (assignmentId) => specialistAssignments.require(assignmentId),
                mayWrite: (workspaceId, agentId, path) => specialistAssignments.mayWrite(workspaceId, agentId, path),
            },
            listAssignments: () => assignmentRepository.list(),
            plan: (planInput) => projectWorkforcePlanner.plan(planInput),
            handoffs: {
                list: () => specialistHandoffs.list(),
                forTask: (taskId) => specialistHandoffs.forTask(taskId),
            },
            listInstances: () => bootstrap.agents.listInstances(),
        },
        access,
        orchestrator,
        softwareFactory: new SoftwareFactoryOrchestrator(orchestrator, tasks, await buildSoftwareFactoryEnvironmentProvider(environmentRegistry), {
            persistence: {
                programs: softwareFactoryProgramRepository,
                workstreams: softwareFactoryWorkstreamRepository,
                executionAliases: softwareFactoryAliasRepository,
            },
            projectExists: (projectId) => bootstrap.projects.has(projectId),
        }),
        workflowEngine,
        events: new FirestoreEventPublisher(services.firestore.collection("control_events")),
    };
    // PROJECT-2: onboarding & provisioning. Sessions and provisioned projects are
    // authoritative + transactional in Firestore; the browser never touches them.
    const provisionedProjects = new FirestoreProvisionedProjectStore(transactionalFirestore, { collectionPrefix: options.collectionPrefix });
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
            usableDescriptorIds: new Set(environmentRegistry.usableInstances().map((i) => i.descriptorId)),
            agents: bootstrap.agents.list(),
        }),
    });
    const onboarding = new OnboardingControlService(onboardingService, audit, budgetPolicies);
    const itsm = new ITSMControlService(itsmServicesRepository, itsmIncidentsRepository, itsmProblemsRepository, itsmChangesRepository, itsmReleasesRepository, itsmCisRepository, itsmRequestsRepository, itsmRunbooksRepository, itsmCiRelsRepository);
    const ops = new OperationsControlService(opsHealthRepository, opsInventoryRepository, opsAlertsRepository, opsConfigRepository, opsRolloutsRepository);
    const aiGov = new AIGovernanceControlService(aiModelsRepository, aiUseCasesRepository, aiEvaluationsRepository, aiIncidentsRepository);
    const dataGov = new DataGovernanceService(dataAssetsRepository, dataRetentionPoliciesRepository, dsrRepository);
    const security = new SecurityControlService(securityEventsRepository, zeroTrustPoliciesRepository, threatIntelRepository, new RepositorySecurityEventStore(canonicalSecurityEventsRepository));
    const auditService = new AuditControlService(auditLogsRepository, complianceFindingsRepository);
    const portfolio = new PortfolioControlService(strategicObjectivesRepository, enterprisePortfoliosRepository, portfolioProgramsRepository);
    const product = new ProductManagementService(productPortfoliosRepository, productsRepository, problemsRepository, opportunitiesRepository, featuresRepository);
    const workforce = new WorkforceManagementService(departmentsRepository, teamsRepository, humanAgentsRepository, skillsRepository, resourceAssignmentsRepository);
    const grc = new GrcControlService(grcControlsRepository, grcFrameworksRepository, grcPoliciesRepository, grcControlInstancesRepository, grcRisksRepository, grcExceptionsRepository, grcVendorsRepository, grcPrivacyRequestsRepository, grcRetentionPoliciesRepository, grcDlpPoliciesRepository, grcPosturesRepository, grcAuditsRepository, grcAuditPackagesRepository, grcCertificationsRepository, grcTrustContentRepository, grcFindingsRepository);
    // READY projects become discoverable through the existing Project Registry.
    // Other warm instances pick them up through this throttled sync.
    const syncProjects = async () => {
        for (const project of await provisionedProjects.list()) {
            if (project.readiness === "ready")
                provisioning.activate(project);
        }
    };
    await syncProjects();
    let lastSync = Date.now();
    const projectSync = async () => {
        if (Date.now() - lastSync < 10_000)
            return;
        lastSync = Date.now();
        try {
            await syncProjects();
        }
        catch {
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
        itsm,
        ops,
        grc,
        aiGov,
        dataGov,
        security,
        audit: auditService,
        portfolio,
        product,
        workforce,
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
        operations,
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
async function buildSoftwareFactoryEnvironmentProvider(environmentRegistry) {
    try {
        const router = new EnvironmentRouter(environmentRegistry);
        const { createSoftwareFactoryEnvironmentProvider } = await import("../core/environments/software-factory-router.js");
        return createSoftwareFactoryEnvironmentProvider(router);
    }
    catch (error) {
        void error;
        return denyByDefaultEnvironmentProvider();
    }
}
/** Deny-by-default provider: every code is unsupported; nothing routes. */
function denyByDefaultEnvironmentProvider() {
    const reason = "no environment router available — this environment code is unsupported";
    return {
        requirementFor() {
            return null;
        },
        route(codes) {
            return codes.map((code) => ({
                code,
                requirement: null,
                outcome: { outcome: "UNSUPPORTED", reason },
            }));
        },
    };
}
