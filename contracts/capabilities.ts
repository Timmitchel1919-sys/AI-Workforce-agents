/**
 * Capability taxonomy.
 *
 * A capability answers "what does this agent generally do?". It is NOT a
 * qualification (see `AgentQualificationRouter`) and NOT a permission — an
 * agent that declares `software.frontend` may be *offered* frontend work, but
 * whether it is *suitable for one specific task under one specific set of
 * constraints* is decided elsewhere, and whether it is *authorized* is decided
 * by governance.
 *
 * Identifiers are hierarchical and machine-readable: `namespace.segment[.segment]`.
 * Hierarchy is used for LEAST PRIVILEGE in one direction only — offering a broad
 * capability satisfies a narrow requirement, never the reverse:
 *
 *   offered `software.frontend`  satisfies required `software`      -> true
 *   offered `software`           satisfies required `software.frontend` -> FALSE
 *
 * Free-form labels are still accepted on legacy agent definitions (they predate
 * this taxonomy) and are mapped through {@link CAPABILITY_ALIASES}; a label with
 * no alias is a validation error on registration rather than a silent wildcard.
 */
import { ValidationError } from "./index.js";

/* ------------------------------------------------------------------ */
/* Grammar                                                            */
/* ------------------------------------------------------------------ */

export const CAPABILITY_SEGMENT_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const MAX_CAPABILITY_SEGMENTS = 3;
export const MAX_CAPABILITY_ID_LENGTH = 96;

/** Split a capability id into its segments, or `undefined` if malformed. */
export function parseCapabilityId(id: string): readonly string[] | undefined {
  if (typeof id !== "string") return undefined;
  if (id.length === 0 || id.length > MAX_CAPABILITY_ID_LENGTH) return undefined;
  const segments = id.split(".");
  if (segments.length > MAX_CAPABILITY_SEGMENTS) return undefined;
  for (const segment of segments) {
    if (!CAPABILITY_SEGMENT_PATTERN.test(segment)) return undefined;
  }
  return segments;
}

export function isCapabilityId(id: string): boolean {
  return parseCapabilityId(id) !== undefined;
}

/** The parent of a capability, or `undefined` at the root. */
export function parentCapability(id: string): string | undefined {
  const segments = parseCapabilityId(id);
  if (!segments || segments.length < 2) return undefined;
  return segments.slice(0, -1).join(".");
}

/** The root namespace of a capability (`software.frontend` -> `software`). */
export function rootCapability(id: string): string | undefined {
  return parseCapabilityId(id)?.[0];
}

/* ------------------------------------------------------------------ */
/* The registry of known capabilities                                 */
/* ------------------------------------------------------------------ */

export interface CapabilityDefinition {
  readonly id: string;
  readonly description: string;
}

/**
 * The V1 taxonomy. It is a registry, not an enum: adding a capability is a
 * reviewed contract change, and a descriptor naming something outside it fails
 * registration instead of silently registering an unroutable agent.
 */
export const CAPABILITY_TAXONOMY: readonly CapabilityDefinition[] =
  Object.freeze([
    /* project management */
    { id: "project", description: "Project-level planning and coordination." },
    {
      id: "project.management",
      description: "Interpret objectives, decompose work, track progress.",
    },
    {
      id: "project.coordination",
      description: "Sequence specialists and manage handoffs.",
    },
    /* architecture */
    {
      id: "architecture",
      description: "System structure and boundaries.",
    },
    {
      id: "architecture.system",
      description: "System analysis, boundaries, integration points.",
    },
    {
      id: "architecture.decision",
      description: "Author governed architecture decision records.",
    },
    {
      id: "architecture.technology_selection",
      description: "Requirements-driven technology evaluation and selection.",
    },
    /* software */
    { id: "software", description: "Software construction." },
    {
      id: "software.general",
      description: "Cross-stack implementation, integration and refactoring.",
    },
    {
      id: "software.frontend",
      description: "UI implementation, component design, accessibility.",
    },
    {
      id: "software.backend",
      description: "APIs, domain services, persistence, authorization.",
    },
    {
      id: "software.testing",
      description: "Test authoring and test execution.",
    },
    {
      id: "software.review",
      description: "Independent inspection of changes and evidence.",
    },
    {
      id: "software.security",
      description: "Security and compliance analysis.",
    },
    /* design */
    { id: "design", description: "Visual and interaction design." },
    {
      id: "design.ui",
      description: "Design systems, hierarchy, layout, component design.",
    },
    {
      id: "design.interaction",
      description: "Interaction and motion specification.",
    },
    /* integration */
    {
      id: "integration",
      description: "Connections to external systems.",
    },
    {
      id: "integration.github",
      description:
        "Governed source control: status, diff, branch, commit, push, PR.",
    },
    /* deployment */
    {
      id: "deployment",
      description: "Build, release and verify software artifacts.",
    },
    {
      id: "deployment.firebase",
      description: "Governed Firebase build, deploy and health verification.",
    },
    /* reserved for later specialists (declared, not yet staffed) */
    {
      id: "data",
      description: "Data engineering and analytics (future specialist).",
    },
    {
      id: "media.graphics",
      description: "3D and real-time graphics (future specialist).",
    },
    {
      id: "media.motion",
      description: "Motion and interaction engineering (future specialist).",
    },
    {
      id: "finance",
      description: "Finance and accounting work (future specialist).",
    },
    {
      id: "legal",
      description: "Legal and regulatory compliance (future specialist).",
    },
    {
      id: "research",
      description: "Research and knowledge synthesis (future specialist).",
    },
  ]);

