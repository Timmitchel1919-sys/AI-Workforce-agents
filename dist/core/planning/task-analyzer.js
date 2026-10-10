import { TechnologyCatalog, } from "./technology-catalog.js";
export class TaskAnalyzer {
    catalog;
    constructor(catalog = new TechnologyCatalog()) {
        this.catalog = catalog;
    }
    analyze(request) {
        const components = [];
        const technologies = [];
        const unsupported = [];
        for (const component of request.components) {
            const accepted = [];
            for (const technologyId of component.technologies) {
                const profile = this.catalog.get(technologyId);
                const problem = incompatibility(profile, component);
                if (problem) {
                    unsupported.push({
                        componentId: component.id,
                        technologyId,
                        reason: problem,
                    });
                    continue;
                }
                accepted.push(technologyId);
                technologies.push(requirementFor(profile, component));
            }
            components.push({
                componentId: component.id,
                kind: component.kind,
                platforms: component.platforms,
                technologyIds: accepted,
            });
        }
        return {
            catalogVersion: this.catalog.version,
            components,
            technologies,
            unsupportedTechnologies: unsupported,
        };
    }
    profile(technologyId) {
        return this.catalog.get(technologyId);
    }
}
function incompatibility(profile, component) {
    if (!profile)
        return "unknown_technology";
    if (!profile.componentKinds.includes(component.kind)) {
        return "incompatible_component_kind";
    }
    if (!component.platforms.every((p) => profile.platforms.includes(p))) {
        return "incompatible_platform";
    }
    return undefined;
}
function requirementFor(profile, component) {
    const toolchains = profile.toolchains.map((t) => {
        const components = [
            ...(t.components ?? []),
        ];
        if (profile.platformComponents?.toolchain === t.kind) {
            for (const platform of component.platforms) {
                const name = profile.platformComponents.byPlatform[platform];
                if (name && !components.some((c) => c.name === name)) {
                    components.push({ name });
                }
            }
        }
        return {
            kind: t.kind,
            ...(t.minimum ? { minimum: { ...t.minimum } } : {}),
            ...(components.length > 0 ? { components } : {}),
        };
    });
    return {
        componentId: component.id,
        technologyId: profile.id,
        toolchains,
        ...(profile.os ? { os: { ...profile.os } } : {}),
        capabilities: [...profile.capabilities],
    };
}
