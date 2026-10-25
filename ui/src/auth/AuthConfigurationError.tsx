import { ShieldAlert } from "lucide-react";
import { useI18n } from "../i18n";

/** Safe fail-closed state. It never includes environment variable values. */
export function AuthConfigurationError() {
  const { t } = useI18n();

  return (
    <main className="auth-guard-state" role="alert" aria-live="assertive">
      <ShieldAlert size={32} aria-hidden="true" />
      <h1>{t("auth.notConfiguredTitle")}</h1>
      <p>{t("auth.notConfigured")}</p>
    </main>
  );
}
