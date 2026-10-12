import { GraphQueryService } from "../control/services/graph-query-service.js";
import { ITSMControlService } from "../control/services/itsm-control-service.js";
import { OperationsControlService } from "../control/services/operations-service.js";
import { GrcControlService } from "../control/services/grc-service.js";
import { AIGovernanceControlService } from "../control/services/ai-governance-service.js";
import { DataGovernanceService } from "../control/services/data-governance-service.js";
import { IntegrationControlService } from "../control/services/integration-control-service.js";
import { AnalyticsControlService, AutonomyControlService, BusinessControlService, ExtensionControlService, PortfolioIntelligenceControlService, } from "../control/services/platform-layers-control.js";
import { AnalyticsIntelligence, AutonomyEngine, BusinessService, ExtensionSystem, PlatformActionExecutor, PortfolioIntelligence, measureMetric, } from "../core/index.js";
import { SecurityControlService } from "../control/services/security-service.js";
import { AuditControlService } from "../control/services/audit-service.js";
import { PortfolioControlService } from "../control/services/portfolio-service.js";
import { ProductManagementService } from "../control/services/product-service.js";
import { KnowledgeCrudControlService } from "../control/services/knowledge-service.js";
import { SimulationControlService } from "../control/services/simulation-service.js";
import { TrustOversightControlService } from "../control/services/trust-control-service.js";
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
import { ApprovalSystem, AuditLog, BudgetEnforcer, BudgetPolicyStore, EnvironmentDetector, EnvironmentRegistry, EnvironmentRouter, HandoffSystem, SpecialistHandoffService, InMemoryAssignmentRepository, InMemoryLeaseRepository, ProjectWorkforcePlanner, SpecialistAssignmentService, Orchestrator, ProbeRegistry, SoftwareFactoryOrchestrator, TaskSystem, WorkflowEngine, WorkflowSystem, AccessService, BASELINE_DENY_ALL_POLICY, ExecutionManager, ExecutionOperationRegistry, ExecutionPolicyRegistry, InMemoryExecutionReceiptStore, EnvironmentAdapterRegistry, SandboxRegistry, ProfileService, ExecutionPlanningService, ValidationError, GitHubRepositoryReader, AI_WORKFORCE_PROFILE, CostGateAdapter, ExecutionOrchestrator, GovernedTaskRuntime, LlmAgentExecutor, SecuritySystem, IntegrationSystem, LocalNpmAuditRunner, KnowledgeSystem, GovernedFileSystem, LocalGitOps, workspaceFileSource, githubFileSource, parseProjectRepositoryRef, SessionManager, WorkspaceRegistry, WorkspaceResolver, ModelRouterAdapter, ContextEngine, KnowledgeContextSource, OnboardedProjectSource, PlatformDevelopmentDefaultsSource, PlatformSecurityBaselineSource, ProjectRegistrySource, PromptIntelligenceService, RepositoryFileResolver, RuleBasedIntentAnalyzer, StaticProjectProfileSource, TaskContextSource, OnboardingService, ProjectProvisioningService, ArtifactManager, DeploymentOrchestrator, GovernancePolicyEngine, GovernancePolicyStore, ModelCapabilityRegistry, ModelProviderRegistry, ModelRouter, RoutedModelProvider, RuleAuditor, SourceControlOrchestrator, UnavailableArtifactSource, UnavailableGovernedGit, UnavailableWorkspaceControl, UsageLedger, VerificationService, deriveCostCenterCapabilities, deriveReleaseCapabilities, now, AlertEngine, InMemoryAlertPublisher, SecurityIncidentService, SecurityCenterService, } from "../core/index.js";
import { CONTROL_PLANE_ANALYSIS_AGENT_ID, LazyOpenAIModelProvider, createProductionOpenAIAgentExecutor, } from "../agents/control-plane-analysis/index.js";
import { DEVELOPER_AGENT_ID, DeveloperAgent, } from "../agents/developer/index.js";
import { QA_AGENT_ID, QaAgent } from "../agents/qa/index.js";
import { PROJECT_MANAGER_AGENT_ID, ProjectManagerAgent, } from "../agents/project-manager/index.js";
import { SpecialistAgent } from "../agents/specialists/index.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import { OnboardingControlService } from "../control/services/onboarding-control-service.js";
import { PromptIntelligenceControlService } from "../control/services/prompt-intelligence-control-service.js";
import { ExecutionOrchestrationControlService } from "../control/services/execution-orchestration-control-service.js";
import { RuntimeControlService } from "../control/services/runtime-control-service.js";
import { KnowledgeControlService } from "../control/services/knowledge-control-service.js";
import { TrustControlService } from "../control/services/security-control-service.js";
import { TERMINAL_RUNTIME_STATES } from "../contracts/execution-runtime.js";
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
    const knowledgeRepository = repositories.repository("knowledge_items");
    // Layer 15 / 16 durable collections (additive, no migration of existing data).
    const simulationSnapshotRepository = repositories.repository("simulation_snapshots");
    const trustEntityRepository = repositories.repository("trust_entities");
    const unifiedApprovalRepository = repositories.repository("unified_approvals");
    const trustEventRepository = repositories.repository("trust_events");
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
    // Phase 3: durable prompt-request traces + a read view of Knowledge. Allocated
    // before the single hydrate pass; "knowledge_items" resolves to the same
    // repository instance the Knowledge module uses (one instance per path).
    const promptRequestRepository = repositories.repository("prompt_requests");
    const promptKnowledgeRepository = repositories.repository("knowledge_items");
    const executionRunRepository = repositories.repository("execution_runs");
    const runtimeSessionRepository = repositories.repository("runtime_sessions");
    // Governance, Trust & Security: durable policy, trust, alert, approval-meta, ledger and baseline collections.
    const securityRepos = {
        policies: repositories.repository("governance_policies"),
        agentTrust: repositories.repository("governance_agent_trust"),
        modelTrust: repositories.repository("governance_model_trust"),
        toolTrust: repositories.repository("governance_tool_trust"),
        alerts: repositories.repository("security_alerts"),
        ledger: repositories.repository("governance_ledger"),
        approvalMeta: repositories.repository("governance_approvals"),
        emergency: repositories.repository("governance_emergency"),
        configBaselines: repositories.repository("security_config_baselines"),
        dependencyScans: repositories.repository("security_dependency_scans"),
    };
    // Knowledge, Memory & Context Intelligence: seven durable collections, allocated before hydrate.
    const knowledgeRepos = {
        memories: repositories.repository("memories"),
        versions: repositories.repository("memory_versions"),
        entities: repositories.repository("knowledge_entities"),
        edges: repositories.repository("knowledge_edges"),
        usage: repositories.repository("memory_usage"),
        resolutions: repositories.repository("memory_conflict_resolutions"),
        sources: repositories.repository("knowledge_sources"),
    };
    // Integration Hub: ten durable collections (credentials are stored encrypted), allocated before hydrate.
    const integrationRepos = {
        connectors: repositories.repository("integration_connectors"),
        mappings: repositories.repository("integration_mappings"),
        activity: repositories.repository("integration_activity"),
        queue: repositories.repository("integration_queue"),
        credentials: repositories.repository("integration_credentials"),
        oauthStates: repositories.repository("integration_oauth_states"),
        events: repositories.repository("integration_events"),
        subscriptions: repositories.repository("integration_subscriptions"),
        deliveries: repositories.repository("integration_webhook_deliveries"),
        mcp: repositories.repository("integration_mcp_servers"),
    };
    // Layers 9–13: durable collections, allocated before the single hydrate pass.
    const extensionRepos = {
        extensions: repositories.repository("extension_platform"),
        audit: repositories.repository("extension_platform_audit"),
    };
    const businessRepos = {
        profile: repositories.repository("business_profile"),
        departments: repositories.repository("business_departments"),
        objectives: repositories.repository("business_objectives"),
        initiatives: repositories.repository("business_initiatives"),
        decisions: repositories.repository("business_decisions"),
    };
    const portfolioRepos = {
        profiles: repositories.repository("portfolio_profiles"),
        dependencies: repositories.repository("portfolio_dependencies"),
        claims: repositories.repository("portfolio_resource_claims"),
    };
    const autonomyRepos = {
        settings: repositories.repository("autonomy_settings"),
        global: repositories.repository("autonomy_global"),
        definitions: repositories.repository("autonomy_definitions"),
        rules: repositories.repository("autonomy_rules"),
        instances: repositories.repository("autonomy_instances"),
        audit: repositories.repository("autonomy_audit"),
    };
    const analyticsRepos = {
        recommendations: repositories.repository("analytics_recommendations"),
        lessons: repositories.repository("analytics_lessons"),
    };
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
    // Governance, Trust & Security: the ONE policy decision point. Suspension and the emergency stop
    // cancel live runtime sessions through the (later-declared) session manager.
    const cancelSessions = (match) => {
        for (const s of runtimeSessions.list()) {
            if (!TERMINAL_RUNTIME_STATES.includes(s.status) && match(s)) {
                try {
                    runtimeSessions.cancel(s.executionId);
                }
                catch {
                    /* already finishing */
                }
            }
        }
    };
    const trustSys = new SecuritySystem({
        repos: securityRepos,
        audit,
        approvals,
        agents: {
            get: (id) => bootstrap.agents.get(id),
            list: () => bootstrap.agents.list(),
        },
        isAgentEnabled: (agentId) => agentOps.isEnabled(agentId),
        onSuspend: (agentId) => cancelSessions((s) => s.agentId === agentId),
        annotateSession: (executionId, patch) => runtimeSessions.annotateGovernance(executionId, patch),
    });
    trustSys.emergency.onEngage(() => cancelSessions(() => true));
    // Layer 9: declarative extensions (skills, agents, tools, workflow templates). `integrations` and
    // `autonomyRef` are declared later; these closures only run after construction.
    const extensionSystem = new ExtensionSystem({
        repos: extensionRepos,
        security: trustSys,
        external: {
            check: (kind, id) => {
                if (kind === "connector") {
                    const c = integrations.registry.get(id);
                    return c?.enabled
                        ? { ok: true, reason: `connector ${id} is enabled` }
                        : { ok: false, reason: `connector "${id}" is not enabled` };
                }
                if (kind === "tool") {
                    const known = integrations.registry
                        .allCapabilities()
                        .some((cap) => cap.capability === id);
                    return known
                        ? { ok: true, reason: `capability ${id} exists` }
                        : { ok: false, reason: `capability "${id}" does not exist` };
                }
                return {
                    ok: false,
                    reason: `${kind} dependencies cannot be verified in this deployment`,
                };
            },
        },
    });
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
            inner: trustSys.governedModel(new LazyOpenAIModelProvider()),
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
            inner: trustSys.governedModel(new LazyOpenAIModelProvider()),
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
            inner: trustSys.governedModel(new LazyOpenAIModelProvider()),
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
                inner: trustSys.governedModel(new LazyOpenAIModelProvider()),
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
    const security = new SecurityControlService(securityEventsRepository, zeroTrustPoliciesRepository, threatIntelRepository);
    const auditService = new AuditControlService(auditLogsRepository, complianceFindingsRepository);
    const portfolio = new PortfolioControlService(strategicObjectivesRepository, enterprisePortfoliosRepository, portfolioProgramsRepository);
    const product = new ProductManagementService(productPortfoliosRepository, productsRepository, problemsRepository, opportunitiesRepository, featuresRepository);
    const knowledgeCrud = new KnowledgeCrudControlService(knowledgeRepository, audit);
    const simulation = new SimulationControlService(simulationSnapshotRepository, audit);
    const trustOversight = new TrustOversightControlService(trustEntityRepository, unifiedApprovalRepository, trustEventRepository, audit);
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
    // Knowledge, Memory & Context Intelligence: governed memory, hybrid retrieval and the
    // context assembler. Its context source plugs into the Layer 3 engine below.
    const knowledge = new KnowledgeSystem({ repos: knowledgeRepos, audit });
    // Phase 3: Context Engine + Prompt Intelligence. Every source reads existing
    // platform state through a read-only port; nothing here executes an agent.
    const promptService = new PromptIntelligenceService({
        projects: bootstrap.projects,
        analyzer: new RuleBasedIntentAnalyzer(),
        engine: new ContextEngine([
            new PlatformSecurityBaselineSource(),
            new PlatformDevelopmentDefaultsSource(),
            new ProjectRegistrySource(bootstrap.projects),
            new StaticProjectProfileSource("ai-workforce-profile", "ai-workforce", "AI Workforce repository documentation", AI_WORKFORCE_PROFILE),
            new OnboardedProjectSource(provisionedProjects),
            new KnowledgeContextSource(promptKnowledgeRepository),
            knowledge.contextSource,
            trustSys.contextSource,
            extensionSystem.skillContext,
            new TaskContextSource(tasks),
        ], {
            fileResolver: new RepositoryFileResolver(bootstrap.projects, new GitHubRepositoryReader()),
        }),
        records: promptRequestRepository,
        approvals,
        agents: bootstrap.agents,
    });
    const promptIntelligence = new PromptIntelligenceControlService(promptService, audit);
    // Layer 5: the Execution Runtime. A project's workspace must be REGISTERED
    // (trusted configuration, a host path); a Cloud Function has none, so in this
    // deployment every task reports "no workspace is registered" and blocks —
    // nothing runs and nothing is faked. A local host registers workspaces here.
    const runtimeSessions = new SessionManager(runtimeSessionRepository, audit);
    const workspaceRegistry = new WorkspaceRegistry();
    const workspaceResolver = new WorkspaceResolver(workspaceRegistry);
    // Layer 6: the LLM agent loop. Every model call is routed per agent and metered by the Cost
    // Center (the same reviewed pipeline as the specialists); with no model key configured the
    // provider fails closed and the task reports it. Without a registered workspace it never runs.
    const agentLoop = new LlmAgentExecutor({
        models: ({ agentId }) => new RoutedModelProvider({
            inner: trustSys.governedModel(new LazyOpenAIModelProvider()),
            router: modelRouter,
            agent: bootstrap.agents.require(agentId),
            requirement: specialistRequirement,
            usageLedger,
            audit,
        }),
    });
    // Layer 8: Integration Hub. Agents reach external services only through its capability port.
    const autonomyRef = {};
    const integrations = new IntegrationSystem({
        repos: integrationRepos,
        security: trustSys,
        ...(process.env["INTEGRATION_VAULT_KEY"]
            ? { vaultKey: process.env["INTEGRATION_VAULT_KEY"] }
            : {}),
        env: process.env,
        // Provider calls consume quota, not tokens: recorded as unpriced usage, never as an invented cost.
        recordUsage: (draft) => void usageLedger.record(draft).catch(() => undefined),
        // A webhook never runs work by itself. A matching autonomy trigger rule creates a workflow whose
        // first state is decided by the project's autonomy level and the action policy.
        trigger: {
            propose: async ({ subscription, event }) => {
                const engine = autonomyRef.current;
                if (!engine)
                    return {
                        note: "Event recorded. A run must be started by the operator.",
                    };
                const made = await engine.ingestEvent({
                    source: event.provider === "GitHub" ? "github" : "integration",
                    projectId: subscription.projectId,
                    eventType: event.type,
                    summary: `${event.provider} ${event.type}${event.resource ? ` on ${event.resource}` : ""}`,
                    ref: event.eventId,
                    by: "integration-hub",
                });
                return {
                    ...(made[0] ? { runId: made[0].instanceId } : {}),
                    note: made.length
                        ? `${made.length} autonomous workflow(s) created under the project's autonomy policy.`
                        : "Event recorded. No autonomy rule matches it; a run must be started by the operator.",
                };
            },
        },
    });
    integrations.syncProjectMappings(bootstrap.projects.list().map((p) => {
        const repository = parseProjectRepositoryRef(p.metadata?.["repository"]);
        return {
            projectId: p.projectId,
            ...(repository ? { repositoryUrl: repository.url } : {}),
        };
    }));
    const taskRuntime = new GovernedTaskRuntime({
        capabilities: integrations.capabilityPort(),
        resolver: workspaceResolver,
        manager: runtimeSessions,
        agentExecutor: agentLoop,
        // Layer 7: every write, delete, command, commit and deployment asks the governor first.
        gate: trustSys.gate(),
        onFinished: ({ session, task, context, outcome }) => {
            // Post-execution policy check: expected vs actual changes (execution drift).
            trustSys.governor.postCheck({
                session,
                expected: [...task.resources, ...context.relevantFiles],
                keywords: context.objective
                    .toLowerCase()
                    .split(/[^a-z0-9]+/)
                    .filter((w) => w.length >= 4),
            });
            // The learning loop: verified execution results become candidate/verified memory.
            knowledge.learner.learn({ session, task, context, outcome });
        },
    });
    // Layer 4: Execution Orchestration. Plans, routes, gates and audits; it drives
    // the runtime through the TaskRuntimePort.
    const executionOrchestrator = new ExecutionOrchestrator({
        runs: executionRunRepository,
        projects: bootstrap.projects,
        agents: bootstrap.agents,
        isAgentEnabled: (agentId) => agentOps.isEnabled(agentId) && !trustSys.trust.isBlocked(agentId),
        governance: trustSys.taskGovernance(),
        approvals,
        audit,
        runtime: taskRuntime,
        models: new ModelRouterAdapter(modelRouter),
        cost: new CostGateAdapter(budgetEnforcer, usageLedger),
    });
    const orchestration = new ExecutionOrchestrationControlService(executionOrchestrator, promptService, audit);
    const runtimeControl = new RuntimeControlService(runtimeSessions, workspaceResolver, executionOrchestrator, audit);
    const projectSource = async (projectId) => {
        // 1. A registered local workspace (read-only governed view, with git history).
        try {
            const ws = await workspaceResolver.resolve(projectId);
            return workspaceFileSource(new GovernedFileSystem(ws.rootReal, ["read", "list"], {
                taskId: "knowledge",
                agentId: "knowledge",
                clock: () => new Date().toISOString(),
            }), new LocalGitOps(ws.rootReal));
        }
        catch {
            /* no workspace registered for this project */
        }
        // 2. The project's declared GitHub repository (allow-listed files only).
        const repo = bootstrap.projects.get(projectId)?.metadata?.repository;
        const ref = repo ? parseProjectRepositoryRef(repo) : undefined;
        if (!ref)
            return undefined;
        return githubFileSource(new GitHubRepositoryReader(), {
            url: ref.url,
            branch: ref.defaultBranch,
        });
    };
    const knowledgeControl = new KnowledgeControlService({
        knowledge,
        audit,
        projectExists: (projectId) => bootstrap.projects.has(projectId),
        sourceFor: projectSource,
    });
    const trustControl = new TrustControlService({
        security: trustSys,
        audit,
        knownAgentIds: () => bootstrap.agents.list().map((a) => a.id),
        projectExists: (projectId) => bootstrap.projects.has(projectId),
        sourceFor: projectSource,
        auditRunnerFor: async (projectId) => {
            try {
                const ws = await workspaceResolver.resolve(projectId);
                return new LocalNpmAuditRunner(ws.rootReal);
            }
            catch {
                return undefined;
            }
        },
    });
    const integrationControl = new IntegrationControlService({
        integrations,
        security: trustSys,
        audit,
        projectExists: (projectId) => bootstrap.projects.has(projectId),
    });
    // ===== Layers 10–13 =====
    let provisionedSnapshot = [];
    const usageSnapshot = new Map();
    let platformStamp = 0;
    /** Usage and onboarding records live in async stores; reads are served from a short-lived snapshot. */
    const refreshPlatformData = async () => {
        if (Date.now() - platformStamp < 15_000)
            return;
        platformStamp = Date.now();
        try {
            provisionedSnapshot = await provisionedProjects.list();
        }
        catch {
            /* keep the last snapshot */
        }
        for (const reg of bootstrap.projects.list()) {
            try {
                usageSnapshot.set(reg.projectId, await usageLedger.listInternal(reg.projectId, 500));
            }
            catch {
                /* keep the last snapshot */
            }
        }
    };
    await refreshPlatformData();
    const allUsage = () => [...usageSnapshot.values()].flat();
    const allRuns = () => executionRunRepository.list();
    const deriveRun = (run) => executionOrchestrator.derive(run);
    const alertFacts = () => trustSys.alerts.list().map((a) => ({
        alertId: a.alertId,
        ...(a.projectId ? { projectId: a.projectId } : {}),
        severity: a.severity,
        status: a.status,
        event: a.event,
        description: a.description,
    }));
    const projectFacts = () => bootstrap.projects.list().map((reg) => {
        const prov = provisionedSnapshot.find((x) => x.id === reg.projectId);
        const repo = parseProjectRepositoryRef(reg.metadata?.["repository"]);
        const values = (xs) => (xs ?? []).map((x) => x.value).slice(0, 8);
        const tech = prov?.plan.technology;
        const environment = prov?.plan.environments?.[0]?.environmentType;
        const target = values(tech?.deploymentTargets)[0];
        return {
            projectId: reg.projectId,
            name: reg.displayName,
            ...(repo ? { repository: repo.url, branch: repo.defaultBranch } : {}),
            stack: [...values(tech?.languages), ...values(tech?.frameworks)],
            ...(environment ? { environment } : {}),
            ...(target ? { deploymentTarget: target } : {}),
        };
    });
    const agentsOfProject = (projectId) => [
        ...new Set(allRuns()
            .filter((r) => r.projectId === projectId)
            .flatMap((r) => r.tasks
            .map((t) => t.assignedAgent?.agentId)
            .filter((a) => !!a))),
    ];
    const rememberInKnowledge = (title, content, projectId, ref, tags, type, actor) => {
        try {
            knowledge.memory.create({
                type,
                title,
                content,
                source: actor.kind === "USER" ? "USER" : "SYSTEM",
                sourceRef: ref,
                ...(projectId ? { projectId } : {}),
                tags,
            }, actor);
            return true;
        }
        catch {
            return false;
        }
    };
    const portfolioIntel = new PortfolioIntelligence(portfolioRepos, {
        projects: projectFacts,
        runs: allRuns,
        deriveRunStatus: deriveRun,
        usage: allUsage,
        alerts: alertFacts,
        memories: () => knowledge.memory.all(),
        reusableExtensions: () => extensionSystem.platform
            .list()
            .filter((x) => x.status === "ENABLED" &&
            (x.type === "SKILL" || x.type === "WORKFLOW"))
            .map((x) => ({
            kind: x.type,
            extensionId: x.extensionId,
            name: x.name,
        })),
        agentsFor: agentsOfProject,
        overdueObjectives: (projectId) => businessService
            .listObjectives({ projectId })
            .filter((o) => o.status === "ACTIVE" &&
            o.targetDate &&
            o.targetDate < new Date().toISOString()).length,
        ledger: trustSys.ledger,
        clock: () => new Date().toISOString(),
    });
    const businessService = new BusinessService(businessRepos, {
        projectExists: (projectId) => bootstrap.projects.has(projectId),
        agentExists: (agentId) => bootstrap.agents.has(agentId),
        measure: (metric, projectId) => measureMetric(metric, projectId, {
            runs: allRuns(),
            deriveRunStatus: deriveRun,
            usage: allUsage(),
            alerts: alertFacts(),
        }),
        workflowTemplates: () => extensionSystem.platform.enabledWorkflowTemplates(),
        projectHealth: (projectId) => {
            try {
                const h = portfolioIntel.health(projectId, () => true);
                return { state: h.state, reasons: h.reasons };
            }
            catch {
                return undefined;
            }
        },
        remember: (d) => void rememberInKnowledge(d.title, `${d.decision}\nRationale: ${d.rationale}\nContext: ${d.context}`, d.links.projectId, d.decisionId, ["decision"], "ARCHITECTURAL", { id: "owner", kind: "USER" }),
        ledger: trustSys.ledger,
        clock: () => new Date().toISOString(),
    });
    const summarizeActivity = (projectId) => {
        const entries = trustSys.ledger.query({ projectId, limit: 25 });
        const hub = integrations.gateway.activityLog({ projectId, limit: 25 });
        return [
            `Governance records: ${entries.length}`,
            ...entries
                .slice(0, 8)
                .map((e) => `- ${e.at.slice(0, 19)} ${e.operation} → ${e.result}`),
            `Integration calls: ${hub.length} (${hub.filter((h) => h.outcome === "FAILED").length} failed, ${hub.filter((h) => h.outcome === "DENIED" || h.outcome === "BLOCKED").length} denied/blocked)`,
        ].join("\n");
    };
    const platformReport = (projectId) => {
        const s = portfolioIntel.summary(projectId, () => true);
        return [
            `Health: ${s.health.state}${s.health.reasons.length ? ` — ${s.health.reasons.slice(0, 4).join("; ")}` : ""}`,
            `Workflows: ${s.workflows.active} active of ${s.workflows.total}`,
            `Cost: ${s.cost.spentUsd === null ? "no priced usage" : `$${s.cost.spentUsd.toFixed(4)}`}, ${s.cost.tokens.toLocaleString("en-US")} tokens`,
            ...s.health.signals.map((g) => `- ${g.name}: ${g.status} — ${g.detail}`),
        ].join("\n");
    };
    const NOT_WIRED = "needs an executor for the governed workspace that is not wired in this deployment";
    const autonomy = new AutonomyEngine(autonomyRepos, {
        executor: new PlatformActionExecutor({
            inspect_logs: (ctx) => ({
                ok: true,
                output: summarizeActivity(ctx.projectId),
            }),
            generate_report: (ctx) => ({
                ok: true,
                output: platformReport(ctx.projectId),
            }),
            read_repository: async (ctx) => {
                const r = await integrations.gateway.invoke({
                    capability: "repository.read",
                    projectId: ctx.projectId,
                    principalId: "autonomy-engine",
                    parameters: {},
                });
                if (r.success)
                    return {
                        ok: true,
                        output: JSON.stringify(r.data ?? {}).slice(0, 1500),
                    };
                const kind = r.error?.kind === "APPROVAL_REQUIRED" ||
                    r.error?.kind === "POLICY_DENIED"
                    ? "POLICY"
                    : r.error?.retryable
                        ? "TRANSIENT"
                        : "PERMANENT";
                return {
                    ok: false,
                    error: {
                        kind,
                        message: r.error?.message ?? "the repository could not be read",
                    },
                };
            },
        }, Object.fromEntries([
            "run_tests",
            "analyze_dependencies",
            "create_branch",
            "prepare_pull_request",
            "start_orchestrated_run",
            "commit_to_branch",
            "push_branch",
            "deploy_staging",
            "delete_branch",
            "revert_commit",
            "rollback_deployment",
        ].map((a) => [a, `"${a}" ${NOT_WIRED}`]))),
        requestApproval: (d) => approvals.request({
            action: d.action,
            requestedBy: d.requestedBy,
            reason: d.reason,
            metadata: d.metadata,
        }).id,
        approvalState: (id) => {
            const a = approvals.get(id);
            return !a ? "unknown" : a.status === "requested" ? "pending" : a.status;
        },
        decideApproval: (id, decision, by) => {
            try {
                approvals.decide(id, decision === "approve" ? "approved" : "rejected", by);
            }
            catch {
                /* already decided elsewhere */
            }
        },
        emergencyStopped: () => trustSys.emergency.halted(),
        raiseAlert: (a) => void trustSys.alerts.raise({
            severity: a.severity,
            source: "POLICY",
            event: a.event,
            description: a.description,
            projectId: a.projectId,
            dedupeKey: a.dedupeKey,
        }),
        projectExists: (projectId) => bootstrap.projects.has(projectId),
        environmentOf: (projectId) => projectFacts().find((f) => f.projectId === projectId)?.environment,
        onboardingLevel: (projectId) => provisionedSnapshot.find((x) => x.id === projectId)?.plan.autonomy.level,
        orchestration: () => {
            const states = allRuns().map(deriveRun);
            return {
                active: states.filter((x) => x === "EXECUTING" || x === "REVIEW")
                    .length,
                queued: states.filter((x) => x === "NOT_STARTED").length,
                failed: states.filter((x) => x === "FAILED").length,
                waitingApproval: states.filter((x) => x === "WAITING_APPROVAL").length,
            };
        },
        ledger: trustSys.ledger,
        clock: () => new Date().toISOString(),
        now: () => Date.now(),
    });
    autonomyRef.current = autonomy;
    const analytics = new AnalyticsIntelligence(analyticsRepos, {
        runs: allRuns,
        deriveRunStatus: deriveRun,
        usage: allUsage,
        alerts: alertFacts,
        approvals: () => approvals
            .list()
            .map((a) => ({
            id: a.id,
            action: a.action,
            status: a.status === "requested" ? "pending" : a.status,
            requestedAt: a.requestedAt,
            ...(a.decidedAt ? { decidedAt: a.decidedAt } : {}),
        })),
        toolActivity: () => integrations.gateway
            .activityLog({ limit: 500 })
            .map((h) => ({
            ...(h.agentId ? { agentId: h.agentId } : {}),
            capability: h.capability,
            ...(h.connectorId ? { connectorId: h.connectorId } : {}),
            projectId: h.projectId,
            outcome: h.outcome,
            at: h.at,
        })),
        connectorHealth: () => integrations.registry
            .list()
            .map((c) => ({ connectorId: c.connectorId, status: c.status })),
        autonomy: () => autonomy.list(),
        dependentsOf: (projectId) => portfolioIntel
            .listDependencies(() => true)
            .filter((d) => d.to === projectId)
            .map((d) => d.from),
        remember: (l) => rememberInKnowledge(l.title, l.content, l.projectId, l.lessonId, ["lesson", l.kind.toLowerCase()], "EXECUTION", { id: "analytics", kind: "SYSTEM" }),
        ledger: trustSys.ledger,
        clock: () => new Date().toISOString(),
        now: () => Date.now(),
    });
    const extensionControl = new ExtensionControlService({ audit }, extensionSystem.platform);
    const businessControl = new BusinessControlService({ audit }, businessService);
    const portfolioControl = new PortfolioIntelligenceControlService({ audit }, portfolioIntel);
    const operationsControl = new AutonomyControlService({ audit }, autonomy);
    const analyticsControl = new AnalyticsControlService({ audit }, analytics);
    const query = new WorkforceQueryService(context);
    const command = new WorkforceCommandService(context);
    const graphQuery = new GraphQueryService(context);
    const appCheckMode = process.env.APP_CHECK_ENFORCEMENT_MODE || "disabled";
    const appAttestationVerifier = services.appCheck
        ? new (await import("./security/app-check.js")).FirebaseAppAttestationVerifier(services.appCheck, appCheckMode)
        : new (await import("./security/app-check.js")).DefaultAppAttestationVerifier();
    const alertPublisher = new InMemoryAlertPublisher();
    const incidentService = new SecurityIncidentService({ publisher: alertPublisher });
    const alertEngine = new AlertEngine({ incidentService, publisher: alertPublisher });
    const securityCenter = new SecurityCenterService({ alertEngine, incidentService });
    const handler = createControlPlaneApi({
        onboarding,
        promptIntelligence,
        orchestration,
        runtime: runtimeControl,
        knowledgeMemory: knowledgeControl,
        trustCenter: trustControl,
        integrationCenter: integrationControl,
        extensionCenter: extensionControl,
        businessCenter: businessControl,
        portfolioCenter: portfolioControl,
        operationsCenter: operationsControl,
        analyticsCenter: analyticsControl,
        refreshData: refreshPlatformData,
        projectSync,
        graphQuery,
        query,
        command,
        operatorDirectory,
        identityVerifier: operatorDirectory,
        appAttestationVerifier,
        appCheckMode,
        access,
        profile,
        itsm,
        ops,
        grc,
        aiGov,
        dataGov,
        security,
        securityCenter,
        audit: auditService,
        portfolio,
        product,
        knowledge: knowledgeCrud,
        simulation,
        trust: trustOversight,
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
