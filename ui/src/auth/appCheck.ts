import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken,
  type AppCheck,
} from "firebase/app-check";
import type { FirebaseApp } from "firebase/app";

let appCheckInstance: AppCheck | null = null;

/**
 * Returns whether App Check has the required configuration in the client environment.
 */
export function isAppCheckConfigured(): boolean {
  const enabled = import.meta.env.VITE_APP_CHECK_ENABLED !== "false";
  const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
  return Boolean(enabled && siteKey);
}

export interface AppCheckInitOptions {
  siteKey?: string;
  isTokenAutoRefreshEnabled?: boolean;
}

/**
 * Initializes Firebase App Check with ReCaptchaEnterpriseProvider on the existing FirebaseApp instance.
 *
 * In production:
 * - Requires a valid reCAPTCHA Enterprise site key (VITE_FIREBASE_APP_CHECK_SITE_KEY).
 * - Never hard-codes debug tokens.
 *
 * In development (import.meta.env.DEV only):
 * - If debug mode is explicitly set via self.FIREBASE_APPCHECK_DEBUG_TOKEN, it is allowed for local emulator/dev testing.
 */
export function initAppCheck(
  app: FirebaseApp,
  options: AppCheckInitOptions = {},
): AppCheck | null {
  if (appCheckInstance) {
    return appCheckInstance;
  }

  const enabled = import.meta.env.VITE_APP_CHECK_ENABLED !== "false";
  if (!enabled) {
    return null;
  }

  const siteKey =
    options.siteKey ?? import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
  const isAutoRefresh = options.isTokenAutoRefreshEnabled ?? true;

  // In local development only, allow debug token if explicitly in DEV mode
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const debugToken = import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN;
    if (debugToken && typeof debugToken === "string") {
      // Set debug token strictly in DEV mode; never in production
      (window as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }
  }

  if (!siteKey) {
    // In explicit DEV mode without a site key, do not initialize fake app check
    return null;
  }

  try {
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: isAutoRefresh,
    });
    return appCheckInstance;
  } catch (error) {
    // Deterministic failure if initialization fails (e.g. invalid site key format)
    console.warn("Failed to initialize Firebase App Check:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

/**
 * Retrieve the current App Check token, refreshing if requested.
 * Safe helper: never logs or leaks token values.
 */
export async function getAppCheckToken(
  forceRefresh = false,
): Promise<string | null> {
  if (!appCheckInstance) {
    return null;
  }
  try {
    const result = await getToken(appCheckInstance, forceRefresh);
    return result?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Testing helper: reset singleton instance for unit tests.
 */
export function _resetAppCheckForTesting(): void {
  appCheckInstance = null;
}
