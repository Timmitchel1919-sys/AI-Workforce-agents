import type { PackageAdmissionDecision, PackageAdmissionRequest } from "../../contracts/security-build.js";
/**
 * Dependency admission policy engine (Step 10 & 20).
 * Prevents AI agents and developers from casually installing untrusted,
 * typo-squatted, or compromised npm packages.
 */
export declare class PackageAdmissionPolicy {
    evaluate(request: PackageAdmissionRequest): PackageAdmissionDecision;
}
