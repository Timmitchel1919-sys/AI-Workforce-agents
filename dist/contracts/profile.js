/**
 * Operator profile contracts — the signed-in operator's own profile photo.
 *
 * Kept apart from the `OperatorAccount` (authorization) record on purpose:
 * that record is read on every request, a photo is not. Only the Control
 * Plane writes profiles; the browser never touches Firestore. A photo is a
 * small, server-validated image data URL — never an arbitrary file or URL.
 */
import { ValidationError } from "./index.js";
/** Decoded image size limit (the UI downsizes to 256×256 before upload). */
export const MAX_AVATAR_BYTES = 256 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
function decodeBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function matchesType(type, bytes) {
    const at = (i) => bytes[i] ?? -1;
    if (type === "png") {
        return at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47;
    }
    if (type === "jpeg") {
        return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
    }
    // webp: "RIFF" .... "WEBP"
    return (at(0) === 0x52 &&
        at(1) === 0x49 &&
        at(2) === 0x46 &&
        at(3) === 0x46 &&
        at(8) === 0x57 &&
        at(9) === 0x45 &&
        at(10) === 0x42 &&
        at(11) === 0x50);
}
/**
 * Accept only a PNG/JPEG/WebP data URL whose bytes really are that image
 * type and whose decoded size is within `MAX_AVATAR_BYTES`. Returns the
 * value unchanged; throws `ValidationError` otherwise.
 */
export function validateAvatarDataUrl(value) {
    if (typeof value !== "string") {
        throw new ValidationError("dataUrl must be an image data URL");
    }
    if (value.length > Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64) {
        throw new ValidationError("profile photo is too large");
    }
    const match = DATA_URL.exec(value);
    if (!match) {
        throw new ValidationError("profile photo must be a PNG, JPEG or WebP data URL");
    }
    let bytes;
    try {
        bytes = decodeBase64(match[2]);
    }
    catch {
        throw new ValidationError("profile photo is not valid base64");
    }
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
        throw new ValidationError("profile photo is too large");
    }
    if (!matchesType(match[1], bytes)) {
        throw new ValidationError("profile photo content does not match its type");
    }
    return value;
}
