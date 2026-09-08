import type { ReactNode } from "react";
import { QueryProvider } from "./QueryProvider";
import { AuthProvider } from "../../auth/AuthProvider";
import { ApiProvider } from "./ApiProvider";
import { ThemeProvider } from "../../theme";
import { ToastProvider } from "../../components/ui";

/**
 * Application-wide providers, composed. Modular by design — each provider is a
 * single responsibility.
 *
 *   ThemeProvider → QueryProvider → AuthProvider → ApiProvider → ToastProvider
 *     → (Router + app)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <ApiProvider>
            <ToastProvider>{children}</ToastProvider>
          </ApiProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
