/**
 * Firebase App Check verification abstraction.
 *
 * App Check answers "Is this request coming from an attested app?"
 * It is NOT authentication (that is Firebase Auth) and NOT
 * authorization (that is OperatorAccount + capabilities + project
 * scope). The modes are server-authoritative; client input must
 * never select the mode.
 */

export const APP_CHECK_MODES = ["disabled", "monitor", "enforced"] as const;
export type AppCheckMode = (typeof APP_CHECK_MODES)[number];

export interface AppAttestationResult {
  valid: boolean;
  appId?: string;
  error?: string;
}

export interface AppAttestationVerifier {
  verify(token: string | undefined): Promise<AppAttestationResult>;
}

/**
 * Default verifier used when no production verifier is wired. The
 * `monitor` and `disabled` modes make it a no-op; `enforced` treats
 * the verifier as UNAVAILABLE and the API fails closed on privileged
 * routes.
 */
export class DefaultAppAttestationVerifier implements AppAttestationVerifier {
  async verify(_token: string | undefined): Promise<AppAttestationResult> {
    return { valid: false, error: "verifier_unavailable" };
  }
}

/**
 * Observable App Check status attached to `SecureRequestContext`.
 * Never contains the token itself.
 */
export interface AppCheckStatus {
  mode: AppCheckMode;
  outcome: "not_required" | "valid" | "missing" | "invalid" | "unavailable";
  appId?: string;
  error?: string;
}

/**
 * Decide the App Check outcome for a request given the mode, token,
 * verifier and whether the route requires App Check. Pure function:
 * no side effects, no logging.
 */
export async function evaluateAppCheck(input: {
  mode: AppCheckMode;
  token: string | undefined;
  verifier: AppAttestationVerifier | undefined;
  routeRequiresAppCheck: boolean;
}): Promise<AppCheckStatus> {
  if (input.mode === "disabled" || !input.routeRequiresAppCheck) {
    return { mode: input.mode, outcome: "not_required" };
  }
  if (!input.verifier) {
    return { mode: input.mode, outcome: "unavailable" };
  }
  if (!input.token) {
    return { mode: input.mode, outcome: "missing" };
  }
  const result = await input.verifier.verify(input.token);
  return {
    mode: input.mode,
    outcome: result.valid ? "valid" : "invalid",
    appId: result.appId,
    error: result.error,
  };
}

/**
 * Decide whether an App Check status should BLOCK the request.
 *
 * - `disabled`: never blocks.
 * - `monitor`: never blocks; the caller still records the event.
 * - `enforced`: blocks `missing`, `invalid`, `unavailable`.
 */
export function appCheckBlocks(status: AppCheckStatus): boolean {
  if (status.mode !== "enforced") return false;
  return (
    status.outcome === "missing" ||
    status.outcome === "invalid" ||
    status.outcome === "unavailable"
  );
}

/**
 * Resolve App Check mode from an environment variable, falling back
 * to `disabled`. The mode is server-authoritative — never read from
 * the request body or a client-controlled header.
 */
export function resolveAppCheckMode(
  env: Record<string, string | undefined> = process.env,
): AppCheckMode {
  const raw = (env.APP_CHECK_MODE ?? "").toLowerCase().trim();
  if (raw === "enforced" || raw === "monitor" || raw === "disabled") return raw;
  return "disabled";
}

/**
 * Header name the Firebase client SDK uses when it attaches an App
 * Check token. Extraction is centralized so no route handler reads
 * the header itself.
 */
export const APP_CHECK_HEADER = "x-firebase-appcheck";
