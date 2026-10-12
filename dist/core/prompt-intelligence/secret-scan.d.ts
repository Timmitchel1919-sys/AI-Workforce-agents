/** True when the text appears to contain a credential value. */
export declare function containsSecret(text: string): boolean;
/** Bounded, control-character-free text suitable for a context fragment. */
export declare function sanitizeText(text: string, max: number): string;
/**
 * Replace every credential-looking value with a mask. Used for anything a
 * process prints or a diff contains before it is stored or shown: terminal
 * output, logs, audit data and diffs never carry a secret.
 */
export declare function maskSecrets(text: string): string;
