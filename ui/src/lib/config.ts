/**
 * Typed runtime configuration. The ONE place `import.meta.env` is read for
 * app config. Nothing here is a secret — `VITE_*` values are bundled into the
 * browser.
 */
export type AppMode = "development" | "test" | "production";

export interface AppConfig {
  /** Control Plane API base, e.g. `/api` (dev, proxied) or an absolute https URL. */
  apiBaseUrl: string;
  /** Default per-request timeout (ms). */
  apiTimeoutMs: number;
  mode: AppMode;
  isDev: boolean;
  isProd: boolean;
  isTest: boolean;
}

function readMode(): AppMode {
  const raw = import.meta.env.MODE;
  if (raw === "production" || raw === "test") return raw;
  return "development";
}

function readConfig(): AppConfig {
  const mode = readMode();
  const isProd = import.meta.env.PROD === true;
  const isTest = mode === "test";
  const rawUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  // Dev/test proxy `/api` to a local Control Plane; prod must be explicit.
  const apiBaseUrl = rawUrl || "/api";
  const rawTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);
  const apiTimeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 20_000;

  return {
    apiBaseUrl,
    apiTimeoutMs,
    mode,
    isDev: !isProd && !isTest,
    isProd,
    isTest,
  };
}

export const appConfig: AppConfig = readConfig();

/**
 * Fail fast at startup on a missing/obviously-wrong API base in production.
 * Called from `main.tsx`.
 */
export function assertConfig(config: AppConfig = appConfig): void {
  if (config.isProd) {
    const url = config.apiBaseUrl;
    if (!url || url === "/api") {
      throw new Error(
        "VITE_API_BASE_URL must be set to an absolute Control Plane API URL for a production build.",
      );
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(
        `VITE_API_BASE_URL must be an absolute http(s) URL in production (got: ${url}).`,
      );
    }
  }
}
