import type { PasswordPolicy } from "./auth.types";
import type { MessageKey, MessageParams } from "../i18n/messages";

/** Firebase Auth always rejects passwords shorter than 6 characters. */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 6,
  requireLowercase: false,
  requireUppercase: false,
  requireNumber: false,
  requireSymbol: false,
  source: "default",
};

export interface PasswordRequirement {
  id: string;
  labelKey: MessageKey;
  params?: MessageParams;
  met: boolean;
}

/** Only the rules the effective policy actually enforces. Evaluated locally. */
export function passwordRequirements(
  password: string,
  policy: PasswordPolicy,
): PasswordRequirement[] {
  const requirements: PasswordRequirement[] = [
    {
      id: "length",
      labelKey: "auth.rules.length",
      params: { count: policy.minLength },
      met: password.length >= policy.minLength,
    },
  ];
  if (policy.maxLength) {
    requirements.push({
      id: "max-length",
      labelKey: "auth.rules.maxLength",
      params: { count: policy.maxLength },
      met: password.length <= policy.maxLength,
    });
  }
  if (policy.requireLowercase) {
    requirements.push({ id: "lower", labelKey: "auth.rules.lower", met: /[a-z]/.test(password) });
  }
  if (policy.requireUppercase) {
    requirements.push({ id: "upper", labelKey: "auth.rules.upper", met: /[A-Z]/.test(password) });
  }
  if (policy.requireNumber) {
    requirements.push({ id: "number", labelKey: "auth.rules.number", met: /\d/.test(password) });
  }
  if (policy.requireSymbol) {
    requirements.push({
      id: "symbol",
      labelKey: "auth.rules.symbol",
      met: /[^A-Za-z0-9]/.test(password),
    });
  }
  return requirements;
}

export type PasswordStrength = "weak" | "fair" | "strong";

/**
 * Deterministic, local guidance only (length + character variety). It never
 * leaves the browser and is not a substitute for the enforced policy.
 */
export function passwordStrength(password: string, policy: PasswordPolicy): PasswordStrength {
  if (password.length < policy.minLength) return "weak";
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = variety;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (score >= 5) return "strong";
  if (score >= 3) return "fair";
  return "weak";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** "tim@example.com" → "t••@example.com" — enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(local.length - 1, 4)))}@${domain}`;
}
