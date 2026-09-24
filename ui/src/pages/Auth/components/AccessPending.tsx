import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Clock, CloudOff, LogOut, PauseCircle, RefreshCw, ShieldX } from "lucide-react";
import type { AccessState } from "../../../auth/auth.types";
import { useAuth } from "../../../auth/useAuth";
import { authErrorKey } from "../../../auth/authErrors";
import { useI18n, type MessageKey } from "../../../i18n";
import { maskEmail } from "../../../auth/passwordPolicy";
import { AuthCard } from "./AuthCard";
import { AuthAlert } from "./AuthFields";

type BlockedState = Exclude<AccessState, "none" | "granted">;

const COPY: Record<BlockedState, { eyebrow: MessageKey; title: MessageKey; body: MessageKey }> = {
  pending: { eyebrow: "auth.pending.pending", title: "auth.pending.title", body: "auth.pending.signedInAs" },
  rejected: { eyebrow: "auth.pending.deniedEyebrow", title: "auth.pending.rejectedTitle", body: "auth.pending.rejectedBody" },
  suspended: { eyebrow: "auth.pending.deniedEyebrow", title: "auth.pending.suspendedTitle", body: "auth.pending.suspendedBody" },
  revoked: { eyebrow: "auth.pending.deniedEyebrow", title: "auth.pending.revokedTitle", body: "auth.pending.revokedBody" },
  unavailable: { eyebrow: "auth.pending.pending", title: "auth.pending.unavailableTitle", body: "auth.pending.unavailableBody" },
};

const ICONS = {
  pending: Clock,
  rejected: ShieldX,
  suspended: PauseCircle,
  revoked: Ban,
  unavailable: CloudOff,
} as const;

/** While pending, re-check at a gentle pace — never aggressively, and not forever. */
const AUTO_CHECK_MS = 60_000;
const AUTO_CHECK_MAX = 20;

/**
 * Shown to a signed-in user without Control Center access. The state comes
 * from the Control Plane (`GET /api/me/access`); "Check access again" refreshes
 * the ID token and asks the backend again — it never grants access itself.
 */
export function AccessPending({ next, justCreated }: { next: string; justCreated: boolean }) {
  const { user, access, refreshAccess, signOut } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const autoChecks = useRef(0);

  const state: BlockedState = access === "none" || access === "granted" ? "pending" : access;
  const copy = COPY[state];
  const Icon = ICONS[state];

  const check = useCallback(
    async (manual: boolean) => {
      if (manual) {
        setChecking(true);
        setMessage(null);
      }
      try {
        const result = await refreshAccess();
        if (result === "granted") {
          navigate(next, { replace: true });
          return;
        }
        if (manual) {
          setMessage({
            tone: result === "unavailable" ? "error" : "info",
            text: t(result === "pending" ? "auth.pending.notYet" : "auth.pending.unchanged"),
          });
        }
      } catch (error) {
        if (manual) setMessage({ tone: "error", text: t(authErrorKey(error, "refresh")) });
      } finally {
        if (manual) setChecking(false);
      }
    },
    [navigate, next, refreshAccess, t],
  );

  useEffect(() => {
    if (state !== "pending") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (autoChecks.current >= AUTO_CHECK_MAX) {
        window.clearInterval(timer);
        return;
      }
      autoChecks.current += 1;
      void check(false);
    }, AUTO_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [state, check]);

  const email = user?.email ? maskEmail(user.email) : t("auth.pending.yourAccount");

  return (
    <AuthCard
      eyebrow={state === "pending" && justCreated ? t("auth.pending.created") : t(copy.eyebrow)}
      title={t(copy.title)}
      description={t(copy.body, { email })}
    >
      <div className={`auth-pending auth-pending--${state}`} data-access-state={state}>
        <span className="auth-pending__icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <p>{t(state === "pending" ? "auth.pending.note" : "auth.pending.contactAdmin")}</p>
      </div>

      {message ? <AuthAlert tone={message.tone}>{message.text}</AuthAlert> : null}

      <div className="auth-actions">
        <button
          type="button"
          className="lp-button lp-button--primary auth-submit"
          onClick={() => void check(true)}
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
