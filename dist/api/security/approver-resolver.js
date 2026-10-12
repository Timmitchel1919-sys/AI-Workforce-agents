import { principalFor } from "../../contracts/index.js";
/**
 * Build a resolver from a pre-loaded, server-side snapshot of
 * accounts. The map's key is the operator id; the value is the
 * account the authoritative store returned at snapshot time. Only
 * `status === "active"` accounts materialize into principals, via
 * `principalFor(...)`.
 */
export function createOperatorAccountApproverResolver(snapshot) {
    return {
        size: snapshot.size,
        resolve(operatorId) {
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
export async function loadApproverSnapshot(store, operatorIds) {
    const map = new Map();
    for (const id of operatorIds) {
        if (map.has(id))
            continue;
        map.set(id, await store.get(id));
    }
    return map;
}
