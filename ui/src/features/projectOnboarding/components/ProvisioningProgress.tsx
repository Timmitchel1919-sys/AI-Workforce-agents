import { Link } from "react-router-dom";
import { Button } from "../../../components/ui";
import type { OnboardingSession, StepStatus } from "../types";
import { useT } from "../lib/useT";
import { Notice, Tag, type Tone } from "./common";

const STEP_TONE: Record<StepStatus, Tone> = {
  pending: "neutral",
  running: "running",
  complete: "success",
  failed: "danger",
  skipped: "neutral",
  requirement_pending: "warning",
};

interface Props {
  session: OnboardingSession;
  pending: boolean;
  onResume: () => void;
  onRevalidate: () => void;
}

/** Renders REAL step records from the server; nothing here is timed or simulated. */
export function ProvisioningProgress({ session, pending, onResume, onRevalidate }: Props) {
  const { tt } = useT();
  const steps = session.provisioning?.steps ?? [];
  const projectPath = `/projects/${encodeURIComponent(session.projectId)}`;
  const status = session.status;
  const currentIndex = steps.findIndex((s) => s.status === "running" || s.status === "failed");
  const working = status === "provisioning" || status === "validating";

  return (
    <div className="ob-stack" data-testid="provisioning-progress">
      <div role="status" aria-live="polite" className="ob-live">
        {tt(`progress.status.${status}`)}
        {working ? ` ${tt("progress.refreshing")}` : ""}
      </div>

      {status === "ready" ? (
        <Notice>
          <strong>{tt("progress.readyTitle")}</strong> {tt("progress.readyBody")}
          <div className="ob-actions">
            <Link className="ob-link-button ob-link-button--primary" to={projectPath}>{tt("progress.openProject")}</Link>
            <Link className="ob-link-button" to={`/graph?project=${encodeURIComponent(session.projectId)}`}>{tt("progress.openGraph")}</Link>
          </div>
        </Notice>
      ) : null}

      {status === "provisioning_failed" ? (
        <div role="alert" className="ob-alert ob-alert--danger">
          <strong>{tt("progress.failedTitle")}</strong>
          <p>{session.failure?.message ?? tt("progress.failedUnknown")}</p>
          <div className="ob-actions">
            <Button type="button" variant="primary" loading={pending} disabled={pending} onClick={onResume}>
              {tt("progress.resume")}
            </Button>
          </div>
        </div>
      ) : null}

      {status === "validation_failed" ? (
        <div role="alert" className="ob-alert ob-alert--danger">
          <strong>{tt("progress.validationFailedTitle")}</strong>
          {session.validation && session.validation.blocking.length > 0 ? (
            <ul className="ob-list" data-testid="validation-blocking">
              {session.validation.blocking.map((b) => <li key={b} className="ob-list__item">{b}</li>)}
            </ul>
          ) : (
            <p>{session.failure?.message ?? tt("progress.failedUnknown")}</p>
          )}
          <div className="ob-actions">
            <Button type="button" variant="primary" loading={pending} disabled={pending} onClick={onRevalidate}>
              {tt("progress.revalidate")}
            </Button>
          </div>
        </div>
      ) : null}

      {steps.length === 0 ? (
        <p className="ob-muted">{tt("progress.noSteps")}</p>
      ) : (
        <ol className="ob-progress" aria-label={tt("progress.listLabel")}>
          {steps.map((s, i) => (
            <li key={s.key} className={`ob-progress__item ob-progress__item--${s.status}`} aria-current={i === currentIndex ? "step" : undefined}>
              <div className="ob-card__head">
                <span className="ob-strong">{s.title}</span>
                <Tag tone={STEP_TONE[s.status]}>{tt(`progress.step.${s.status}`)}</Tag>
                {s.external ? <Tag tone="info">{tt("progress.external")}</Tag> : null}
              </div>
              {s.detail ? <p className="ob-muted">{s.detail}</p> : null}
              {s.error ? <p className="ob-error-text">{s.error}</p> : null}
            </li>
          ))}
        </ol>
      )}

      {session.validation ? (
        <section className="ob-section" aria-labelledby="ob-validation-heading">
          <h3 id="ob-validation-heading" className="ob-section__title">{tt("progress.validation")}</h3>
          <ul className="ob-list">
            {session.validation.checks.map((c) => (
              <li key={c.key} className="ob-list__item">
                <Tag tone={c.passed ? "success" : c.mandatory ? "danger" : "warning"}>{c.passed ? tt("progress.passed") : tt("progress.notPassed")}</Tag>{" "}
                <span className="ob-strong">{c.title}</span>
                <div className="ob-muted">{c.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
