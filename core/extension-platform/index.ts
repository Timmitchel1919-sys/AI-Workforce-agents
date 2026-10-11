/**
 * Extension Platform composition. `ExtensionSystem` wires the registry to the Layer 7 ledger and
 * trust catalogue and seeds the built-in skills, agents and workflow templates (registered and
 * validated, but NOT enabled: the owner decides what is active).
 */
import type {
  ExtensionAuditEvent,
  ExtensionRecord,
} from "../../contracts/extension-platform.js";
import type { Repository } from "../../contracts/persistence.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { SecuritySystem } from "../security-governance/index.js";
import { BUILTIN_EXTENSIONS } from "./builtins.js";
import { SkillContextSource } from "./context-source.js";
import {
  ExtensionPlatform,
  type ExternalDependencyResolver,
  type ExtensionRepos,
} from "./registry.js";

// semver helpers stay module-internal (names collide with the contracts barrel).
export * from "./manifest.js";
export * from "./registry.js";
export * from "./builtins.js";
export * from "./context-source.js";

export const PLATFORM_VERSION = "1.0.0";

export function inMemoryExtensionRepos(): ExtensionRepos {
  return {
    extensions:
      new InMemoryRepository<ExtensionRecord>() as Repository<ExtensionRecord>,
    audit:
      new InMemoryRepository<ExtensionAuditEvent>() as Repository<ExtensionAuditEvent>,
  };
}

export class ExtensionSystem {
  readonly platform: ExtensionPlatform;
  readonly skillContext: SkillContextSource;

  constructor(o: {
    repos: ExtensionRepos;
    security: SecuritySystem;
    external?: ExternalDependencyResolver;
    now?: () => number;
    platformVersion?: string;
  }) {
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
  installBuiltins(by: string): number {
    let added = 0;
    for (const manifest of BUILTIN_EXTENSIONS) {
      if (this.platform.record(manifest.id)) continue;
      this.platform.register(manifest, by, "builtin");
      this.platform.test(manifest.id, by);
      this.platform.review(manifest.id, by);
      added++;
    }
    return added;
  }
}
