/**
 * Tiny, pure, forgiving parsers for the two structured files the adapter
 * reads for `READ_STATUS` / `READ_CONFIGURATION`. Deliberately not a general
 * YAML parser (no new dependency) — it recognizes exactly the
 * `chapter-registry`-style shape this project's status doc uses and ignores
 * everything else.
 */
import type { MoneyMindChapterStatus } from "../../../contracts/index.js";
export declare function parseMoneyMindChapterRegistry(yaml: string): MoneyMindChapterStatus[];
/** Extract `NAME=value` keys from an env-file-style document (e.g. `.env.example`). */
export declare function parseMoneyMindFeatureFlagNames(text: string): string[];
