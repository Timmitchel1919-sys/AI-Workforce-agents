import { MethodNotAllowedError, UnsupportedMediaTypeError, PayloadTooLargeError, ValidationError } from "./errors.js";
export function enforceMethod(req, allowedMethods) {
    const method = req.method ?? "GET";
    if (!allowedMethods.includes(method)) {
        throw new MethodNotAllowedError(`Method ${method} Not Allowed`);
    }
}
export function enforceContentType(req, expectedType = "application/json") {
    // If it's a mutation and has a body, it usually requires a content-type
    if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") {
        return; // No body expected
    }
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes(expectedType)) {
        throw new UnsupportedMediaTypeError(`Expected Content-Type: ${expectedType}`);
    }
}
export async function readJsonBodyStrict(req, maxBytes) {
    enforceContentType(req, "application/json");
    const preParsed = req.body;
    if (preParsed !== undefined) {
        if (!preParsed || typeof preParsed !== "object" || Array.isArray(preParsed)) {
            throw new ValidationError("request body must be a JSON object");
        }
        // We can't strictly enforce maxBytes on preParsed since it's already parsed,
        // but the environment (e.g. Firebase Functions) usually handles limit.
        return preParsed;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = chunk;
        total += buf.length;
        if (total > maxBytes) {
            throw new PayloadTooLargeError("request body too large");
        }
        chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text === "")
        return {};
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new ValidationError("request body is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ValidationError("request body must be a JSON object");
    }
    return parsed;
}
