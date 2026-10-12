/**
 * Manifest validation. Extensions are declarative: this is also the "sandbox" — no executable
 * content, no secrets, no unknown permission scopes, bounded size. Pure functions.
 */
import { type ExtensionManifest, type ValidationFinding } from "../../contracts/extension-platform.js";
export declare function validateManifest(input: unknown): {
    manifest?: ExtensionManifest;
    findings: ValidationFinding[];
};
