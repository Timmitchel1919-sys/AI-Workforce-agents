/**
 * Trusted executable resolution — COMPOSITION TIME ONLY.
 *
 * Resolves a well-known tool name (e.g. `git`) to an absolute path from the
 * server's own PATH when the application is composed. Never called with
 * agent/model/request input; the resulting path is bound to an executableId
 * in the trusted sandbox configuration.
 */
import { statSync } from "node:fs";
import path from "node:path";

const ALLOWED_NAMES = new Set(["git", "node"]);

export function resolveTrustedExecutable(name: string): string | undefined {
  if (!ALLOWED_NAMES.has(name)) {
    throw new Error(`${name} is not a trusted executable name`);
  }
  const candidates = process.platform === "win32" ? [`${name}.exe`] : [name];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const file of candidates) {
      const full = path.join(dir, file);
      try {
        if (statSync(full).isFile()) return full;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}
