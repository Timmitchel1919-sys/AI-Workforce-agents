/**
 * TaskAnalyzer — deterministic normalization of a validated `ProjectRequest`
 * into structured technical requirements.
 *
 * Input is structured data only; the free-text `summary` is never parsed and
 * no model is called. Unknown or incompatible technologies are reported as
 * structured `UnsupportedTechnology` entries (a planning outcome), not thrown.
 */
import {
  type AnalysedComponent,
  type ProjectComponentRequest,
  type ProjectRequest,
  type TaskAnalysis,
  type TechnologyRequirement,
  type ToolchainComponentRequirement,
  type ToolchainRequirement,
  type UnsupportedTechnology,
} from "../../contracts/index.js";
import {
  TechnologyCatalog,
  type TechnologyProfile,
} from "./technology-catalog.js";

export class TaskAnalyzer {
  constructor(
    private readonly catalog: TechnologyCatalog = new TechnologyCatalog(),
  ) {}

  analyze(request: ProjectRequest): TaskAnalysis {
    const components: AnalysedComponent[] = [];
    const technologies: TechnologyRequirement[] = [];
    const unsupported: UnsupportedTechnology[] = [];

    for (const component of request.components) {
      const accepted: string[] = [];
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
        technologies.push(requirementFor(profile!, component));
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

  profile(technologyId: string): TechnologyProfile | undefined {
    return this.catalog.get(technologyId);
  }
}

function incompatibility(
  profile: TechnologyProfile | undefined,
  component: ProjectComponentRequest,
): UnsupportedTechnology["reason"] | undefined {
  if (!profile) return "unknown_technology";
  if (!profile.componentKinds.includes(component.kind)) {
    return "incompatible_component_kind";
  }
  if (!component.platforms.every((p) => profile.platforms.includes(p))) {
    return "incompatible_platform";
  }
  return undefined;
}

function requirementFor(
  profile: TechnologyProfile,
  component: ProjectComponentRequest,
): TechnologyRequirement {
  const toolchains: ToolchainRequirement[] = profile.toolchains.map((t) => {
    const components: ToolchainComponentRequirement[] = [
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
