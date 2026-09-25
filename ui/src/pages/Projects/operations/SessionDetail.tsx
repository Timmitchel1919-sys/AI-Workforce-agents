/**
 * EO-4.7 session detail — authoritative inspection + human oversight.
 *
 * AGENT ≠ MODEL ≠ ENVIRONMENT ≠ RUNNER are separate sections. The timeline
 * lists only recorded events. Controls exist only for real typed commands
 * (cancel; administrators: emergency stop of THIS session), need a reason,
 * are confirmed in a dialog, and always re-read the backend afterwards.
 * Button visibility is UX only — the Control Plane authorizes every command.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Octagon, StopCircle } from "lucide-react";
import { Button, Dialog } from "../../../components/ui";
import { useAuth } from "../../../auth/useAuth";
import {
  OperationsError,
  TERMINAL_SESSION_STATUSES,
  redactForDisplay,
  useExecutionSession,
  useProjectReleases,
  useStopExecution,
  type SessionDetail as Detail,
} from "../../../features/operations";
import { formatDateTime, useI18n, type MessageKey } from "../../../i18n";
import { StateGate, StatusText } from "./OperationsTab";
import { changeLabel, sessionStatusLabel, shortId, stageStatusLabel } from "./labels";
import { derivePipeline, type StepState } from "./pipeline";

const STEP_LABEL: Record<string, MessageKey> = {
  plan: "operations.pipePlan",
  prepare: "operations.pipePrepare",
  execute: "operations.pipeExecute",
  verify: "operations.pipeVerify",
  review: "operations.pipeReview",
  approve: "operations.pipeApprove",
  commit: "operations.pipeCommit",
  push: "operations.pipePush",
  deploy: "operations.pipeDeploy",
  verifyRelease: "operations.pipeVerifyRelease",
};
const STEP_STATE: Record<StepState, MessageKey> = {
  completed: "operations.stepCompleted",
  current: "operations.stepCurrent",
  pending: "operations.stepPending",
  blocked: "operations.stepBlocked",
  failed: "operations.stepFailed",
  not_applicable: "operations.stepNotApplicable",
};

export function SessionDetail({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const { t } = useI18n();
  const [timelineLimit, setTimelineLimit] = useState(50);
  const detail = useExecutionSession(projectId, sessionId, timelineLimit);
  const releases = useProjectReleases(projectId);

  return (
    <div className="ops">
      <p>
        <Link to={`/projects/${encodeURIComponent(projectId)}/operations`}>{t("operations.allSessions")}</Link>
      </p>
      <StateGate state={detail.state} onRetry={detail.refetch}>
        {detail.data ? (
          <DetailBody
            data={detail.data}
            releases={releases.data}
            projectId={projectId}
            onMoreTimeline={() => setTimelineLimit((n) => Math.min(n + 50, 200))}
          />
        ) : null}
      </StateGate>
    </div>
  );
}

function DetailBody({
  data,
  releases,
  projectId,
  onMoreTimeline,
}: {
  data: Detail;
  releases: Parameters<typeof derivePipeline>[1];
  projectId: string;
  onMoreTimeline: () => void;
}) {
  const { t, language } = useI18n();
  const s = data.session;
  const when = (v?: string) => formatDateTime(v, language) ?? "—";
  const steps = derivePipeline(data, releases);
  const latest = [...data.verifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <>
      <section className="plan-section" aria-labelledby="ops-session-title">
        <h3 id="ops-session-title">
          {t("operations.sessionTitle", { id: shortId(s.sessionId, 18) })}{" "}
          <StatusText value={s.status} label={sessionStatusLabel(t, s.status)} />
        </h3>
        <dl className="plan-metrics">
          <Metric label={t("operations.plan")} value={<code>{s.plan.planId}</code>} />
          <Metric label={t("operations.revision")} value={`v${s.plan.version}`} />
          <Metric label={t("operations.stage")} value={<code>{s.stageId}</code>} />
          <Metric label={t("operations.operation")} value={<code>{s.operationId}</code>} />
          <Metric label={t("operations.risk")} value={s.risk} />
          <Metric label={t("operations.policy")} value={`${s.policy.policyId} v${s.policy.version}`} />
          <Metric label={t("operations.created")} value={when(s.createdAt)} />
          <Metric label={t("operations.started")} value={when(s.startedAt)} />
          <Metric label={t("operations.ended")} value={when(s.endedAt)} />
          <Metric label={t("operations.attempts")} value={s.attempts} />
        </dl>
      </section>

      <section className="plan-section" aria-labelledby="ops-pipeline">
        <h3 id="ops-pipeline">{t("operations.pipelineTitle")}</h3>
        <ol className="ops-pipeline">
          {steps.map((step) => (
            <li key={step.key} className={`ops-step ops-step--${step.state}`}>
              <span className="ops-step-name">{t(STEP_LABEL[step.key]!)}</span>
              <span className="ops-step-state">{t(STEP_STATE[step.state])}</span>
            </li>
          ))}
        </ol>
      </section>

      <Controls data={data} projectId={projectId} />

      <section className="plan-section" aria-labelledby="ops-reasons">
        <h3 id="ops-reasons">{t("operations.reasonsSection")}</h3>
        {s.reasons.length === 0 ? (
          <p className="plan-muted">{t("operations.noReasons")}</p>
        ) : (
          <ul className="plan-rows">
            {s.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`} className="plan-row">
                <code>{r.code}</code> <span className="plan-muted">{redactForDisplay(r.detail)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="ops-columns">
        <section className="plan-section" aria-labelledby="ops-agent">
          <h3 id="ops-agent">{t("operations.agentSection")}</h3>
          {data.agent.registered === false ? (
            <p className="plan-muted">{t("operations.agentNotRegistered")}</p>
          ) : (
            <dl className="plan-metrics">
              <Metric label={t("operations.agentSection")} value={`${data.agent.name ?? data.agent.agentId} (${data.agent.agentId})`} />
              <Metric label={t("operations.availability")} value={data.agent.enabled ? t("operations.enabled") : t("operations.disabled")} />
              <Metric label={t("operations.capabilities")} value={(data.agent.capabilities ?? []).join(", ") || "—"} />
            </dl>
          )}
        </section>
        <section className="plan-section" aria-labelledby="ops-model">
          <h3 id="ops-model">{t("operations.modelSection")}</h3>
          {data.model ? (
            <dl className="plan-metrics">
              <Metric label={t("operations.modelProvider")} value={data.model.provider ?? "—"} />
              <Metric label={t("operations.modelId")} value={data.model.model ?? "—"} />
            </dl>
          ) : (
            <p className="plan-muted">{t("operations.modelNotRecorded")}</p>
          )}
        </section>
        <section className="plan-section" aria-labelledby="ops-env">
          <h3 id="ops-env">{t("operations.environmentSection")}</h3>
          {data.environment.registered === false ? (
            <p className="plan-muted">{t("operations.environmentNotRegistered")}</p>
          ) : (
            <dl className="plan-metrics">
              <Metric label={t("operations.instance")} value={`${data.environment.name ?? ""} (${data.environment.environmentInstanceId})`} />
              <Metric label={t("operations.type")} value={data.environment.environmentType ?? "—"} />
              <Metric label={t("operations.availability")} value={data.environment.availability ?? "—"} />
              <Metric
                label={t("operations.toolchains")}
                value={(data.environment.toolchains ?? []).map((tc) => `${tc.kind}${tc.version ? ` ${tc.version}` : ""}`).join(", ") || "—"}
              />
            </dl>
          )}
          <p className="plan-muted">
            {t("operations.runner")}: {s.runner ? <code>{`${s.runner.providerId} (${s.runner.kind})`}</code> : t("operations.noRunner")}
          </p>
        </section>
        <section className="plan-section" aria-labelledby="ops-workspace">
          <h3 id="ops-workspace">{t("operations.workspaceSection")}</h3>
          <dl className="plan-metrics">
            <Metric label="ID" value={<code>{s.workspace.workspaceId}</code>} />
            <Metric label={t("operations.workspaceMode")} value={s.workspace.mode} />
            <Metric label={t("operations.workspaceStatus")} value={s.workspace.status} />
          </dl>
        </section>
      </div>

      <section className="plan-section" aria-labelledby="ops-changes">
        <h3 id="ops-changes">{t("operations.changesSection")}</h3>
        {!data.changeSet || data.changeSet.entries.length === 0 ? (
          <p className="plan-muted">{t("operations.changesEmpty")}</p>
        ) : (
          <>
            <p className="plan-muted">
              {t("operations.changeSetStatus", { status: data.changeSet.status })} · {t("operations.workingNotCommitted")}
            </p>
            {data.changeSet.baseRevision ? (
              <p className="plan-muted">
                {t("operations.baseRevision")}: <code>{data.changeSet.baseRevision.slice(0, 12)}</code>
              </p>
            ) : null}
            <ul className="plan-rows">
              {data.changeSet.entries.map((e) => (
                <li key={`${e.change}:${e.path}`} className="plan-row">
                  <span className="ops-change">{changeLabel(t, e.change)}</span> <code>{e.fromPath ? `${e.fromPath} → ${e.path}` : e.path}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="plan-section" aria-labelledby="ops-verification">
        <h3 id="ops-verification">{t("operations.verificationSection")}</h3>
        {!latest ? (
          <p className="plan-muted">{t("operations.verificationEmpty")}</p>
        ) : (
          <>
            <p>
              <code>{shortId(latest.verificationId, 14)}</code> <StatusText value={latest.status} label={stageStatusLabel(t, latest.status)} />
            </p>
            {latest.status === "passed" && latest.sourceCurrent === false ? (
              <p className="ops-warning" role="status">
                <AlertTriangle size={14} aria-hidden /> {t("operations.reverificationRequired")}
              </p>
            ) : null}
            <ul className="plan-rows">
              {latest.stages.map((st) => (
                <li key={st.stageId} className="plan-row plan-row--stacked">
                  <span>
                    <code>{st.stageId}</code> <StatusText value={st.status} label={stageStatusLabel(t, st.status)} />
                    {st.failure ? <span className="plan-muted"> · {st.failure.kind}</span> : null}
                  </span>
                  {st.findings?.map((f) => (
                    <p key={f.rule} className="plan-muted">
                      {t("operations.findings", { count: f.count, rule: f.rule })}
                    </p>
                  ))}
                  {st.log ? (
                    <pre className="ops-log">
                      {redactForDisplay(st.log.text)}
                      {st.log.truncated ? `\n… ${t("operations.truncated")}` : ""}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="plan-section" aria-labelledby="ops-receipts">
        <h3 id="ops-receipts">{t("operations.logsSection")}</h3>
        {data.receipts.length === 0 ? (
          <p className="plan-muted">{t("operations.logsEmpty")}</p>
        ) : (
          <ul className="plan-rows">
            {data.receipts.map((r) => (
              <li key={r.receiptId} className="plan-row plan-row--stacked">
                <span>
                  <code>{r.operationId}</code> · {r.outcome} ({r.exitClass}) · {when(r.endedAt)}
                  {r.simulated ? <span className="plan-muted"> · {t("operations.simulated")}</span> : null}
                  {r.resources.outputTruncated ? <span className="plan-muted"> · {t("operations.truncated")}</span> : null}
                </span>
                {r.environment ? (
                  <p className="plan-muted">
                    {r.environment.adapterId}@{r.environment.adapterVersion} · {r.environment.runnerId}
                  </p>
                ) : null}
                {r.reasons.map((x, i) => (
                  <p key={i} className="plan-muted">
                    <code>{x.code}</code> {redactForDisplay(x.detail)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="plan-section" aria-labelledby="ops-timeline">
        <h3 id="ops-timeline">{t("operations.timelineSection")}</h3>
        {data.timeline.items.length === 0 ? (
          <p className="plan-muted">{t("operations.timelineEmpty")}</p>
        ) : (
          <>
            <ol className="ops-timeline">
              {data.timeline.items.map((e) => (
                <li key={e.id}>
                  <time dateTime={e.timestamp}>{when(e.timestamp)}</time> <strong>{e.action}</strong>
                  {e.actor ? <span className="plan-muted"> · {e.actor}</span> : null}
                  <span className="plan-muted"> {redactForDisplay(summarizeData(e.data))}</span>
                </li>
              ))}
            </ol>
            <p className="plan-muted">{t("operations.timelineCount", { shown: data.timeline.items.length, total: data.timeline.total })}</p>
            {data.timeline.items.length < data.timeline.total && data.timeline.limit < 200 ? (
              <Button variant="secondary" onClick={onMoreTimeline}>
                {t("operations.loadMore")}
              </Button>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function summarizeData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([k, v]) => k !== "execution" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .slice(0, 6)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="plan-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Controls({ data, projectId }: { data: Detail; projectId: string }) {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const stop = useStopExecution(projectId);
  const [open, setOpen] = useState<"cancel" | "kill" | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const s = data.session;
  const terminal = TERMINAL_SESSION_STATUSES.includes(s.status);
  // UX only: the Control Plane re-authorizes every command.
  const canCancel = accessDetails.capabilities.includes("cancel_execution");
  const canKill = accessDetails.capabilities.includes("kill_execution");

  const submit = async () => {
    if (!open || reason.trim().length === 0) return;
    try {
      const result = await stop.mutateAsync({ kind: open, sessionId: s.sessionId, reason: reason.trim() });
      const outcome = result.details?.outcome ?? "";
      setMessage(outcome.startsWith("already_") ? t("operations.stopConflict") : t("operations.stopDone"));
    } catch (error) {
      setMessage(
        error instanceof OperationsError && error.failure === "conflict"
          ? t("operations.stopConflict")
          : t("operations.stopFailed", { reason: error instanceof Error ? error.message : "unknown" }),
      );
    } finally {
      setOpen(null);
      setReason("");
    }
  };

  return (
    <section className="plan-section" aria-labelledby="ops-controls">
      <h3 id="ops-controls">{t("operations.controlsSection")}</h3>
      {message ? (
        <p role="status" className="plan-muted">
          {message}
        </p>
      ) : null}
      {terminal ? (
        <p className="plan-muted">{t("operations.terminalNotice")}</p>
      ) : !canCancel && !canKill ? (
        <p className="plan-muted">{t("operations.controlsViewOnly")}</p>
      ) : (
        <div className="ops-controls">
          {canCancel ? (
            <Button variant="secondary" onClick={() => setOpen("cancel")}>
              <StopCircle size={16} aria-hidden /> {t("operations.cancel")}
            </Button>
          ) : null}
          {canKill ? (
            <Button variant="danger" onClick={() => setOpen("kill")}>
              <Octagon size={16} aria-hidden /> {t("operations.kill")}
            </Button>
          ) : null}
        </div>
      )}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={t(open === "kill" ? "operations.killDialogTitle" : "operations.cancelDialogTitle", { id: shortId(s.sessionId, 18) })}
        description={t(open === "kill" ? "operations.killWarning" : "operations.cancelExplain")}
      >
        <label className="ops-reason">
          <span>{t("operations.reasonLabel")}</span>
          <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} rows={3} />
        </label>
        <div className="ops-controls">
          <Button variant="ghost" onClick={() => setOpen(null)}>
            {t("operations.dismiss")}
          </Button>
          <Button variant={open === "kill" ? "danger" : "primary"} disabled={reason.trim().length === 0 || stop.isPending} onClick={() => void submit()}>
            {t(open === "kill" ? "operations.confirmKill" : "operations.confirmCancel")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
