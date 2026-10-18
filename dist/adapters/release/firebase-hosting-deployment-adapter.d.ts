import type { DeploymentAdapter, DeploymentContext } from "../../contracts/index.js";
import { type BoundedProcessResult, type BoundedProcessSpec } from "../execution/bounded-process-runner.js";
/** Trusted, composition-time config for one Firebase CLI binding. */
export interface FirebaseHostingAdapterConfig {
    /** Absolute path to the `firebase` CLI (never a caller-supplied path). */
    readonly firebaseExecutable: string;
    /** CI directory passed as --cwd; must be absolute. */
    readonly workingDirectory: string;
    /**
     * Bounded, server-side HTTP fetch used for post-deploy verification.
     * Default: `fetch(url, { signal })`. Tests inject a deterministic stub.
     */
    readonly httpFetch?: (url: string, options: {
        signal: AbortSignal;
    }) => Promise<{
        status: number;
        text(): Promise<string>;
    }>;
    /** Injected for tests; defaults to the EO-4.2 bounded process runner. */
    readonly processRunner?: (spec: BoundedProcessSpec) => Promise<BoundedProcessResult>;
}
export declare class FirebaseHostingDeploymentAdapter implements DeploymentAdapter {
    private readonly config;
    readonly adapterId = "firebase-hosting";
    readonly version = "1.0.0";
    readonly simulated = false;
    private readonly processRunner;
    private readonly httpFetch;
    constructor(config: FirebaseHostingAdapterConfig);
    deploy(ctx: DeploymentContext): Promise<{
        providerReleaseId: string;
        failedResources?: readonly string[];
    }>;
    verify(ctx: DeploymentContext): Promise<{
        reachable: boolean;
        reportedVersion?: string;
        detail: string;
    }>;
    rollback(ctx: DeploymentContext, toProviderReleaseId: string): Promise<void>;
    /** Build the child env. Credential rides in via FIREBASE_TOKEN only. */
    private buildChildEnv;
}
