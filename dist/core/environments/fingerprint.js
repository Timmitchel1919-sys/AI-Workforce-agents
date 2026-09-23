const OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
export function fnv1aHex(input) {
    let hash = OFFSET_BASIS >>> 0;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
export function hostFingerprint(input) {
    return fnv1aHex(`host|${input.hostId}|${input.os.os}|${input.os.architecture}`);
}
/** Stable identity of one installed environment on one host. */
export function environmentFingerprint(hostId, environmentType, version, installation) {
    return fnv1aHex(`env|${hostId}|${environmentType}|${version ?? ""}|${installation ?? ""}`);
}
export function instanceIdForFingerprint(fingerprint) {
    return `instance_${fingerprint}`;
}
/** Convenience: the fingerprint/id a detected environment will be registered as. */
export function fingerprintForInstance(input) {
    return environmentFingerprint(input.hostId, input.environmentType, input.version, input.installation);
}
/** Copy a fingerprint cross-check: two instances that describe the same thing match. */
export function sameFingerprint(a, b) {
    return a.fingerprint !== "" && a.fingerprint === b.fingerprint;
}