const TAXONOMY_IDS = new Set(CAPABILITY_TAXONOMY.map((c) => c.id));

export function isKnownCapability(id: string): boolean {
  return TAXONOMY_IDS.has(id);
}

/**
 * Pre-taxonomy free-form labels already present on registered agent
 * definitions, mapped to their canonical hierarchical id. This is an explicit,
 * reviewed compatibility bridge — not a wildcard. A legacy label that is not
 * listed here is a validation error, never a pass.
 */
export const CAPABILITY_ALIASES: Readonly<Record<string, string>> =
  Object.freeze({
    // control plane
    control_plane_analysis: "research",
    software_analysis: "software.general",
    // V1 specialists, pre-taxonomy labels
    "project-management": "project.management",
    coordination: "project.coordination",
    architecture: "architecture.system",
    design: "design.ui",
    "tech-selection": "architecture.technology_selection",
    coding: "software.general",
    debugging: "software.general",
    frontend: "software.frontend",
    "ui-development": "software.frontend",
    backend: "software.backend",
    "api-development": "software.backend",
    "ui-design": "design.ui",
    "code-review": "software.review",
    testing: "software.testing",
    "security-audit": "software.security",
    git: "integration.github",
    "ci-cd": "deployment",
    firebase: "deployment.firebase",
  });

/**
 * Resolve any accepted capability label to its canonical id.
 * Returns `undefined` for anything the taxonomy does not know.
 */
export function canonicalizeCapability(raw: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (isKnownCapability(trimmed)) return trimmed;
  const aliased = CAPABILITY_ALIASES[trimmed];
  return aliased !== undefined && isKnownCapability(aliased)
    ? aliased
    : undefined;
}

/**
 * Canonicalize a list, de-duplicating while preserving first-seen order.
 * Throws on the first label the taxonomy does not know.
 */
export function canonicalizeCapabilities(
  raw: readonly string[],
  field = "capabilities",
): readonly string[] {
  const seen: string[] = [];
  for (const entry of raw) {
    const canonical = canonicalizeCapability(entry);
    if (canonical === undefined) {
      throw new ValidationError(
        `${field} contains unknown capability: ${JSON.stringify(entry)}`,
      );
    }
    if (!seen.includes(canonical)) seen.push(canonical);
  }
  return Object.freeze(seen);
}

/* ------------------------------------------------------------------ */
/* Satisfaction (least privilege)                                     */
/* ------------------------------------------------------------------ */

/**
 * Does `offered` cover `required`?
 *
 * Equality always satisfies. Beyond that, only a DESCENDANT satisfies an
 * ANCESTOR: `software.frontend` covers `software`, but `software` does not
 * cover `software.frontend`. A broad declaration is therefore never a licence
 * to do every kind of work in that namespace.
 */
export function capabilitySatisfies(
  offered: string,
  required: string,
): boolean {
  if (offered === required) return true;
  if (!isCapabilityId(offered) || !isCapabilityId(required)) return false;
  return required.startsWith(`${offered}.`);
}

/** The subset of `required` that `offered` covers. */
export function satisfiedCapabilities(
  offered: readonly string[],
  required: readonly string[],
): readonly string[] {
  return Object.freeze(
    required.filter((r) => offered.some((o) => capabilitySatisfies(o, r))),
  );
}

/** The subset of `required` that `offered` does NOT cover. */
export function missingCapabilities(
  offered: readonly string[],
  required: readonly string[],
): readonly string[] {
  return Object.freeze(
    required.filter((r) => !offered.some((o) => capabilitySatisfies(o, r))),
  );
}
