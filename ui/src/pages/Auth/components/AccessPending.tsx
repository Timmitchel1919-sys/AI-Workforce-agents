import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import { authErrorKey } from "../../../auth/authErrors";
import { useI18n } from "../../../i18n";
import { maskEmail } from "../../../auth/passwordPolicy";
import { AuthCard } from "./AuthCard";
import { AuthAlert } from "./AuthFields";

/**
 * Shown to a signed-in user whose ID token carries no Control Plane role.
 * This is the existing architecture: roles are custom claims assigned
 * server-side, and the API denies every request until one exists.
 */
export function AccessPending({ next, justCreated }: { next: string; justCreated: boolean }) {
  const { user, refreshAccess, signOut } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    setMessage(null);
    try {
      const access = await refreshAccess();
      if (access === "granted") {
        navigate(next, { replace: true });
        return;
      }
      setMessage({ tone: "info", text: t("auth.pending.notYet") });
    } catch (error) {
      setMessage({ tone: "error", text: t(authErrorKey(error, "refresh")) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthCard
      eyebrow={justCreated ? t("auth.pending.created") : t("auth.pending.pending")}
      title={t("auth.pending.title")}
      description={t("auth.pending.signedInAs", { email: user?.email ? maskEmail(user.email) : t("auth.pending.yourAccount") })}
    >
      <div className="auth-pending">
        <span className="auth-pending__icon" aria-hidden="true">
          <Clock size={20} />
        </span>
        <p>{t("auth.pending.note")}</p>
      </div>

      {message ? <AuthAlert tone={message.tone}>{message.text}</AuthAlert> : null}

      <div className="auth-actions">
        <button
          type="button"
          className="lp-button lp-button--primary auth-submit"
          onClick={checkAgain}
          disabled={checking}
          aria-busy={checking}
        >
          <RefreshCw size={16} aria-hidden="true" className={checking ? "auth-spin" : undefined} />
          {checking ? t("auth.pending.checking") : t("auth.pending.checkAgain")}
        </button>
        <button type="button" className="lp-button lp-button--secondary auth-submit" onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden="true" />
          {t("shell.signOut")}
        </button>
      </div>
    </AuthCard>
  );
}

export default AccessPending;
