import type { IncomingMessage } from "node:http";
import { MethodNotAllowedError, UnsupportedMediaTypeError, PayloadTooLargeError, ValidationError } from "./errors.js";

export function enforceMethod(req: IncomingMessage, allowedMethods: readonly string[]): void {
  const method = req.method ?? "GET";
  if (!allowedMethods.includes(method)) {
    throw new MethodNotAllowedError(`Method ${method} Not Allowed`);
  }
}

export function enforceContentType(req: IncomingMessage, expectedType = "application/json"): void {
  // If it's a mutation and has a body, it usually requires a content-type
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") {
    return; // No body expected
  }
  
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes(expectedType)) {
    throw new UnsupportedMediaTypeError(`Expected Content-Type: ${expectedType}`);
  }
}

export async function readJsonBodyStrict(
  req: IncomingMessage,
  maxBytes: number
): Promise<Record<string, unknown>> {
  enforceContentType(req, "application/json");

  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (!preParsed || typeof preParsed !== "object" || Array.isArray(preParsed)) {
      throw new ValidationError("request body must be a JSON object");
    }
    // We can't strictly enforce maxBytes on preParsed since it's already parsed,
    // but the environment (e.g. Firebase Functions) usually handles limit.
    return preParsed as Record<string, unknown>;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) {
      throw new PayloadTooLargeError("request body too large");
    }
    chunks.push(buf);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("request body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
