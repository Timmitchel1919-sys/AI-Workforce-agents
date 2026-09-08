import type { ReactNode } from "react";
import { QueryProvider } from "./QueryProvider";
import { AuthProvider } from "../../auth/AuthProvider";
import { ApiProvider } from "./ApiProvider";

/**
 * Application-wide providers, composed. Modular by design — each provider is a
 * single responsibility.
 *
 *   QueryProvider → AuthProvider → ApiProvider → (Router + app)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ApiProvider>{children}</ApiProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
