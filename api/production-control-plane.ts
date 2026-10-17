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
import { workflowCapabilityContext } from "../control/services/workflow-studio-views.js";
import { WorkflowDefinitionService } from "../core/workflows/workflow-definition-service.js";
import { LockdownService } from "../core/access/lockdown-service.js";
import { KnowledgeDocumentService } from "../core/knowledge/knowledge-document-service.js";
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
  type OperationalEvent,
  type OperationalOutcome,
  type ModelRequirementProfile,
  type SoftwareFactoryEnvironmentProvider,
  type SoftwareFactoryProgram,
  type SoftwareFactoryTaskAlias,
  type Workstream,
  type Task,
  type Workflow,
  type WorkflowControlRecord,
  PermissionDeniedError,
} from "../contracts/index.js";
import {
  FirebaseOperatorDirectory,
  FirebaseAppCheckVerifier,
  FirestoreExecutionPlanStore,
  FirestoreExecutionRecordStore,
  FirestoreExecutionSessionStore,
  FirestoreOperatorAccountStore,
  FirestoreOperatorProfileStore,
  FirestoreOnboardingSessionStore,
  FirestoreProvisionedProjectStore,
  FirestoreAppendOnlySecurityEventStore,
  FirestoreAssignmentRepository,
  FirestoreExecutionReceiptStore,
  FirestoreWriteScopeLeaseRepository,
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
  type AssignmentRepository,
  type ExecutionReceiptStore,
  ProjectWorkforcePlanner,
  SpecialistAssignmentService,
  WriteScopeLeaseManager,
  Orchestrator,
  OperationalAuditSink,
  OperationalDataSystem,
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
  resolveAppCheckMode,
  validateAppCheckProductionConfig,
  createDestructiveSecurityEventObserver,
  DEFAULT_PRIVILEGED_APP_CHECK_ROUTES,
} from "./security/index.js";
import { DestructiveActionService } from "../core/security/destructive-action-service.js";
import { IncidentResponseService } from "../core/secops/incident-response-service.js";
import type {
  ContainmentExecutor,
  SecurityIncidentRecord,
} from "../core/secops/incident-response-service.js";
import {
  SecurityPolicyEngine,
  defaultSecurityPolicies,
} from "../core/security/security-policy-engine.js";
import {
  DestructiveSecretReferenceMutationAuthorizer,
  DestructiveSecurityPolicyMutationAuthorizer,
  SecretReferenceService,
  SecurityPolicyService,
  SecretAccessService,
  ToolCredentialBroker,
  SecretRotationService,
  SecurityFindingStore,
  DeploymentSecurityGate,
  SecretLeakHandler,
} from "../core/security/index.js";
import {
  GoogleSecretManagerVault,
  InMemorySecretVault,
} from "../adapters/vault/index.js";
import type {
  SecretVault,
  CredentialBroker,
  SecurityFinding,
} from "../contracts/index.js";
import type { DestructiveActionRequest } from "../contracts/destructive-action.js";
import type { SecurityPolicy } from "../contracts/security-policy.js";
import type { ManagedSecretReference } from "../contracts/secret-reference.js";
import type { AsyncSecurityEventStore } from "../contracts/security-event.js";
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
  readonly destructiveActions: DestructiveActionService;
  readonly securityPolicyEngine: SecurityPolicyEngine;
  readonly securityPolicies: SecurityPolicyService;
  readonly secretReferences: SecretReferenceService;
  readonly secretVault: SecretVault;
  readonly secretAccess: SecretAccessService;
  readonly credentialBroker: CredentialBroker;
  readonly secretRotation: SecretRotationService;
  readonly securityFindings: SecurityFindingStore;
  readonly deploymentGate: DeploymentSecurityGate;
  readonly secretLeakHandler: SecretLeakHandler;
  readonly canonicalSecurityEvents: AsyncSecurityEventStore;
  /**
   * The FULL release services. The control-plane context exposes only their read views; the
   * trusted host (and tests) hold the whole thing. No HTTP route reaches the mutating methods.
   */
  /**
   * The FULL specialist workforce services, including the MUTATING methods.
   * The control-plane context exposes only read views; no HTTP route can
   * create an assignment, take a write lease, or accept a handoff. Only the
   * trusted host (and tests) can, which is what keeps "assigned" a decision
   * rather than a side effect of a read.
   */
  readonly specialist: {
    readonly assignments: SpecialistAssignmentService;
    readonly assignmentRepository: AssignmentRepository;
    readonly handoffs: SpecialistHandoffService;
    readonly writeLeases: WriteScopeLeaseManager;
  };
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
  /** Operational facts/outcomes backing future readiness-gated analytics. */
  readonly operations: OperationalDataSystem;
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
  const destructiveActionsRepository =
    repositories.repository<DestructiveActionRequest>("destructive_actions");
  const securityPoliciesRepository =
    repositories.repository<SecurityPolicy>("security_policies");
  const secretReferencesRepository =
    repositories.repository<ManagedSecretReference>("secret_references");
  const securityIncidentsRepository =
    repositories.repository<SecurityIncidentRecord>("security_incidents");
  const operationalEventsRepository =
    repositories.repository<OperationalEvent>("operational_events");
  const operationalOutcomesRepository =
    repositories.repository<OperationalOutcome>("operational_outcomes");
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

  // ITSM Repositories
  const itsmServicesRepository =
    repositories.repository<import("../contracts/itsm.js").Service>(
      "itsm_services",
    );
  const itsmIncidentsRepository =
    repositories.repository<import("../contracts/itsm.js").Incident>(
      "itsm_incidents",
    );
  const itsmProblemsRepository =
    repositories.repository<import("../contracts/itsm.js").Problem>(
      "itsm_problems",
    );
  const itsmChangesRepository =
    repositories.repository<import("../contracts/itsm.js").ChangeRequest>(
      "itsm_changes",
    );
  const itsmReleasesRepository =
    repositories.repository<import("../contracts/itsm.js").ITSMRelease>(
      "itsm_releases",
    );
  const itsmCisRepository =
    repositories.repository<import("../contracts/itsm.js").ConfigurationItem>(
      "itsm_cis",
    );
  const itsmRequestsRepository =
    repositories.repository<import("../contracts/itsm.js").ServiceRequest>(
      "itsm_requests",
    );
  const itsmRunbooksRepository =
    repositories.repository<import("../contracts/itsm.js").Runbook>(
      "itsm_runbooks",
    );
  const itsmCiRelsRepository =
    repositories.repository<import("../contracts/itsm.js").CIRelationship>(
      "itsm_cirels",
    );

  // Operations Repositories
  const opsHealthRepository =
    repositories.repository<import("../contracts/operations.js").HealthSignal>(
      "ops_health_signals",
    );
  const opsInventoryRepository = repositories.repository<
    import("../contracts/operations.js").ServiceInventoryRecord
  >("ops_service_inventory");
  const opsAlertsRepository =
    repositories.repository<import("../contracts/operations.js").Alert>(
      "ops_alerts",
    );
  const opsConfigRepository = repositories.repository<
    import("../contracts/operations.js").PlatformConfiguration
  >("ops_platform_config");
  const opsRolloutsRepository = repositories.repository<
    import("../contracts/operations.js").FeatureRollout
  >("ops_feature_rollouts");

  // AI Governance Repositories
  const aiModelsRepository =
    repositories.repository<
      import("../contracts/ai-governance.js").AIModelRecord
    >("ai_models");
  const aiUseCasesRepository =
    repositories.repository<import("../contracts/ai-governance.js").AIUseCase>(
      "ai_use_cases",
    );
  const aiEvaluationsRepository =
    repositories.repository<
      import("../contracts/ai-governance.js").ModelEvaluation
    >("ai_evaluations");
  const aiIncidentsRepository =
    repositories.repository<import("../contracts/ai-governance.js").AIIncident>(
      "ai_incidents",
    );

  // Data Governance Repositories
  const dataAssetsRepository =
    repositories.repository<
      import("../contracts/data-governance.js").DataAsset
    >("data_assets");
  const dataRetentionPoliciesRepository = repositories.repository<
    import("../contracts/data-governance.js").DataRetentionPolicy
  >("data_retention_policies");
  const dsrRepository =
    repositories.repository<
      import("../contracts/data-governance.js").DataSubjectRequestRecord
    >("dsr_records");

  // Security Repositories
  const securityEventsRepository =
    repositories.repository<
      import("../contracts/security.js").ZTNSecurityEvent
    >("security_events");
  const zeroTrustPoliciesRepository = repositories.repository<
    import("../contracts/security.js").ZeroTrustPolicy
  >("zero_trust_policies");
  const threatIntelRepository =
    repositories.repository<
      import("../contracts/security.js").ThreatIntelligenceReport
    >("threat_intel");

  // Audit Repositories
  const auditLogsRepository =
    repositories.repository<import("../contracts/audit.js").AuditLogEntry>(
      "audit_logs",
    );
  const complianceFindingsRepository = repositories.repository<
    import("../contracts/audit.js").ComplianceFinding
  >("compliance_findings");

  // Portfolio Repositories
  const strategicObjectivesRepository = repositories.repository<
    import("../contracts/portfolio.js").StrategicObjective
  >("strategic_objectives");
  const enterprisePortfoliosRepository = repositories.repository<
    import("../contracts/portfolio.js").EnterprisePortfolio
  >("enterprise_portfolios");
  const portfolioProgramsRepository =
    repositories.repository<
      import("../contracts/portfolio.js").PortfolioProgram
    >("portfolio_programs");

  // Product Repositories
  const productPortfoliosRepository =
    repositories.repository<import("../contracts/product.js").ProductPortfolio>(
      "product_portfolios",
    );
  const productsRepository =
    repositories.repository<
      import("../contracts/product.js").ProductDefinition
    >("products");
  const problemsRepository =
    repositories.repository<import("../contracts/product.js").CustomerProblem>(
      "customer_problems",
    );
  const opportunitiesRepository = repositories.repository<
    import("../contracts/product.js").ProductOpportunity
  >("product_opportunities");
  const featuresRepository =
    repositories.repository<import("../contracts/product.js").ProductFeature>(
      "product_features",
    );

  // Workforce Repositories
  const departmentsRepository = repositories.repository<
    import("../contracts/organization.js").OrganizationDepartment
  >("organization_departments");
  const teamsRepository =
    repositories.repository<
      import("../contracts/organization.js").WorkforceTeam
    >("workforce_teams");
  const humanAgentsRepository =
    repositories.repository<import("../contracts/organization.js").HumanAgent>(
      "human_agents",
    );
  const skillsRepository =
    repositories.repository<
      import("../contracts/organization.js").SkillDefinition
    >("skill_definitions");
  const resourceAssignmentsRepository = repositories.repository<
    import("../contracts/organization.js").ResourceAssignment
  >("resource_assignments");

  // GRC Repositories
  const grcControlsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/compliance.js").ControlInstance
  >("grc_controls");
  const grcFrameworksRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/compliance.js").ComplianceFramework
  >("grc_frameworks");
  const grcPoliciesRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/compliance.js").ComplianceFramework
  >("grc_policies");
  const grcControlInstancesRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/compliance.js").ControlInstance
  >("grc_control_instances");
  const grcRisksRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/risk.js").EnterpriseRisk
  >("grc_risks");
  const grcExceptionsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/risk.js").ComplianceException
  >("grc_exceptions");
  const grcVendorsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/risk.js").ThirdPartyVendor
  >("grc_vendors");
  const grcPrivacyRequestsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/privacy.js").DataSubjectRequest
  >("grc_privacy_requests");
  const grcRetentionPoliciesRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/privacy.js").RetentionPolicy
  >("grc_retention_policies");
  const grcDlpPoliciesRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/privacy.js").DlpPolicy
  >("grc_dlp_policies");
  const grcPosturesRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/trust.js").CompliancePosture
  >("grc_postures");
  const grcAuditsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/trust.js").AuditReadiness
  >("grc_audits");
  const grcAuditPackagesRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/trust.js").AuditPackage
  >("grc_audit_packages");
  const grcCertificationsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/trust.js").CertificationRecord
  >("grc_certifications");
  const grcTrustContentRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/trust.js").TrustCenterContent
  >("grc_trust_content");
  const grcFindingsRepository = repositories.repository<
    import("../contracts/persistence.js").Entity &
      import("../contracts/trust.js").ControlFinding
  >("grc_findings");

  await repositories.hydrateAll();

  if (securityPoliciesRepository.list().length === 0) {
    for (const policy of defaultSecurityPolicies(now)) {
      securityPoliciesRepository.upsert(policy);
    }
  }

  const operations = new OperationalDataSystem({
    events: operationalEventsRepository,
    outcomes: operationalOutcomesRepository,
  });
  const audit = new AuditLog(
    new OperationalAuditSink(operations),
    auditRepository,
  );
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
  // R1 — durable execution state. Promote the Firestore handle up front so
  // assignments, leases, and execution receipts can be write-through
  // persisted from here on. In test contexts without a transactional
  // Firestore seam we fall back to pure in-memory repositories so the
  // existing test harness continues to work.
  const _firestoreForDurable = services.firestore;
  const _transactionalFirestoreForDurable = isTransactionalFirestore(
    _firestoreForDurable,
  )
    ? _firestoreForDurable
    : undefined;
  const assignmentRepository: AssignmentRepository =
    _transactionalFirestoreForDurable
      ? new FirestoreAssignmentRepository(_transactionalFirestoreForDurable, {
          collectionPrefix: options.collectionPrefix,
        })
      : new InMemoryAssignmentRepository();
  const writeScopeLeaseRepository = _transactionalFirestoreForDurable
    ? new FirestoreWriteScopeLeaseRepository(
        _transactionalFirestoreForDurable,
        { collectionPrefix: options.collectionPrefix },
      )
    : new InMemoryLeaseRepository();
  const specialistAssignments = new SpecialistAssignmentService(
    assignmentRepository,
    () => bootstrap.agents.listDescriptors(),
    writeScopeLeaseRepository,
    () => new Date().toISOString(),
    audit,
    environmentRegistry,
  );
  const projectWorkforcePlanner = new ProjectWorkforcePlanner(
    specialistAssignments,
    () => bootstrap.agents.listDescriptors(),
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
    // UI Layer 7: "sign out all devices" also revokes Firebase refresh tokens.
    identityProvider: services.auth,
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
  const executionReceipts: ExecutionReceiptStore =
    _transactionalFirestoreForDurable
      ? new FirestoreExecutionReceiptStore(_transactionalFirestoreForDurable, {
          collectionPrefix: options.collectionPrefix,
        })
      : new InMemoryExecutionReceiptStore();
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
  const existingMoneyMindGovernance = await governancePolicies.getInternal("money-mind");
  if (existingMoneyMindGovernance?.allowUnknownCost !== true) {
    await governancePolicies.setTrusted("money-mind", { allowUnknownCost: true });
  }
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
    operations,
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
      // UI Layer 6: the declared model capability profiles + which providers are registered.
      models: modelCapabilities,
      providers: modelProviders,
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
    // The specialist layer, exposed to the Control Plane as READ-ONLY ports.
    // Queries can read assignments, handoffs, instances and staffing plans;
    // only the trusted host (`runtime.specialist`) can create or change them.
    specialist: {
      assignments: {
        currentForTask: (taskId: string) =>
          specialistAssignments.currentForTask(taskId),
        historyForTask: (taskId: string) =>
          specialistAssignments.historyForTask(taskId),
        require: (assignmentId: string) =>
          specialistAssignments.require(assignmentId),
        mayWrite: (workspaceId: string, agentId: string, path: string) =>
          specialistAssignments.mayWrite(workspaceId, agentId, path),
      },
      listAssignments: () => assignmentRepository.list(),
      plan: (planInput) => projectWorkforcePlanner.plan(planInput),
      handoffs: {
        list: () => specialistHandoffs.list(),
        forTask: (taskId: string) => specialistHandoffs.forTask(taskId),
      },
      listInstances: () => bootstrap.agents.listInstances(),
    },
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
    // UI Layer 13: knowledge documents in the durable record store.
    knowledgeDocuments: new KnowledgeDocumentService(executionRecords),
    // UI Layer 4 Workflow Studio: definitions + immutable versions in the durable record store.
    workflowDefinitions: new WorkflowDefinitionService({
      store: executionRecords,
      capabilities: (projectId) =>
        workflowCapabilityContext(
          {
            agents: bootstrap.agents,
            tools: bootstrap.tools,
            isAgentEnabled: (agentId, pid) => agentOps.isEnabled(agentId, pid),
          },
          projectId,
        ),
    }),
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

  const itsm = new ITSMControlService(
    itsmServicesRepository,
    itsmIncidentsRepository,
    itsmProblemsRepository,
    itsmChangesRepository,
    itsmReleasesRepository,
    itsmCisRepository,
    itsmRequestsRepository,
    itsmRunbooksRepository,
    itsmCiRelsRepository,
  );

  const ops = new OperationsControlService(
    opsHealthRepository,
    opsInventoryRepository,
    opsAlertsRepository,
    opsConfigRepository,
    opsRolloutsRepository,
  );

  const aiGov = new AIGovernanceControlService(
    aiModelsRepository,
    aiUseCasesRepository,
    aiEvaluationsRepository,
    aiIncidentsRepository,
  );

  const dataGov = new DataGovernanceService(
    dataAssetsRepository,
    dataRetentionPoliciesRepository,
    dsrRepository,
  );

  const security = new SecurityControlService(
    securityEventsRepository,
    zeroTrustPoliciesRepository,
    threatIntelRepository,
    new FirestoreAppendOnlySecurityEventStore(transactionalFirestore),
  );

  const auditService = new AuditControlService(
    auditLogsRepository,
    complianceFindingsRepository,
  );

  const portfolio = new PortfolioControlService(
    strategicObjectivesRepository,
    enterprisePortfoliosRepository,
    portfolioProgramsRepository,
  );

  const product = new ProductManagementService(
    productPortfoliosRepository,
    productsRepository,
    problemsRepository,
    opportunitiesRepository,
    featuresRepository,
  );

  const workforce = new WorkforceManagementService(
    departmentsRepository,
    teamsRepository,
    humanAgentsRepository,
    skillsRepository,
    resourceAssignmentsRepository,
  );

  const grc = new GrcControlService(
    grcControlsRepository,
    grcFrameworksRepository,
    grcPoliciesRepository,
    grcControlInstancesRepository,
    grcRisksRepository,
    grcExceptionsRepository,
    grcVendorsRepository,
    grcPrivacyRequestsRepository,
    grcRetentionPoliciesRepository,
    grcDlpPoliciesRepository,
    grcPosturesRepository,
    grcAuditsRepository,
    grcAuditPackagesRepository,
    grcCertificationsRepository,
    grcTrustContentRepository,
    grcFindingsRepository,
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
  const appCheckMode = resolveAppCheckMode();
  const appCheckVerifier = new FirebaseAppCheckVerifier(services.appCheck);
  const appCheckRequiredPaths = DEFAULT_PRIVILEGED_APP_CHECK_ROUTES;
  const appCheckConfig = validateAppCheckProductionConfig({
    mode: appCheckMode,
    verifier: appCheckVerifier,
    requiredPaths: appCheckRequiredPaths,
  });
  if (!appCheckConfig.valid) {
    throw new ValidationError(
      appCheckConfig.error ?? "invalid App Check configuration",
    );
  }

  const canonicalSecurityEventStore = new FirestoreAppendOnlySecurityEventStore(
    transactionalFirestore,
  );
  const destructiveActionObserver = createDestructiveSecurityEventObserver(
    canonicalSecurityEventStore,
  );
  const securityPolicyEngine = new SecurityPolicyEngine(
    securityPoliciesRepository,
  );
  const destructiveActions = new DestructiveActionService(
    securityPolicyEngine,
    approvals,
    destructiveActionsRepository,
    undefined,
    destructiveActionObserver,
  );
  const securityPolicies = new SecurityPolicyService(
    securityPoliciesRepository,
    new DestructiveSecurityPolicyMutationAuthorizer(destructiveActions),
  );
  const containmentExecutor: ContainmentExecutor = {
    execute: async ({ request, principal }) => {
      const targetId = request.justification.affectedResources[0];
      if (!targetId) throw new ValidationError("containment target is missing");
      if (request.justification.affectedResources.length !== 1) {
        throw new ValidationError("containment requires exactly one target");
      }
      const result = await command.disableAgent(
        principal,
        { agentId: targetId },
        { correlationId: request.correlationId },
      );
      if (result.outcome !== "executed") {
        throw new PermissionDeniedError(
          `authoritative agent disable was not executed: ${result.outcome}`,
        );
      }
      return {
        subsystem: "agent_registry",
        action: "disable_agent",
        targetId,
        result,
      };
    },
  };
  const secretReferences = new SecretReferenceService(
    secretReferencesRepository,
    new DestructiveSecretReferenceMutationAuthorizer(destructiveActions),
  );
  const incidentResponse = new IncidentResponseService(
    securityIncidentsRepository,
    destructiveActions,
    { canAccess: (principal) => principal.allowedProjects === "*" },
    containmentExecutor,
  );
  const secretVault: SecretVault =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
      ? new GoogleSecretManagerVault({
          projectId:
            process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT,
        })
      : new InMemorySecretVault();
  const secretAccess = new SecretAccessService({
    vault: secretVault,
    repository: secretReferencesRepository,
    policyEngine: securityPolicyEngine,
    securityEvents: canonicalSecurityEventStore,
  });
  const credentialBroker = new ToolCredentialBroker(secretAccess);
  const secretRotation = new SecretRotationService({
    vault: secretVault,
    repository: secretReferencesRepository,
    policyEngine: securityPolicyEngine,
    securityEvents: canonicalSecurityEventStore,
  });
  const securityFindingsRepository =
    repositories.repository<SecurityFinding>("security_findings");
  const securityFindings = new SecurityFindingStore(securityFindingsRepository);
  const deploymentGate = new DeploymentSecurityGate(
    securityFindings,
    securityPolicyEngine,
    canonicalSecurityEventStore,
  );
  const secretLeakHandler = new SecretLeakHandler(
    securityFindings,
    secretReferencesRepository,
    canonicalSecurityEventStore,
  );

  const handler = createControlPlaneApi({
    // UI Layer 11: emergency lockdown state is durable in the execution record store.
    lockdown: new LockdownService(executionRecords, audit),
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
    destructiveActionService: destructiveActions,
    securityPolicyService: securityPolicies,
    secretReferenceService: secretReferences,
    incidentResponseService: incidentResponse,
    secretRotationService: secretRotation,
    securityFindingStore: securityFindings,
    deploymentSecurityGate: deploymentGate,
    securityPolicyEngine,
    securityEventStore: canonicalSecurityEventStore,
    operatorAccounts,
    apiSecurity: {
      appCheck: {
        mode: appCheckMode,
        verifier: appCheckVerifier,
        requiredPaths: appCheckRequiredPaths,
      },
      production: process.env.NODE_ENV === "production",
    },
    // R2 — HTTP response boundary flush. Before every response we await
    // the pending Firestore mirror writes on the three R1 write-through
    // caches so a client that sees HTTP 2xx can rely on durability.
    flushDurableWrites: flushR1DurableAdapters,
  });

  function flushR1DurableAdapters(): Promise<void> {
    const flushes: Array<Promise<void>> = [];
    if (assignmentRepository instanceof FirestoreAssignmentRepository) {
      flushes.push(assignmentRepository.flush());
    }
    if (writeScopeLeaseRepository instanceof FirestoreWriteScopeLeaseRepository) {
      flushes.push(writeScopeLeaseRepository.flush());
    }
    if (executionReceipts instanceof FirestoreExecutionReceiptStore) {
      flushes.push(executionReceipts.flush());
    }
    return flushes.length > 0
      ? Promise.all(flushes).then(() => undefined)
      : Promise.resolve();
  }

  // R1 — hydrate the durable execution-state caches before the control
  // plane accepts traffic. Each Firestore-backed repository exposes a
  // `.ready` promise that completes after its initial `.get()` lands.
  // In-memory fallbacks have nothing to load, so this is a no-op there.
  const readyWaits: Array<Promise<void>> = [];
  if (assignmentRepository instanceof FirestoreAssignmentRepository) {
    readyWaits.push(assignmentRepository.ready);
  }
  if (writeScopeLeaseRepository instanceof FirestoreWriteScopeLeaseRepository) {
    readyWaits.push(writeScopeLeaseRepository.ready);
  }
  if (executionReceipts instanceof FirestoreExecutionReceiptStore) {
    readyWaits.push(executionReceipts.ready);
  }
  if (readyWaits.length > 0) {
    await Promise.all(readyWaits);
  }

  return Object.freeze({
    handler,
    context,
    services,
    repositories,
    bootstrap,
    query,
    command,
    destructiveActions,
    securityPolicies,
    secretReferences,
    secretVault,
    secretAccess,
    credentialBroker,
    secretRotation,
    securityFindings,
    deploymentGate,
    secretLeakHandler,
    securityPolicyEngine,
    canonicalSecurityEvents: canonicalSecurityEventStore,
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
    // R2 — dispatcher-wide barrier: the Firebase HTTPS adapter wraps
    // `response.end()` with this flush so EVERY response path (success,
    // error, middleware early-return) awaits both the cached-repository
    // writes AND the R1 write-through adapters before the serverless
    // instance is allowed to freeze.
    flush: async () => {
      await Promise.all([
        repositories.flushAll(),
        flushR1DurableAdapters(),
      ]);
    },
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
