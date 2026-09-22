export declare const REDACTED = "[redacted]";
/** Redact + bound an arbitrary structured object (audit `data`, metadata, ...). */
export declare function redact(data: Record<string, unknown>): Record<string, unknown>;
/** Redact a single string that may carry a secret (e.g. an error message). */
export declare function redactText(text: string): string;
/** The (non-sensitive) top-level key names of an object, for a "shape" view. */
export declare function keyNames(value: unknown): string[];
