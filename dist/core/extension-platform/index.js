import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { BUILTIN_EXTENSIONS } from "./builtins.js";
import { SkillContextSource } from "./context-source.js";
import { ExtensionPlatform, } from "./registry.js";
// semver helpers stay module-internal (names collide with the contracts barrel).
export * from "./manifest.js";
export * from "./registry.js";
export * from "./builtins.js";
export * from "./context-source.js";
export const PLATFORM_VERSION = "1.0.0";
export function inMemoryExtensionRepos() {
    return {
        extensions: new InMemoryRepository(),
        audit: new InMemoryRepository(),
    };
}
export class ExtensionSystem {
    platform;
    skillContext;
    constructor(o) {
        const now = o.now ?? Date.now;
        this.platform = new ExtensionPlatform(o.repos, {
            ledger: o.security.ledger,
            trust: o.security.trust,
            ...(o.external ? { external: o.external } : {}),
            platformVersion: o.platformVersion ?? PLATFORM_VERSION,
            clock: () => new Date(now()).toISOString(),
        });
        this.skillContext = new SkillContextSource(this.platform);
        this.installBuiltins("system");
    }
    /** Idempotent: registers, tests and reviews each built-in once. */
    installBuiltins(by) {
        let added = 0;
        for (const manifest of BUILTIN_EXTENSIONS) {
            if (this.platform.record(manifest.id))
                continue;
            this.platform.register(manifest, by, "builtin");
            this.platform.test(manifest.id, by);
            this.platform.review(manifest.id, by);
            added++;
        }
        return added;
    }
}
