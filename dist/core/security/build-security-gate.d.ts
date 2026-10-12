import type { Repository } from "../../contracts/persistence.js";
import type { BuildProvenance, SecurityCheckResult, SecurityFinding, SecurityGateResult } from "../../contracts/security-build.js";
import type { ZTNSecurityEvent } from "../../contracts/security.js";
import { SecurityExceptionStore } from "./security-exception-store.js";
export interface BuildSecurityGateOptions {
    exceptionStore?: SecurityExceptionStore;
    securityEvents?: Repository<ZTNSecurityEvent>;
    auditLog?: {
        log(event: string, meta?: Record<string, unknown>): void;
    };
}
export interface GateEvaluationInput {
    environment: string;
    findings: readonly SecurityFinding[];
    checks: readonly SecurityCheckResult[];
    artifactContent?: string | Buffer;
    commitSha?: string;
    branch?: string;
}
/**
 * Deterministic Build Security Gate Service (Step 22).
 * Consumes scanner outputs, evaluates blocking rules, checks governed exceptions,
 * calculates artifact integrity, emits security events, and returns SecurityGateResult.
 */
export declare class BuildSecurityGateService {
    private readonly exceptionStore;
    private readonly securityEvents?;
    private readonly auditLog?;
    constructor(options?: BuildSecurityGateOptions);
    evaluateGate(input: GateEvaluationInput): Promise<SecurityGateResult>;
    generateBuildProvenance(buildId: string, gateResult: SecurityGateResult, lockfileContent?: string): Promise<BuildProvenance>;
    private emitSecurityEvent;
}
