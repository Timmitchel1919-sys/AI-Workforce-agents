/**
 * Redaction utility for strings, command lines, log metadata, and stack traces.
 * Redacts secret values, API keys, Bearer tokens, private keys, and sensitive payload keys.
 */
export declare function redactSecrets(text: string, knownSecrets?: readonly string[]): {
    text: string;
    redactions: number;
};
export declare function redactObject<T>(obj: T, knownSecrets?: readonly string[]): T;
