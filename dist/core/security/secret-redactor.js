/**
 * Redaction utility for strings, command lines, log metadata, and stack traces.
 * Redacts secret values, API keys, Bearer tokens, private keys, and sensitive payload keys.
 */
const SENSITIVE_KEY_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /api[-_]?key/i,
    /auth/i,
    /private[-_]?key/i,
    /credential/i,
    /session/i,
];
const KNOWN_VALUE_PATTERNS = [
    /Bearer\s+[A-Za-z0-9_\-\.\~=+/]+/gi,
    /sk-ant-[A-Za-z0-9_\-]{20,}/g,
    /sk-[A-Za-z0-9_\-]{20,}/g,
    /ghp_[A-Za-z0-9]{36}/g,
    /github_pat_[A-Za-z0-9_\-]{30,}/g,
    /AIzaSy[A-Za-z0-9_\-]{33}/g,
    /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
];
export function redactSecrets(text, knownSecrets = []) {
    if (!text)
        return { text, redactions: 0 };
    let redactions = 0;
    let result = text;
    // 1. Redact known explicit secret values
    for (const secret of knownSecrets) {
        if (secret && secret.trim().length >= 4) {
            const parts = result.split(secret);
            if (parts.length > 1) {
                redactions += parts.length - 1;
                result = parts.join("[REDACTED_SECRET]");
            }
        }
    }
    // 2. Redact known pattern signatures
    for (const pattern of KNOWN_VALUE_PATTERNS) {
        const matches = result.match(pattern);
        if (matches) {
            redactions += matches.length;
            result = result.replace(pattern, "[REDACTED_CREDENTIAL]");
        }
    }
    return { text: result, redactions };
}
export function redactObject(obj, knownSecrets = []) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj === "string") {
        return redactSecrets(obj, knownSecrets).text;
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => redactObject(item, knownSecrets));
    }
    if (typeof obj === "object") {
        const copy = {};
        for (const [key, value] of Object.entries(obj)) {
            if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
                copy[key] = "[REDACTED]";
            }
            else {
                copy[key] = redactObject(value, knownSecrets);
            }
        }
        return copy;
    }
    return obj;
}
