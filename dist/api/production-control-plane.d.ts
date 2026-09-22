import { type FirebaseServices } from "../adapters/firebase/index.js";
import { WorkforceCommandService, WorkforceQueryService, type ControlPlaneContext } from "../control/index.js";
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
