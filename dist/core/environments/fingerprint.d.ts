/**
 * Deterministic, dependency-free fingerprints for hosts and environments.
 *
 * FNV-1a (32-bit, hex) is used instead of `node:crypto` so this module stays in
 * the pure core (no `node:` imports). Fingerprints make discovery idempotent:
 * the same detection inputs always produce the same fingerprint, so repeated
 * discovery refreshes records instead of duplicating them.
 */
import type { EnvironmentInstance, EnvironmentType, OperatingSystem } from "../../contracts/index.js";
export declare function fnv1aHex(input: string): string;
export interface HostFingerprintInput {
    hostId: string;
    os: OperatingSystem;
}
export declare function hostFingerprint(input: HostFingerprintInput): string;
/** Stable identity of one installed environment on one host. */
export declare function environmentFingerprint(hostId: string, environmentType: EnvironmentType, version?: string, installation?: string): string;
export declare function instanceIdForFingerprint(fingerprint: string): string;
/** Convenience: the fingerprint/id a detected environment will be registered as. */
export declare function fingerprintForInstance(input: {
    hostId: string;
    environmentType: EnvironmentType;
    version?: string;
    installation?: string;
}): string;
/** Copy a fingerprint cross-check: two instances that describe the same thing match. */
export declare function sameFingerprint(a: Pick<EnvironmentInstance, "fingerprint">, b: Pick<EnvironmentInstance, "fingerprint">): boolean;
