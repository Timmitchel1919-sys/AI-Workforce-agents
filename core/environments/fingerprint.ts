/**
 * Deterministic, dependency-free fingerprints for hosts and environments.
 *
 * FNV-1a (32-bit, hex) is used instead of `node:crypto` so this module stays in
 * the pure core (no `node:` imports). Fingerprints make discovery idempotent:
 * the same detection inputs always produce the same fingerprint, so repeated
 * discovery refreshes records instead of duplicating them.
 */
import type {
  EnvironmentInstance,
  EnvironmentType,
  OperatingSystem,
} from "../../contracts/index.js";

const OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1aHex(input: string): string {
  let hash = OFFSET_BASIS >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface HostFingerprintInput {
  hostId: string;
  os: OperatingSystem;
}

export function hostFingerprint(input: HostFingerprintInput): string {
  return fnv1aHex(
    `host|${input.hostId}|${input.os.os}|${input.os.architecture}`,
  );
}

/** Stable identity of one installed environment on one host. */
export function environmentFingerprint(
  hostId: string,
  environmentType: EnvironmentType,
  version?: string,
  installation?: string,
): string {
  return fnv1aHex(
    `env|${hostId}|${environmentType}|${version ?? ""}|${installation ?? ""}`,
  );
}

export function instanceIdForFingerprint(fingerprint: string): string {
  return `instance_${fingerprint}`;
}

/** Convenience: the fingerprint/id a detected environment will be registered as. */
export function fingerprintForInstance(input: {
  hostId: string;
  environmentType: EnvironmentType;
  version?: string;
  installation?: string;
}): string {
  return environmentFingerprint(
    input.hostId,
    input.environmentType,
    input.version,
    input.installation,
  );
}

/** Copy a fingerprint cross-check: two instances that describe the same thing match. */
export function sameFingerprint(
  a: Pick<EnvironmentInstance, "fingerprint">,
  b: Pick<EnvironmentInstance, "fingerprint">,
): boolean {
  return a.fingerprint !== "" && a.fingerprint === b.fingerprint;
}
