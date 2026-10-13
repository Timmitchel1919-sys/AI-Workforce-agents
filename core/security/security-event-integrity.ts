import { createHash } from "node:crypto";
import type { CanonicalSecurityEvent } from "../../contracts/index.js";

export const SECURITY_EVENT_GENESIS_HASH = "0".repeat(64);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function computeSecurityEventHash(
  event: CanonicalSecurityEvent,
  previousEventHash = SECURITY_EVENT_GENESIS_HASH,
): string {
  const {
    eventHash: _eventHash,
    previousEventHash: _previous,
    ...content
  } = event;
  return createHash("sha256")
    .update(JSON.stringify(canonical({ ...content, previousEventHash })))
    .digest("hex");
}

export function chainSecurityEvent(
  event: CanonicalSecurityEvent,
  previousEventHash = SECURITY_EVENT_GENESIS_HASH,
): CanonicalSecurityEvent {
  const chained = { ...structuredClone(event), previousEventHash };
  return {
    ...chained,
    eventHash: computeSecurityEventHash(chained, previousEventHash),
  };
}

export function verifySecurityEventIntegrity(
  event: CanonicalSecurityEvent,
): boolean {
  if (!event.previousEventHash || !event.eventHash) return false;
  return (
    computeSecurityEventHash(event, event.previousEventHash) === event.eventHash
  );
}

export function securityEventChainScope(event: CanonicalSecurityEvent): string {
  return event.projectId ?? "__global__";
}
