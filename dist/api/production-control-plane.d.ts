import { type FirebaseServices } from "../adapters/firebase/index.js";
import { WorkforceCommandService, WorkforceQueryService, type ControlPlaneContext } from "../control/index.js";
import { BudgetEnforcer, BudgetPolicyStore, EnvironmentDetector, DeploymentOrchestrator, GovernancePolicyEngine, GovernancePolicyStore, ModelCapabilityRegistry, ModelProviderRegistry, ModelRouter, RuleAuditor, SourceControlOrchestrator, UsageLedger, VerificationService } from "../core/index.js";
import { FirebaseRepositoryProvider } from "./firebase-repositories.js";
import { type ApiHandler } from "./http-api.js";
import { type ProductionWorkforceBootstrap, type ProductionWorkforceConfiguration } from "./production-workforce-bootstrap.js";
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
export declare function createProductionControlPlaneRuntime(options?: ProductionControlPlaneRuntimeOptions): Promise<ProductionControlPlaneRuntime>;
