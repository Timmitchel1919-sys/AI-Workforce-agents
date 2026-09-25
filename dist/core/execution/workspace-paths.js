/**
 * Workspace path safety lives in `contracts/workspace-paths.ts` so trusted
 * filesystem adapters (which depend only on contracts) share the exact same
 * validation. Re-exported here for existing core imports.
 */
export { assertRealPathWithinRoot, isWithinScope, resolveWorkspacePath, } from "../../contracts/index.js";
