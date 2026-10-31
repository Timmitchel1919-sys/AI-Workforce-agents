export interface FirebaseWebConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}
export type AuthRuntimeMode = "firebase" | "development-demo" | "configuration-error";

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Performs conservative structural checks without logging or returning any
 * configuration value. Firebase remains responsible for validating the
 * identifiers when the app is initialized.
 */
export function hasCompleteFirebaseConfig(config: FirebaseWebConfig): boolean {
  return (
    hasValue(config.apiKey) &&
    hasValue(config.authDomain) &&
    hasValue(config.projectId) &&
    hasValue(config.appId)
  );
}

export function resolveAuthRuntimeMode(input: {
  config: FirebaseWebConfig;
  production: boolean;
  development: boolean;
  allowDevelopmentDemo: boolean;
}): AuthRuntimeMode {
  if (hasCompleteFirebaseConfig(input.config)) return "firebase";

  // Demo authentication is deliberately impossible in production and must be
  // explicitly opted into in a Vite development build.
  if (!input.production && input.development && input.allowDevelopmentDemo) {
    return "development-demo";
  }

  return "configuration-error";
}
