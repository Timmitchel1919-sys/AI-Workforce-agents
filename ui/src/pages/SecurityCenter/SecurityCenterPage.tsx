import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useAuth } from "../../auth/useAuth";
import { SessionSecurityCard } from "../Profile/SessionSecurityCard";
import { formatDateTime, useI18n } from "../../i18n";
import "../Operations/OperationsPage.css";

interface LockdownState {
  active: boolean;
  reason?: string;
  activatedAt?: string;
  activatedBy?: string;
  revision: number;
}

/**
 * Security & Trust Center (UI Layer 11). Every control here is enforced by
 * the Control Plane; the page only reports and requests.
 */
export default function SecurityCenterPage() {
  const { t } = useI18n();
  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("securityCenter.title")} description={t("securityCenter.description")} />
      <div className="ops-bento">
        <LockdownCard />
        <section className="ops-card">
          <h2>{t("securityCenter.agents.title")}</h2>
          <p className="ops-muted">{t("securityCenter.agents.body")}</p>
          <Link to="/intelligence">{t("securityCenter.agents.open")}</Link>
        </section>
        <section className="ops-card">
          <h2>{t("securityCenter.events.title")}</h2>
          <p className="ops-muted">{t("securityCenter.events.body")}</p>
          <Link to="/operations">{t("securityCenter.events.open")}</Link>
        </section>
        <section className="ops-card">
          <h2>{t("securityCenter.integrations.title")}</h2>
          <p className="ops-muted">{t("securityCenter.integrations.body")}</p>
          <ul className="ops-list">
            <li><Link to="/intelligence">{t("securityCenter.integrations.models")}</Link></li>
            <li>{t("securityCenter.integrations.github")}</li>
          </ul>
        </section>
        <section className="ops-card">
          <h2>{t("securityCenter.recovery.title")}</h2>
          <p className="ops-muted">{t("securityCenter.recovery.body")}</p>
        </section>
        <section className="ops-card">
          <h2>{t("securityCenter.devices.title")}</h2>
          <p className="ops-muted">{t("securityCenter.devices.body")}</p>
        </section>
      </div>
      <SessionSecurityCard />
    </PageContainer>
  );
}

function LockdownCard() {
  const { t, language } = useI18n();
  const { accessToken, accessDetails } = useAuth();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["security", "lockdown", accessToken ?? "anonymous"],
    queryFn: () => apiRequest<LockdownState>("/api/platform/lockdown", { accessToken }),
    retry: false,
  });
  const isAdmin = accessDetails.role === "admin";

  const change = async (path: string, confirmText: string, body?: unknown) => {
    if (!window.confirm(confirmText)) return;
    setError(null);
    try {
      await apiRequest<LockdownState>(path, {
        method: "POST",
        accessToken,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      await client.invalidateQueries({ queryKey: ["security", "lockdown"] });
    } catch (e) {
      setError(e instanceof ApiError ? (e.reason ?? e.message) : String(e));
    }
  };

  const s = status.data;
  return (
    <section className={`ops-card ops-card--wide${s?.active ? " sec-lockdown--on" : ""}`} aria-labelledby="sec-lockdown">
      <h2 id="sec-lockdown">
        <ShieldAlert size={16} aria-hidden /> {t("securityCenter.lockdown.title")}
      </h2>
      <p className="ops-muted">{t("securityCenter.lockdown.intro")}</p>
      {status.error ? <p role="alert">{t("securityCenter.lockdown.unknown")}</p> : null}
      {s ? (
        <p role="status" className={s.active ? "sec-alert" : undefined}>
          {s.active
            ? t("securityCenter.lockdown.active", {
                time: formatDateTime(s.activatedAt, language) ?? "?",
                actor: s.activatedBy ?? "?",
                reason: s.reason ?? "",
              })
            : t("securityCenter.lockdown.inactive")}
        </p>
      ) : null}
      {isAdmin && s ? (
        s.active ? (
          <button type="button" className="ui-button primary" onClick={() => void change("/api/platform/lockdown/lift", t("securityCenter.lockdown.confirmLift"))}>
            {t("securityCenter.lockdown.lift")}
          </button>
        ) : (
          <div className="ops-filters">
            <label className="ops-field">
              <span>{t("securityCenter.lockdown.reason")}</span>
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="ui-button danger"
              disabled={!reason.trim()}
              onClick={() => void change("/api/platform/lockdown", t("securityCenter.lockdown.confirmActivate"), { reason })}
            >
              {t("securityCenter.lockdown.activate")}
            </button>
          </div>
        )
      ) : null}
      <p className="ops-muted">{t("securityCenter.lockdown.stepUp")}</p>
      {error ? <p role="alert">{t("securityCenter.lockdown.failed", { error })}</p> : null}
    </section>
  );
}
