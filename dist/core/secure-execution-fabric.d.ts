export declare class SecureExecutionFabric {
    preflight(): Promise<void>;
    verifyPriorLayers(): Promise<void>;
    auditExecutionInfrastructure(): Promise<void>;
    executeContracts(): Promise<void>;
    runnerRegistry(): Promise<void>;
    runnerCapabilities(): Promise<void>;
    runnerScheduler(): Promise<void>;
    sandboxLifecycle(): Promise<void>;
    workspaceIsolation(): Promise<void>;
    filesystemPolicy(): Promise<void>;
    networkPolicy(): Promise<void>;
    resourceLimits(): Promise<void>;
    processControl(): Promise<void>;
    toolGateway(): Promise<void>;
    secretBroker(): Promise<void>;
    credentialInjection(): Promise<void>;
    artifactManagement(): Promise<void>;
    executionMonitoring(): Promise<void>;
    timeoutCancellation(): Promise<void>;
    cleanup(): Promise<void>;
    recovery(): Promise<void>;
    environmentAdapters(): Promise<void>;
    integration(): Promise<void>;
    runFullLifecycle(): Promise<void>;
}
