import type { ReactNode } from "react";
import { QueryProvider } from "./QueryProvider";
import { AuthProvider } from "../../auth/AuthProvider";
import { ThemeProvider } from "../../themes/ThemeProvider";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}