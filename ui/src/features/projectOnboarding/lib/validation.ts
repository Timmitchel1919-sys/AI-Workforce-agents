import { PROJECT_CODE_PATTERN, type OnboardingIdentity, type OnboardingKind, type OnboardingSource } from "../types";

/** Suggest an upper-case project code (2-12 chars, letter first) from a name. */
export function suggestCode(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let code = words[0] ?? "";
  if (words.length > 1) {
    code = words.map((w) => w[0]).join("");
    if (code.length < 3) code = words.join("").slice(0, 6);
  }
  code = code.replace(/^[0-9]+/, "").slice(0, 12);
  return code;
}

export function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export type ValidationKey =
  | "nameRequired"
  | "codeInvalid"
  | "repoRequired"
  | "repoNotHttps"
  | "repoCredentials"
  | "repoInvalid"
  | "repoExtras"
  | "specRequired"
  | "objectiveRequired";

/**
 * A repository URL must be credential-free https. A token or password in the
 * URL is rejected client-side and never sent anywhere.
 */
export function validateRepositoryUrl(raw: string): ValidationKey | undefined {
  const value = raw.trim();
  if (!value) return "repoRequired";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "repoInvalid";
  }
  if (url.username || url.password) return "repoCredentials";
  if (url.protocol !== "https:") return "repoNotHttps";
  if (!url.hostname || url.hostname === "localhost" || !url.hostname.includes(".")) return "repoInvalid";
  if (url.search || url.hash) return "repoExtras";
  if (url.pathname.replace(/\//g, "").length === 0) return "repoInvalid";
  return undefined;
}

export type FieldErrors = Partial<Record<"name" | "code" | "repositoryUrl" | "specification" | "objective", ValidationKey>>;

export function validateIdentitySource(
  kind: OnboardingKind,
  identity: Partial<OnboardingIdentity>,
  source: Partial<OnboardingSource>,
  options: { requireObjective?: boolean } = {},
): FieldErrors {
  const errors: FieldErrors = {};
  if (!identity.name || identity.name.trim().length < 2) errors.name = "nameRequired";
  if (!identity.code || !PROJECT_CODE_PATTERN.test(identity.code)) errors.code = "codeInvalid";
  if (options.requireObjective && !identity.objective?.trim()) errors.objective = "objectiveRequired";
  if (kind === "import_existing") {
    const repoError = validateRepositoryUrl(source.repositoryUrl ?? "");
    if (repoError) errors.repositoryUrl = repoError;
  } else if (kind === "create_new") {
    if (!source.specification || source.specification.trim().length < 10) errors.specification = "specRequired";
  }
  return errors;
}
