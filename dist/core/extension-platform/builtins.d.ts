/**
 * Built-in skill, agent and workflow definitions. They are ordinary declarative manifests
 * registered through the same validation, test and review as anything else; they are
 * REGISTERED but not enabled, so the owner chooses what is active.
 */
import type { ExtensionManifest } from "../../contracts/extension-platform.js";
export declare const BUILTIN_SKILLS: ExtensionManifest[];
export declare const BUILTIN_AGENTS: ExtensionManifest[];
/** The standard development loop, as a reusable template. */
export declare const BUILTIN_WORKFLOWS: ExtensionManifest[];
export declare const BUILTIN_EXTENSIONS: ExtensionManifest[];
