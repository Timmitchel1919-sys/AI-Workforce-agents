/**
 * ProjectArchitect — derives the architecture requirement and the execution
 * ENVIRONMENT requirements from a task analysis.
 *
 * One project is not one environment: each component contributes its own
 * requirement (merged per host OS), and identical requirements from different
 * components are shared. A React + .NET + Android project therefore yields
 * three environment requirements; the architect never collapses them.
 */
import {
  type ArchitectureRequirement,
  type CapabilityId,
  type ComponentKind,
  type EnvironmentRequirement,
  type TargetPlatform,
  type TaskAnalysis,
  type TechnologyRequirement,
  type ToolchainComponentRequirement,
  type ToolchainRequirement,
  type VersionInfo,
  compareVersions,
} from "../../contracts/index.js";

export interface DraftEnvironmentRequirement {
  id: string;
  componentIds: string[];
  requirement: EnvironmentRequirement;
}

export class ProjectArchitect {
  architecture(analysis: TaskAnalysis): ArchitectureRequirement {
    const platforms = new Set<TargetPlatform>();
    const layers = new Set<ComponentKind>();
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
  environmentRequirements(
    analysis: TaskAnalysis,
  ): DraftEnvironmentRequirement[] {
    const byKey = new Map<string, DraftEnvironmentRequirement>();
    for (const component of analysis.components) {
      const techs = analysis.technologies.filter(
        (t) => t.componentId === component.componentId,
      );
      const byOs = new Map<string, TechnologyRequirement[]>();
      for (const tech of techs) {
        const osKey = tech.os?.os ?? "*";
        byOs.set(osKey, [...(byOs.get(osKey) ?? []), tech]);
      }
      for (const [osKey, group] of [...byOs.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const requirement = mergeRequirements(
          group,
          osKey === "*" ? undefined : osKey,
        );
        const key = canonicalKey(requirement);
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.componentIds.includes(component.componentId)) {
            existing.componentIds.push(component.componentId);
          }
        } else {
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

function mergeRequirements(
  techs: readonly TechnologyRequirement[],
  os: string | undefined,
): EnvironmentRequirement {
  const capabilities = new Set<CapabilityId>();
  const toolchains = new Map<string, ToolchainRequirement>();
  for (const tech of techs) {
    tech.capabilities.forEach((c) => capabilities.add(c));
    for (const t of tech.toolchains) {
      const prev = toolchains.get(t.kind);
      toolchains.set(t.kind, prev ? mergeToolchain(prev, t) : t);
    }
  }
  const requirement: EnvironmentRequirement = {
    requiredCapabilities: [...capabilities].sort(),
    toolchains: [...toolchains.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind),
    ),
  };
  const osName = techs.find((t) => t.os?.os === os)?.os?.os;
  if (osName) requirement.os = { os: osName };
  return requirement;
}

function mergeToolchain(
  a: ToolchainRequirement,
  b: ToolchainRequirement,
): ToolchainRequirement {
  const components = new Map<string, ToolchainComponentRequirement>();
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
          components: [...components.values()].sort((x, y) =>
            x.name.localeCompare(y.name),
          ),
        }
      : {}),
  };
}

function maxMinimum(
  a: VersionInfo | undefined,
  b: VersionInfo | undefined,
): { minimum?: VersionInfo } {
  const max = compareVersions(a, b) >= 0 ? a : b;
  return max ? { minimum: max } : {};
}

/** Order-independent key so identical requirements are shared. */
export function canonicalKey(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
