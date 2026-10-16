import { useState } from "react";
import { ShieldOff } from "lucide-react";
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useAuth } from "../../auth/useAuth";
import { useI18n } from "../../i18n";

type Phase = { kind: "idle" } | { kind: "working" } | { kind: "done"; partial: boolean } | { kind: "error"; message: string };

/**
 * UI Layer 7 lost-device response. One server-enforced action: every session
 * of this account (on every device, including this one) is refused from its
 * next request, and identity-provider refresh tokens are revoked. The copy is
 * explicit that a web app cannot remotely wipe a phone.
 */
export function SessionSecurityCard() {
  const { t } = useI18n();
  const { accessToken, signOut } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const revokeAll = async () => {
    if (!window.confirm(t("sessionSecurity.confirm"))) return;
    setPhase({ kind: "working" });
    try {
      const result = await apiRequest<{ sessionsValidAfter: number; refreshTokensRevoked: boolean }>(
        "/api/me/sessions/revoke",
        { method: "POST", accessToken },
      );
      setPhase({ kind: "done", partial: !result.refreshTokensRevoked });
      // This device's token is now refused too: sign out locally as well.
      window.setTimeout(() => void signOut(), result.refreshTokensRevoked ? 1500 : 6000);
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof ApiError ? (error.reason ?? error.message) : String(error) });
    }
  };

  return (
    <section id="sessions" className="settings-section profile-card" aria-labelledby="sessions-title">
      <h2 id="sessions-title" className="settings-section__title">{t("sessionSecurity.title")}</h2>
      <p>{t("sessionSecurity.description")}</p>
      <button type="button" className="ui-button danger" onClick={() => void revokeAll()} disabled={phase.kind === "working" || phase.kind === "done"}>
        <ShieldOff size={16} aria-hidden /> {t("sessionSecurity.action")}
      </button>
      {phase.kind === "working" ? <p role="status">{t("sessionSecurity.working")}</p> : null}
      {phase.kind === "done" ? (
        <p role="status">{phase.partial ? t("sessionSecurity.partial") : t("sessionSecurity.done")}</p>
      ) : null}
      {phase.kind === "error" ? <p role="alert">{t("sessionSecurity.failed", { error: phase.message })}</p> : null}
      <p className="profile-hint">{t("sessionSecurity.limits")}</p>
    </section>
  );
}
