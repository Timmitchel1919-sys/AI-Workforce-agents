export declare function isSensitiveSegment(segment: string): boolean;
export declare function isSensitivePath(path: string): boolean;
/**
 * Normalize and validate a caller-supplied path as relative to the Money Mind
 * repository root. Throws `ValidationError` (never a raw filesystem error) on
 * anything unsafe: empty, absolute (POSIX or Windows drive-letter), containing
 * a `..` segment, a NUL byte, or a sensitive file/directory name.
 */
export declare function resolveSafeRelativePath(relPath: string): string;
/** Directory names never descended into by structure inspection. */
export declare const MONEY_MIND_IGNORED_DIRS: ReadonlySet<string>;
