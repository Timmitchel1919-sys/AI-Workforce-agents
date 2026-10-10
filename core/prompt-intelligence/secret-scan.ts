/**
 * Secret scanning for the Prompt Intelligence layer (Phase 3).
 *
 * Context fragments, user requests and generated prompts must never carry a
 * credential. This extends the platform's single known-secret pattern
 * (`KNOWN_SECRET_VALUE_PATTERN`) with the shapes that appear in pasted
 * configuration and requests. It detects; it does not try to repair — a
 * fragment containing a secret is dropped whole, a request containing one is
 * refused.
 */
import { KNOWN_SECRET_VALUE_PATTERN } from "../../contracts/index.js";

const EXTRA_PATTERNS: readonly RegExp[] = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /\bgh[opsu]_[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@/i,
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"',;]{6,}/i,
];

/** True when the text appears to contain a credential value. */
export function containsSecret(text: string): boolean {
  if (KNOWN_SECRET_VALUE_PATTERN.test(text)) return true;
  return EXTRA_PATTERNS.some((pattern) => pattern.test(text));
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Bounded, control-character-free text suitable for a context fragment. */
export function sanitizeText(text: string, max: number): string {
  const cleaned = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

const MASK = "[masked]";

function globalOf(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

const MASK_PATTERNS: readonly RegExp[] = [KNOWN_SECRET_VALUE_PATTERN, ...EXTRA_PATTERNS].map(globalOf);

/**
 * Replace every credential-looking value with a mask. Used for anything a
 * process prints or a diff contains before it is stored or shown: terminal
 * output, logs, audit data and diffs never carry a secret.
 */
export function maskSecrets(text: string): string {
  let out = text;
  for (const pattern of MASK_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (match) => {
      // Keep the key of "key=value" so the line stays readable.
      const eq = /^([A-Za-z_][\w.-]*\s*[:=]\s*)/.exec(match);
      return eq ? `${eq[1]}${MASK}` : MASK;
    });
  }
  return out;
}
