/**
 * ProjectArchitect — derives the architecture requirement and the execution
 * ENVIRONMENT requirements from a task analysis.
 *
 * One project is not one environment: each component contributes its own
 * requirement (merged per host OS), and identical requirements from different
 * components are shared. A React + .NET + Android project therefore yields
 * three environment requirements; the architect never collapses them.
 */
import { compareVersions, } from "../../contracts/index.js";
export class ProjectArchitect {
    architecture(analysis) {
        const platforms = new Set();
        const layers = new Set();
        for (const component of analysis.components) {
            layers.add(component.kind);
            component.platforms.forEach((p) => platforms.add(p));
        }
        return {
            style: platforms.size > 1 ? "multi_platform" : "single_platform",
            layers: [...layers].sort(),
            platforms: [...platforms].sort(),
            components: analysis.components.map((c) => ({
                componentId: c.componentId,
                kind: c.kind,
                platforms: c.platforms,
            })),
        };
    }
    /** Environment requirements in request order, deduplicated by content. */
    environmentRequirements(analysis) {
        const byKey = new Map();
        for (const component of analysis.components) {
            const techs = analysis.technologies.filter((t) => t.componentId === component.componentId);
            const byOs = new Map();
            for (const tech of techs) {
                const osKey = tech.os?.os ?? "*";
                byOs.set(osKey, [...(byOs.get(osKey) ?? []), tech]);
            }
            for (const [osKey, group] of [...byOs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
                const requirement = mergeRequirements(group, osKey === "*" ? undefined : osKey);
                const key = canonicalKey(requirement);
                const existing = byKey.get(key);
                if (existing) {
                    if (!existing.componentIds.includes(component.componentId)) {
                        existing.componentIds.push(component.componentId);
                    }
                }
                else {
                    byKey.set(key, {
                        id: `env-${byKey.size + 1}`,
                        componentIds: [component.componentId],
                        requirement,
                    });
                }
            }
        }
        return [...byKey.values()];
    }
}
function mergeRequirements(techs, os) {
    const capabilities = new Set();
    const toolchains = new Map();
    for (const tech of techs) {
        tech.capabilities.forEach((c) => capabilities.add(c));
        for (const t of tech.toolchains) {
            const prev = toolchains.get(t.kind);
            toolchains.set(t.kind, prev ? mergeToolchain(prev, t) : t);
        }
    }
    const requirement = {
        requiredCapabilities: [...capabilities].sort(),
        toolchains: [...toolchains.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
    };
    const osName = techs.find((t) => t.os?.os === os)?.os?.os;
    if (osName)
        requirement.os = { os: osName };
    return requirement;
}
function mergeToolchain(a, b) {
    const components = new Map();
    for (const c of [...(a.components ?? []), ...(b.components ?? [])]) {
        const prev = components.get(c.name);
        components.set(c.name, {
            name: c.name,
            ...maxMinimum(prev?.minimum, c.minimum),
        });
    }
    return {
        kind: a.kind,
        ...maxMinimum(a.minimum, b.minimum),
        ...(components.size > 0
            ? {
                components: [...components.values()].sort((x, y) => x.name.localeCompare(y.name)),
            }
            : {}),
    };
}
function maxMinimum(a, b) {
    const max = compareVersions(a, b) >= 0 ? a : b;
    return max ? { minimum: max } : {};
}
/** Order-independent key so identical requirements are shared. */
export function canonicalKey(value) {
    return JSON.stringify(sortKeys(value));
}
export function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sortKeys(v)]));
    }
    return value;
}
