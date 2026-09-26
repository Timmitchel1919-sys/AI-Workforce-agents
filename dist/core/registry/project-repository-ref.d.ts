import type { ProjectRepositoryRef } from "../../contracts/index.js";
/**
 * Validates a project repository reference. Only an https URL with NO
 * embedded credentials, query or fragment is accepted, so a token can never
 * ride along in project metadata. Returns `undefined` when invalid.
 */
export declare function parseProjectRepositoryRef(input: unknown): ProjectRepositoryRef | undefined;
/** Case-insensitive identity of a repository, ignoring a trailing `.git` or `/`. */
export declare function repositoryKey(ref: ProjectRepositoryRef): string;
