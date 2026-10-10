export declare const CAPABILITY_SEGMENT_PATTERN: RegExp;
export declare const MAX_CAPABILITY_SEGMENTS = 3;
export declare const MAX_CAPABILITY_ID_LENGTH = 96;
/** Split a capability id into its segments, or `undefined` if malformed. */
export declare function parseCapabilityId(id: string): readonly string[] | undefined;
export declare function isCapabilityId(id: string): boolean;
/** The parent of a capability, or `undefined` at the root. */
export declare function parentCapability(id: string): string | undefined;
/** The root namespace of a capability (`software.frontend` -> `software`). */
export declare function rootCapability(id: string): string | undefined;
export interface CapabilityDefinition {
    readonly id: string;
    readonly description: string;
}
/**
 * The V1 taxonomy. It is a registry, not an enum: adding a capability is a
 * reviewed contract change, and a descriptor naming something outside it fails
 * registration instead of silently registering an unroutable agent.
 */
export declare const CAPABILITY_TAXONOMY: readonly CapabilityDefinition[];
export declare function isKnownCapability(id: string): boolean;
/**
 * Pre-taxonomy free-form labels already present on registered agent
 * definitions, mapped to their canonical hierarchical id. This is an explicit,
 * reviewed compatibility bridge — not a wildcard. A legacy label that is not
 * listed here is a validation error, never a pass.
 */
export declare const CAPABILITY_ALIASES: Readonly<Record<string, string>>;
/**
 * Resolve any accepted capability label to its canonical id.
 * Returns `undefined` for anything the taxonomy does not know.
 */
export declare function canonicalizeCapability(raw: string): string | undefined;
/**
 * Canonicalize a list, de-duplicating while preserving first-seen order.
 * Throws on the first label the taxonomy does not know.
 */
export declare function canonicalizeCapabilities(raw: readonly string[], field?: string): readonly string[];
/**
 * Does `offered` cover `required`?
 *
 * Equality always satisfies. Beyond that, only a DESCENDANT satisfies an
 * ANCESTOR: `software.frontend` covers `software`, but `software` does not
 * cover `software.frontend`. A broad declaration is therefore never a licence
 * to do every kind of work in that namespace.
 */
export declare function capabilitySatisfies(offered: string, required: string): boolean;
/** The subset of `required` that `offered` covers. */
export declare function satisfiedCapabilities(offered: readonly string[], required: readonly string[]): readonly string[];
/** The subset of `required` that `offered` does NOT cover. */
export declare function missingCapabilities(offered: readonly string[], required: readonly string[]): readonly string[];
