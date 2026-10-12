/**
 * Production `DestructiveApproverResolver` factory. Reuses the
 * authoritative `OperatorAccount` store + `principalFor(...)`. The
 * resolver is synchronous — the caller (API layer) pre-loads a fresh
 * account snapshot for every counted approver immediately before
 * calling `assertDestructiveActionApproved(...)` and hands this
 * resolver the pre-loaded map. No principal is fabricated; a missing
 * / pending / suspended / rejected / revoked account yields
 * `undefined`.
 */
import type {
  OperatorAccount,
  OperatorAccountStore,
  OperatorPrincipal,
} from "../../contracts/index.js";
import { principalFor } from "../../contracts/index.js";
import type { DestructiveApproverResolver } from "../../core/security/destructive-action-service.js";

export interface OperatorAccountApproverResolver extends DestructiveApproverResolver {
  /** Count of principals currently in the snapshot (diagnostics). */
  readonly size: number;
}

/**
 * Build a resolver from a pre-loaded, server-side snapshot of
 * accounts. The map's key is the operator id; the value is the
 * account the authoritative store returned at snapshot time. Only
 * `status === "active"` accounts materialize into principals, via
 * `principalFor(...)`.
 */
export function createOperatorAccountApproverResolver(
  snapshot: ReadonlyMap<string, OperatorAccount | undefined>,
): OperatorAccountApproverResolver {
  return {
    size: snapshot.size,
    resolve(operatorId: string): OperatorPrincipal | undefined {
      return principalFor(snapshot.get(operatorId)) ?? undefined;
    },
  };
}

/**
 * Convenience that loads a snapshot from the authoritative store for
 * a fixed set of operator ids. The caller awaits this just before
 * passing the resolver into `assertDestructiveActionApproved(...)`
 * so the evidence is maximally fresh.
 */
export async function loadApproverSnapshot(
  store: Pick<OperatorAccountStore, "get">,
  operatorIds: Iterable<string>,
): Promise<ReadonlyMap<string, OperatorAccount | undefined>> {
  const map = new Map<string, OperatorAccount | undefined>();
  for (const id of operatorIds) {
    if (map.has(id)) continue;
    map.set(id, await store.get(id));
  }
  return map;
}
