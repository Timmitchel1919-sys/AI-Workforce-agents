import { type AsyncSecurityEventStore, type ManagedSecretReference, type OperatorPrincipal, type Repository, type SecretAccessContext, type SecretVault } from "../../contracts/index.js";
import type { SecurityPolicyEngine } from "./security-policy-engine.js";
export interface SecretRotationServiceOptions {
    vault: SecretVault;
    repository: Repository<ManagedSecretReference>;
    policyEngine?: SecurityPolicyEngine;
    securityEvents?: AsyncSecurityEventStore;
    clock?: () => string;
}
export declare class SecretRotationService {
    private readonly vault;
    private readonly repository;
    private readonly policyEngine?;
    private readonly securityEvents?;
    private readonly clock;
    constructor(options: SecretRotationServiceOptions);
    isDueForRotation(reference: ManagedSecretReference, nowIso?: string): boolean;
    rotate(principal: OperatorPrincipal, reference: ManagedSecretReference, newSecretValue: string, context: SecretAccessContext): Promise<ManagedSecretReference>;
    emergencyRevoke(principal: OperatorPrincipal, reference: ManagedSecretReference, context: SecretAccessContext): Promise<ManagedSecretReference>;
    private computeNextDueAt;
    private recordEvent;
}
