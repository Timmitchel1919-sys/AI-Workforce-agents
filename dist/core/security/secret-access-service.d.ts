import { type AsyncSecurityEventStore, type ManagedSecretReference, type OperatorPrincipal, type Repository, type ResolvedSecretLease, type SecretAccessContext, type SecretVault } from "../../contracts/index.js";
import type { SecurityPolicyEngine } from "./security-policy-engine.js";
export interface SecretAccessServiceOptions {
    vault: SecretVault;
    repository: Repository<ManagedSecretReference>;
    policyEngine?: SecurityPolicyEngine;
    securityEvents?: AsyncSecurityEventStore;
    clock?: () => string;
}
export declare class SecretAccessService {
    private readonly vault;
    private readonly repository;
    private readonly policyEngine?;
    private readonly securityEvents?;
    private readonly clock;
    constructor(options: SecretAccessServiceOptions);
    resolve(caller: OperatorPrincipal | {
        id: string;
        type: "human" | "agent" | "service" | "system";
    }, referenceIdOrRef: string, context: SecretAccessContext): Promise<ResolvedSecretLease>;
    private recordEvent;
}
