import { useMemo, type ReactNode } from "react";
import { createApiClient } from "../../api";
import { useAuth } from "../../auth/useAuth";
import { appConfig } from "../../lib/config";
import { ApiContext } from "./apiContext";

/**
 * Builds the single `ApiClient` for the app, bound to the current auth session's
 * `getIdToken` (fresh token on every request — never cached in storage). Must
 * render inside `<AuthProvider>`.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const { getIdToken } = useAuth();

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: appConfig.apiBaseUrl,
        timeoutMs: appConfig.apiTimeoutMs,
        getToken: getIdToken,
        logger: appConfig.isDev
          ? (entry) =>
              // Safe: method / path / status / duration / correlation id only.
              console.debug(
                `[api] ${entry.method} ${entry.path} → ${entry.status ?? entry.errorKind} ` +
                  `${entry.durationMs}ms cid=${entry.correlationId}`,
              )
          : undefined,
      }),
    [getIdToken],
  );

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
