import { useState } from "react";
import {
  useEmergencyState,
  useExecuteEmergencyLock,
  useReleaseEmergencyLock,
  useTrustApprovals,
  useTrustEvents,
  useTrustOverview,
  type OverallTrustStatus,
  type TrustEvent,
  type UnifiedApprovalItem,
} from "../../features/trustOversight";
import "./TrustCenterPage.css";

const STATUS_LABEL: Record<OverallTrustStatus, string> = {
  verified: "Normal",
  attention: "Caution",
  restricted: "Restricted",
  emergency_lockdown: "Lockdown",
};

const STATUS_VARIANT: Record<OverallTrustStatus, string> = {
  verified: "ok",
  attention: "warn",
  restricted: "warn",
  emergency_lockdown: "critical",
};

export const TrustCenterPage: React.FC = () => {
  const overview = useTrustOverview();
  const emergency = useEmergencyState();
  const approvals = useTrustApprovals({ status: "pending" });
  const events = useTrustEvents({ limit: 25 });
  const lock = useExecuteEmergencyLock();
  const release = useReleaseEmergencyLock();

  const [lockReason, setLockReason] = useState("");
  const [confirmLockdown, setConfirmLockdown] = useState(false);

  const summary = overview.data;
  const emergencyState = emergency.data;
  const pending = approvals.data?.approvals ?? [];
  const feed = events.data?.events ?? [];

  const onLockdown = async () => {
    const reason = lockReason.trim();
    if (!reason || !confirmLockdown) return;
    await lock.mutateAsync({ action: "lockdown_automation", reason });
    setLockReason("");
    setConfirmLockdown(false);
  };

  return (
    <div className="trust-center">
      <header className="trust-center__header">
        <div>
          <h1>Trust &amp; Human Oversight</h1>
          <p>
            Real-time governance signal from the Control Plane. Every decision
            here is authorized, risk-evaluated and audited server-side.
          </p>
        </div>
        {summary && (
          <div
            className={`trust-status trust-status--${STATUS_VARIANT[summary.overallTrustStatus]}`}
            aria-live="polite"
          >
            <span className="trust-status__dot" aria-hidden="true" />
            <span className="trust-status__label">
              {STATUS_LABEL[summary.overallTrustStatus]}
            </span>
          </div>
        )}
      </header>

      {overview.isError && (
        <div className="trust-center__error" role="alert">
          Unable to load Trust Center. The Control Plane may be unavailable or
          your session may lack read access.
        </div>
      )}

      <section className="trust-grid" aria-label="Trust posture">
        <TrustCard
          label="Pending approvals"
          value={summary?.pendingApprovalsCount}
          sub={
            summary && summary.criticalPendingApprovalsCount > 0
              ? `${summary.criticalPendingApprovalsCount} critical`
              : undefined
          }
          variant={
            summary && summary.criticalPendingApprovalsCount > 0
              ? "warn"
              : "normal"
          }
        />
        <TrustCard
          label="Blocked (24h)"
          value={summary?.blockedViolations24h}
          sub="Policy violations"
          variant={
            summary && summary.blockedViolations24h > 0 ? "warn" : "normal"
          }
        />
        <TrustCard
          label="Emergency locks"
          value={summary?.activeEmergencyLocksCount}
          sub={summary?.automationLockedDown ? "Automation locked down" : undefined}
          variant={
            summary &&
            (summary.automationLockedDown ||
              summary.activeEmergencyLocksCount > 0)
              ? "critical"
              : "normal"
          }
        />
        <TrustCard
          label="Agents"
          value={summary?.entities.agents.total}
          sub={
            summary
              ? `${summary.entities.agents.trusted} trusted · ${summary.entities.agents.untrusted} untrusted`
              : undefined
          }
        />
        <TrustCard
          label="Tools"
          value={summary?.entities.tools.total}
          sub={
            summary
              ? `${summary.entities.tools.trusted} trusted · ${summary.entities.tools.restricted} restricted`
              : undefined
          }
        />
        <TrustCard
          label="Models"
          value={summary?.entities.models.total}
          sub={
            summary ? `${summary.entities.models.compliant} compliant` : undefined
          }
        />
      </section>

      <div className="trust-two-col">
        <section className="trust-panel">
          <header className="trust-panel__header">
            <h2>Pending approvals</h2>
            <span className="trust-panel__count">{pending.length}</span>
          </header>
          {approvals.isLoading ? (
            <p className="trust-panel__empty">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="trust-panel__empty">
              No high-risk actions are waiting on your decision.
            </p>
          ) : (
            <ul className="trust-approvals">
              {pending.slice(0, 10).map((a) => (
                <ApprovalRow key={a.approvalId} approval={a} />
              ))}
            </ul>
          )}
        </section>

        <section className="trust-panel">
          <header className="trust-panel__header">
            <h2>Recent governance events</h2>
          </header>
          {events.isLoading ? (
            <p className="trust-panel__empty">Loading…</p>
          ) : feed.length === 0 ? (
            <p className="trust-panel__empty">No governance events recorded yet.</p>
          ) : (
            <ul className="trust-events">
              {feed.map((e) => (
                <EventRow key={e.eventId} event={e} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="trust-panel trust-emergency">
        <header className="trust-panel__header">
          <h2>Emergency controls</h2>
          {emergencyState?.automationLockedDown && (
            <span className="trust-badge trust-badge--critical">
              Automation locked down
            </span>
          )}
        </header>
        <p className="trust-emergency__description">
          Stop new high-risk and critical autonomous operations. Running work
          is drained safely — nothing is deleted. All emergency actions are
          audited and require a written reason.
        </p>

        <div className="trust-emergency__action">
          <label htmlFor="trust-lockdown-reason" className="trust-emergency__label">
            Reason (required)
          </label>
          <textarea
            id="trust-lockdown-reason"
            className="trust-emergency__input"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
            placeholder="e.g. Investigating anomalous agent spend"
            rows={2}
            disabled={emergencyState?.automationLockedDown || lock.isPending}
          />
          <label className="trust-emergency__confirm">
            <input
              type="checkbox"
              checked={confirmLockdown}
              onChange={(e) => setConfirmLockdown(e.target.checked)}
              disabled={emergencyState?.automationLockedDown || lock.isPending}
            />
            I understand this stops all new autonomous operations.
          </label>
          <button
            type="button"
            className="trust-btn trust-btn--critical"
            onClick={onLockdown}
            disabled={
              !lockReason.trim() ||
              !confirmLockdown ||
              lock.isPending ||
              emergencyState?.automationLockedDown
            }
          >
            {lock.isPending ? "Locking down…" : "Engage lockdown"}
          </button>
        </div>

        {emergencyState && emergencyState.activeLocks.length > 0 && (
          <ul className="trust-locks">
            {emergencyState.activeLocks.map((l) => (
              <li key={l.id} className="trust-locks__row">
                <div>
                  <div className="trust-locks__action">{l.action}</div>
                  <div className="trust-locks__meta">
                    Engaged by {l.lockedBy} ·{" "}
                    {new Date(l.lockedAt).toLocaleString()}
                  </div>
                  <div className="trust-locks__reason">{l.reason}</div>
                </div>
                <button
                  type="button"
                  className="trust-btn"
                  onClick={() => release.mutate(l.id)}
                  disabled={release.isPending}
                >
                  Release
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

interface TrustCardProps {
  label: string;
  value: number | undefined;
  sub?: string;
  variant?: "normal" | "warn" | "critical";
}

function TrustCard({ label, value, sub, variant = "normal" }: TrustCardProps) {
  return (
    <article className={`trust-card trust-card--${variant}`}>
      <div className="trust-card__label">{label}</div>
      <div className="trust-card__value">{value ?? "—"}</div>
      {sub && <div className="trust-card__sub">{sub}</div>}
    </article>
  );
}

function ApprovalRow({ approval }: { approval: UnifiedApprovalItem }) {
  return (
    <li className="trust-approvals__row">
      <div className="trust-approvals__action">{approval.action}</div>
      <div className="trust-approvals__meta">
        <span
          className={`trust-chip trust-chip--${approval.riskLevel}`}
          aria-label={`Risk ${approval.riskLevel}`}
        >
          {approval.riskLevel}
        </span>
        <span className="trust-approvals__requester">
          {approval.requester.actorType === "agent"
            ? `agent: ${approval.requester.agentId ?? approval.requester.actorId}`
            : approval.requester.actorId}
        </span>
        {approval.projectId && (
          <span className="trust-approvals__project">{approval.projectId}</span>
        )}
      </div>
      <div className="trust-approvals__reason">{approval.reason}</div>
    </li>
  );
}

function EventRow({ event }: { event: TrustEvent }) {
  return (
    <li className="trust-events__row">
      <div className="trust-events__head">
        <span
          className={`trust-chip trust-chip--${event.severity}`}
          aria-label={`Severity ${event.severity}`}
        >
          {event.severity}
        </span>
        <span className="trust-events__type">{event.type}</span>
        <span className="trust-events__time">
          {new Date(event.timestamp).toLocaleString()}
        </span>
      </div>
      <div className="trust-events__summary">{event.summary}</div>
      <div className="trust-events__meta">
        {event.actor} → {event.target}
        {event.projectId && ` · ${event.projectId}`}
      </div>
    </li>
  );
}

export default TrustCenterPage;
