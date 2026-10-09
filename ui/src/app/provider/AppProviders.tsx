import type { ReactNode } from "react";
import { QueryProvider } from "./QueryProvider";
import { AuthProvider } from "../../auth/AuthProvider";
import { ThemeProvider } from "../../themes/ThemeProvider";
import { I18nProvider } from "../../i18n";
import { NotificationProvider } from "../../notifications";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <NotificationProvider>
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </NotificationProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}