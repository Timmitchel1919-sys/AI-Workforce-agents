/**
 * Dependency planning — requirements only. Nothing here installs anything.
 *
 * Dependencies form a DAG: `toolchain:<kind>` nodes, `toolchain:<kind>:<name>`
 * component nodes (which depend on their toolchain), plus declared
 * toolchain-to-toolchain edges from the technology catalog. Duplicate
 * requirements merge to the highest minimum version. Resolution order is a
 * topological sort with an id tie-break (Kahn); cycles and references to
 * unknown nodes are reported as conflicts, never silently dropped.
 */
import { compareVersions, } from "../../contracts/index.js";
export function dependencyRequirements(technologies, catalog) {
    const items = new Map();
    const upsert = (next) => {
        const prev = items.get(next.id);
        if (!prev) {
            items.set(next.id, next);
            return;
        }
        const minimum = compareVersions(prev.minimum, next.minimum) >= 0
            ? prev.minimum
            : next.minimum;
        items.set(next.id, {
            ...prev,
            ...(minimum ? { minimum } : {}),
            requiredBy: [...new Set([...prev.requiredBy, ...next.requiredBy])].sort(),
            dependsOn: [...new Set([...prev.dependsOn, ...next.dependsOn])].sort(),
        });
    };
    for (const tech of technologies) {
        const profile = catalog.get(tech.technologyId);
        for (const toolchain of tech.toolchains) {
            const id = `toolchain:${toolchain.kind}`;
            const dependsOn = (profile?.toolchainDependencies ?? [])
                .filter((d) => d.from === toolchain.kind)
                .map((d) => `toolchain:${d.to}`);
            upsert({
                id,
                kind: "toolchain",
                toolchainKind: toolchain.kind,
                name: toolchain.kind,
                ...(toolchain.minimum ? { minimum: toolchain.minimum } : {}),
                requiredBy: [tech.componentId],
                dependsOn,
            });
            for (const component of toolchain.components ?? []) {
                upsert({
                    id: `${id}:${component.name}`,
                    kind: "toolchain_component",
                    toolchainKind: toolchain.kind,
                    name: component.name,
                    ...(component.minimum ? { minimum: component.minimum } : {}),
                    requiredBy: [tech.componentId],
                    dependsOn: [id],
                });
            }
        }
    }
    return [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
}
/** Deterministic topological order + structured conflicts. */
export function planDependencies(items) {
    const ids = new Set(items.map((i) => i.id));
    const conflicts = [];
    const inDegree = new Map();
    const dependents = new Map();
    for (const item of items) {
        inDegree.set(item.id, inDegree.get(item.id) ?? 0);
        for (const dep of item.dependsOn) {
            if (!ids.has(dep)) {
                conflicts.push({ dependencyId: item.id, reason: "unknown_dependency" });
                continue;
            }
            inDegree.set(item.id, (inDegree.get(item.id) ?? 0) + 1);
            dependents.set(dep, [...(dependents.get(dep) ?? []), item.id]);
        }
    }
    const ready = [...inDegree.entries()]
        .filter(([, degree]) => degree === 0)
        .map(([id]) => id)
        .sort();
    const order = [];
    while (ready.length > 0) {
        const id = ready.shift();
        order.push(id);
        for (const dependent of (dependents.get(id) ?? []).sort()) {
            const degree = (inDegree.get(dependent) ?? 0) - 1;
            inDegree.set(dependent, degree);
            if (degree === 0) {
                ready.push(dependent);
                ready.sort();
            }
        }
    }
    for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
        if (!order.includes(item.id) && (inDegree.get(item.id) ?? 0) > 0) {
            conflicts.push({ dependencyId: item.id, reason: "cycle" });
        }
    }
    return {
        items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
        order,
        conflicts: conflicts.sort((a, b) => a.dependencyId.localeCompare(b.dependencyId) ||
            a.reason.localeCompare(b.reason)),
    };
}
