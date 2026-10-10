import { useCallback, useState } from "react";
import { CloudOff, LogOut, RefreshCw } from "lucide-react";
import { Spinner } from "../components/ui";
import { useI18n } from "../i18n";
import { maskEmail } from "./passwordPolicy";
import { useAuth } from "./useAuth";

/**
 * Shown when the Control Plane cannot be reached while a protected route is
 * already on screen.
 *
 * A network failure is not a lost session, so this deliberately stays on the
 * current route instead of sending the user back to the sign-in gateway. It is
 * also deliberately not a blank spinner: the state is stated, and both
 * "check again" and "sign out" stay reachable, so recovery never depends on
 * Firebase happening to refresh the token.
 *
 * Access is UX only — the Control Plane re-verifies the ID token on every
 * request, so nothing here grants or widens access.
 */
export function AccessUnavailable() {
  const { user, refreshAccess, signOut } = useAuth();
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      await refreshAccess();
    } catch {
      // A failed re-check leaves the access state untouched, so the screen
      // simply stays put — no separate error copy is needed here.
    } finally {
      setChecking(false);
    }
  }, [refreshAccess]);

  const email = user?.email ? maskEmail(user.email) : t("auth.pending.yourAccount");

  return (
    <div className="auth-guard-blocked">
      <section className="auth-guard-blocked__card" aria-labelledby="auth-guard-blocked-title">
        <span className="auth-guard-blocked__icon" aria-hidden="true">
          <CloudOff size={20} />
        </span>
        <p className="auth-guard-blocked__eyebrow">{t("auth.pending.pending")}</p>
        <h1 id="auth-guard-blocked-title" className="auth-guard-blocked__title">
          {t("auth.pending.unavailableTitle")}
        </h1>
        <p className="auth-guard-blocked__body">{t("auth.pending.unavailableBody", { email })}</p>
        <div className="auth-guard-blocked__actions">
          <button
            type="button"
            className="auth-guard-blocked__button auth-guard-blocked__button--primary"
            onClick={() => void check()}
            disabled={checking}
            aria-busy={checking}
          >
            {checking ? <Spinner /> : <RefreshCw size={16} aria-hidden="true" />}
            {checking ? t("auth.pending.checking") : t("auth.pending.checkAgain")}
          </button>
          <button type="button" className="auth-guard-blocked__button" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />
            {t("shell.signOut")}
          </button>
        </div>
      </section>
    </div>
  );
}

export default AccessUnavailable;