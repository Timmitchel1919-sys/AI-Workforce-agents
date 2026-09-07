/**
 * The narrow, read-mostly boundary between the Money Mind adapter and an
 * actual (or fixture) Money Mind checkout. This is the ONLY surface the
 * adapter is allowed to depend on — it owns no filesystem or process-spawning
 * code itself. Two implementations exist:
 *
 *   - `InMemoryMoneyMindRepo` (money-mind-fixture-repo.ts): deterministic,
 *     synthetic fixture data. Used by every test and the demonstration
 *     workflow. Never touches disk.
 *   - `NodeMoneyMindRepo` (money-mind-fs-repo.ts): the only module in this
 *     repository that imports `node:fs` or `node:child_process` for Money
 *     Mind. Used only at real deployment wiring time, and only when
 *     `MONEY_MIND_REPO_PATH` is configured.
 *
 * All Money-Mind-specific domain knowledge (which files matter, how to read
 * status) lives in `MoneyMindProjectAdapter`, not here — this port answers
 * only "does this path exist", "what's in it", and "run this exact script".
 */
import type { MoneyMindScript } from "../../../contracts/index.js";

export interface MoneyMindRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface MoneyMindRepoPort {
  /** Whether `relPath` (already validated by `resolveSafeRelativePath`) exists. */
  exists(relPath: string): Promise<boolean>;

  /** Read a text file's full content. Throws if it does not exist. */
  readTextFile(relPath: string): Promise<string>;

  /** List the immediate children of `relPath` (`""` = repository root). */
  listDirectory(
    relPath: string,
  ): Promise<readonly { name: string; type: "file" | "dir" }[]>;

  /** Whether the repository's own `package.json` declares this npm script. */
  hasScript(script: MoneyMindScript): Promise<boolean>;

  /** Run `npm run <script>`. Caller has already confirmed `hasScript`. */
  runScript(
    script: MoneyMindScript,
    timeoutMs: number,
  ): Promise<MoneyMindRunResult>;
}
