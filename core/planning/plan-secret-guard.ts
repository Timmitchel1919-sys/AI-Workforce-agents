/**
 * Belt-and-braces guard: an ExecutionPlan may REFERENCE credentials
 * (`CredentialReference`) but must never CONTAIN one. Run before every write.
 */
import { ValidationError } from "../../contracts/index.js";

const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)/;
const SECRET_KEY =
  /^(api[_-]?key|apikey|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|secret[_-]?value|token)$/i;

/** Throws when any key or string value in the structure looks secret. */
export function assertNoSecrets(value: unknown, path = "plan"): void {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) {
      throw new ValidationError(`${path} must not contain a secret value`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSecrets(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        throw new ValidationError(`${path}.${key} is a credential field`);
      }
      assertNoSecrets(entry, `${path}.${key}`);
    }
  }
}
