import { useMemo, type ReactNode } from "react";
import { createApiClient } from "../../api";
import { useAuth } from "../../auth/useAuth";
import { ApiContext } from "./apiContext";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

/**
 * Builds the single `ApiClient` for the app, bound to the current auth session's
 * `getIdToken`. Must render inside `<AuthProvider>`.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const { getIdToken } = useAuth();

  const client = useMemo(
    () => createApiClient({ baseUrl: API_BASE_URL, getToken: getIdToken }),
    [getIdToken],
  );

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
