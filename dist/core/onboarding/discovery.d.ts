/**
 * Project discovery (PROJECT-2) — pure, read-only, evidence-based.
 *
 * `analyzeRepositoryEvidence` turns already-fetched repository evidence (a
 * file listing plus the contents of a small allow-list of manifests) into a
 * `ProjectAnalysis`. It performs no I/O and can never modify source. Nothing
 * is inferred from a project name: every finding carries the evidence that
 * supports it, and anything that cannot be determined is reported in
 * `unavailable` instead of being guessed.
 *
 * Secret safety: environment variables are captured as NAMES only. A value
 * read from an example env file is dropped at parse time.
 */
import type { EnvVarClass, ProjectAnalysis, SourceProvider } from "../../contracts/onboarding.js";
export interface RepositoryEvidence {
    provider: SourceProvider;
    url: string;
    visibility: "public" | "private" | "unknown";
    defaultBranch: string;
    branch: string;
    commit?: string;
    /** Repository-relative file paths (forward slashes). */
    paths: readonly string[];
    /** True when the provider truncated the listing. */
    truncated: boolean;
    /** Contents of the allow-listed files that were actually fetched. */
    files: Readonly<Record<string, string>>;
}
/** Files whose CONTENT the reader may fetch. Everything else is path-only. */
export declare const EVIDENCE_CONTENT_ALLOWLIST: readonly RegExp[];
export declare function isContentAllowlisted(path: string): boolean;
/** Classify an environment variable NAME. The value is never seen here. */
export declare function classifyEnvVar(name: string): EnvVarClass;
/** NAMES from `.env.example`-style text. Values and comments are discarded. */
export declare function parseEnvVarNames(text: string): string[];
export declare function analyzeRepositoryEvidence(evidence: RepositoryEvidence, generatedAt: string): ProjectAnalysis;
export declare function analyzeSpecification(specification: string, generatedAt: string): ProjectAnalysis;
