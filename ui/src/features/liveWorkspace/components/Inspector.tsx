import { useEffect, useRef, useState } from "react";
import { Pause, Play, XOctagon } from "lucide-react";
import { Button } from "../../../components/ui";
import { useCanOrchestrate, useRuntimeCommand } from "../hooks/useRuntime";
import { formatDuration, isTerminal, sessionDurationMs } from "../lib/logic";
import { useT } from "../lib/useT";
import type { RuntimeSession, RuntimeState } from "../types";
import { DefList, ErrorPanel, Notice, StatusTag, Tag, Unavailable } from "./common";

export function Controls({ session, status }: { session: RuntimeSession; status: RuntimeState }) {
  const { tt } = useT();
  const allowed = useCanOrchestrate();
  const mutation = useRuntimeCommand(session.executionId);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) cancelRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!allowed) return null;
  const terminal = isTerminal(status);
  const pending = mutation.isPending;
  const canPause = status === "RUNNING" && !session.paused;
  const canResume = status === "PAUSED" || (session.paused && !terminal);
  return (
    <section className="lw-sub" aria-labelledby="lw-controls-heading">
      <h3 id="lw-controls-heading" className="lw-sub__title">{tt("controls.title")}</h3>
      <div className="lw-actions" aria-busy={pending}>
        {canPause ? (
          <Button type="button" disabled={pending} onClick={() => mutation.mutate("runtime_pause_session")}>
            <Pause size={16} aria-hidden /> {tt("controls.pause")}
          </Button>
        ) : null}
        {canResume ? (
          <Button type="button" disabled={pending} onClick={() => mutation.mutate("runtime_resume_session")}>
            <Play size={16} aria-hidden /> {tt("controls.resume")}
          </Button>
        ) : null}
        {!terminal ? (
          <button ref={cancelRef} type="button" className="ui-button danger" disabled={pending || confirming} onClick={() => setConfirming(true)}>
            <XOctagon size={16} aria-hidden /> {tt("controls.cancel")}
          </button>
        ) : null}
        {pending ? <span className="lw-muted" role="status">{tt("controls.working")}</span> : null}
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="lw-cancel-title"
          aria-describedby="lw-cancel-body"
          className="lw-confirm"
          onKeyDown={(event) => { if (event.key === "Escape") setConfirming(false); }}
        >
          <strong id="lw-cancel-title">{tt("controls.cancelTitle")}</strong>
          <p id="lw-cancel-body">{tt("controls.cancelBody")}</p>
          <div className="lw-actions">
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => { setConfirming(false); mutation.mutate("runtime_cancel_session"); }}
            >
              {tt("controls.cancelConfirm")}
            </Button>
            <button ref={keepRef} type="button" className="ui-button secondary" onClick={() => setConfirming(false)}>
              {tt("controls.cancelKeep")}
            </button>
          </div>
        </div>
      ) : null}
      {mutation.error ? <ErrorPanel error={mutation.error} /> : null}
    </section>
  );
}

export function Inspector({ session, status }: { session: RuntimeSession; status: RuntimeState }) {
  const { tt, label, formatTime } = useT();
  const duration = formatDuration(sessionDurationMs(session));
  return (
    <section className="lw-panel lw-area-inspector" aria-labelledby="lw-inspector-heading">
      <h2 id="lw-inspector-heading" className="lw-panel__title">{tt("inspector.title")}</h2>
      <DefList
        items={[
          { label: tt("inspector.agent"), value: session.agentId },
          { label: tt("inspector.model"), value: session.modelId ?? <Unavailable /> },
          { label: tt("inspector.task"), value: session.taskId },
          { label: tt("inspector.status"), value: <StatusTag status={status} /> },
          { label: tt("inspector.operation"), value: session.currentOperation ?? <Unavailable /> },
          { label: tt("inspector.started"), value: session.startedAt ? formatTime(session.startedAt) : <Unavailable /> },
          { label: tt("inspector.duration"), value: duration ?? (session.startedAt && !session.completedAt ? tt("inspector.running") : <Unavailable />) },
          { label: tt("inspector.retries"), value: session.retries },
          {
            label: tt("inspector.tokens"),
            value: session.estimatedInputTokens !== undefined ? tt("inspector.tokensValue", { count: session.estimatedInputTokens }) : <Unavailable />,
          },
        ]}
      />
      <Controls session={session} status={status} />
      {session.approval ? (
        <Notice tone="warning" title={tt("inspector.approval")}>{session.approval.reason}</Notice>
      ) : null}
      {session.error ? (
        <div className="lw-alert lw-alert--danger" role="note">
          <strong>{tt("inspector.error")}: {label("errorKind", session.error.kind)}</strong>
          <p>{session.error.message}</p>
        </div>
      ) : null}
      {session.gitState ? (
        <section className="lw-sub" aria-labelledby="lw-git-heading">
          <h3 id="lw-git-heading" className="lw-sub__title">{tt("inspector.git")}</h3>
          <DefList
            items={[
              { label: tt("inspector.branch"), value: session.gitState.branch ?? <Unavailable /> },
              { label: tt("inspector.head"), value: session.gitState.head ?? <Unavailable /> },
              { label: tt("inspector.dirty"), value: session.gitState.dirty ? tt("common.yes") : tt("common.no") },
              { label: tt("inspector.gitChanged"), value: session.gitState.changedFiles.length },
            ]}
          />
        </section>
      ) : null}
      <section className="lw-sub" aria-labelledby="lw-tools-heading">
        <h3 id="lw-tools-heading" className="lw-sub__title">{tt("inspector.tools")}</h3>
        {session.tools.length === 0 ? (
          <p className="lw-muted">{tt("inspector.noTools")}</p>
        ) : (
          <ul className="lw-list">
            {session.tools.map((tool, index) => (
              <li key={`${tool.at}-${index}`} className="lw-tool">
                <span className="lw-strong">{tool.tool} · {tool.operation}</span>{" "}
                <Tag tone={tool.result === "ok" ? "success" : tool.result === "denied" ? "warning" : "danger"}>{label("toolResult", tool.result)}</Tag>
                {tool.error ? <span className="lw-muted lw-block">{tool.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
