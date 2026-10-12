import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FastForward, Pause, Play, PlayCircle, XOctagon } from "lucide-react";
import { Button } from "../../../components/ui";
import { useCanOrchestrate, useRun, useRunCommand } from "../hooks/useOrchestration";
import type { OrchestrationCommand, RunView } from "../types";
import { useT } from "../lib/useT";
import { DefList, ErrorPanel, Notice, ProgressBar, RunStatusTag, Skeleton, TextList } from "./common";
import { TaskCard } from "./TaskCard";
import { availableControls, orderTasks } from "../lib/runLogic";

function Controls({ view, pending, onCommand }: {
  view: RunView;
  pending: boolean;
  onCommand: (command: OrchestrationCommand, extra?: Record<string, string>) => void;
}) {
  const { tt } = useT();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const available = availableControls(view);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) cancelRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const working = pending ? tt("controls.working") : null;
  return (
    <section className="eo-panel" aria-labelledby="eo-controls-heading">
      <h3 id="eo-controls-heading" className="eo-panel__title">{tt("controls.title")}</h3>
      <p className="eo-muted">{tt("controls.help")}</p>
      {view.run.paused ? <Notice tone="warning">{tt("detail.pausedNote")}</Notice> : null}
      <div className="eo-actions" aria-busy={pending}>
        {available.start ? (
          <Button type="button" variant="primary" disabled={pending} onClick={() => onCommand("orchestration_start")}>
            <PlayCircle size={16} aria-hidden /> {tt("controls.start")}
          </Button>
        ) : null}
        {available.advance ? (
          <Button type="button" disabled={pending} onClick={() => onCommand("orchestration_advance")}>
            <FastForward size={16} aria-hidden /> {tt("controls.advance")}
          </Button>
        ) : null}
        {available.pause ? (
          <Button type="button" disabled={pending} onClick={() => onCommand("orchestration_pause")}>
            <Pause size={16} aria-hidden /> {tt("controls.pause")}
          </Button>
        ) : null}
        {available.resume ? (
          <Button type="button" disabled={pending} onClick={() => onCommand("orchestration_resume")}>
            <Play size={16} aria-hidden /> {tt("controls.resume")}
          </Button>
        ) : null}
        {available.cancel ? (
          <button
            ref={cancelRef}
            type="button"
            className="ui-button danger"
            disabled={pending || confirming}
            onClick={() => setConfirming(true)}
          >
            <XOctagon size={16} aria-hidden /> {tt("controls.cancel")}
          </button>
        ) : null}
        {working ? <span className="eo-muted" role="status">{working}</span> : null}
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="eo-cancel-title"
          aria-describedby="eo-cancel-body"
          className="eo-confirm"
          onKeyDown={(event) => { if (event.key === "Escape") setConfirming(false); }}
        >
          <strong id="eo-cancel-title">{tt("controls.cancelTitle")}</strong>
          <p id="eo-cancel-body">{tt("controls.cancelBody")}</p>
          <div className="eo-actions">
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => { setConfirming(false); onCommand("orchestration_cancel"); }}
            >
              {tt("controls.cancelConfirm")}
            </Button>
            <button ref={keepRef} type="button" className="ui-button secondary" onClick={() => setConfirming(false)}>
              {tt("controls.cancelKeep")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Observational and operational view of one run. Polls only while EXECUTING. */
export function RunDetail({ runId }: { runId: string }) {
  const { tt, label, formatTime } = useT();
  const canControl = useCanOrchestrate();
  const run = useRun(runId);
  const command = useRunCommand();
  const inFlight = useRef(false);

  const view = run.view;
  const titles = useMemo(
    () => new Map((view?.run.tasks ?? []).map((task) => [task.taskId, task.title] as const)),
    [view],
  );
  const ordered = useMemo(() => orderTasks(view?.run.tasks ?? []), [view]);

  function send(commandName: OrchestrationCommand, extra: Record<string, string> = {}) {
    if (command.isPending || inFlight.current) return;
    inFlight.current = true;
    command.mutate(
      { command: commandName, body: { runId, ...extra } },
      { onSettled: () => { inFlight.current = false; } },
    );
  }

  const back = (
    <Link to="/execution-center" className="eo-link eo-back">
      <ArrowLeft size={14} aria-hidden /> {tt("common.back")}
    </Link>
  );

  if (run.isLoading) {
    return <div className="eo-stack">{back}<Skeleton label={tt("detail.loading")} /></div>;
  }
  if (!view) {
    return (
      <div className="eo-stack">
        {back}
        <ErrorPanel error={run.error ?? new Error("")} onRetry={() => void run.refetch()} />
      </div>
    );
  }

  const active = view.run.tasks.filter((task) => view.activeTaskIds.includes(task.taskId));
  const agents = [...new Set(active.map((task) => task.assignedAgent?.agentName).filter((name): name is string => Boolean(name)))];
  const statusText = label("runStatus", view.status);

  return (
    <div className="eo-stack" data-run-status={view.status}>
      {back}
      <div className="eo-visually-hidden" role="status" aria-live="polite" data-testid="run-announcer">
        {tt("detail.announce", { status: statusText, completed: view.progress.completed, total: view.progress.total })}
      </div>

      {run.error ? <ErrorPanel error={run.error} onRetry={() => void run.refetch()} /> : null}

      <section className="eo-panel" aria-labelledby="eo-run-heading">
        <h2 id="eo-run-heading" className="eo-panel__title">{tt("page.detailTitle")}</h2>
        <DefList
          items={[
            { label: tt("detail.project"), value: view.run.projectId },
            { label: tt("detail.objective"), value: view.run.objective },
            { label: tt("detail.status"), value: <RunStatusTag status={view.status} /> },
            {
              label: tt("detail.progress"),
              value: <ProgressBar completed={view.progress.completed} total={view.progress.total} percent={view.progress.percent} />,
            },
            { label: tt("detail.activeAgents"), value: <TextList items={agents} emptyLabel={tt("detail.noneActive")} /> },
            { label: tt("detail.currentTasks"), value: <TextList items={active.map((task) => task.title)} emptyLabel={tt("detail.noneActive")} /> },
            { label: tt("detail.createdAt"), value: formatTime(view.run.createdAt) },
            { label: tt("detail.updatedAt"), value: formatTime(view.run.updatedAt) },
          ]}
        />
        {view.status === "EXECUTING" ? <p className="eo-muted">{tt("detail.polling")}</p> : null}
        <div>
          <p className="eo-strong">{tt("detail.costTitle")}</p>
          <DefList
            items={[
              { label: tt("detail.costTokens"), value: Number.isFinite(view.cost?.estimatedInputTokens) ? String(view.cost.estimatedInputTokens) : tt("common.unavailable") },
              { label: tt("detail.costSpent"), value: typeof view.cost?.spentUsd === "number" ? String(view.cost.spentUsd) : tt("common.unavailable") },
            ]}
          />
          {view.cost?.note ? <p className="eo-muted">{view.cost.note}</p> : null}
        </div>
      </section>

      {canControl ? (
        <>
          {command.error ? <ErrorPanel error={command.error} onDismiss={() => command.reset()} /> : null}
          <Controls view={view} pending={command.isPending} onCommand={send} />
        </>
      ) : (
        <Notice title={tt("access.readOnlyTitle")}>{tt("access.readOnlyBody")}</Notice>
      )}

      <section className="eo-panel" aria-labelledby="eo-notes-heading">
        <h3 id="eo-notes-heading" className="eo-panel__title">{tt("detail.planNotesTitle")}</h3>
        <p className="eo-muted">{tt("detail.planNotesHelp")}</p>
        <TextList items={view.run.planNotes} emptyLabel={tt("detail.planNotesEmpty")} />
      </section>

      <section className="eo-panel" aria-labelledby="eo-tasks-heading">
        <h3 id="eo-tasks-heading" className="eo-panel__title">{tt("detail.tasksTitle")}</h3>
        <p className="eo-muted">{tt("detail.tasksHelp")}</p>
        {ordered.length === 0 ? (
          <p className="eo-muted">{tt("detail.tasksEmpty")}</p>
        ) : (
          <ol className="eo-tasks">
            {ordered.map((task) => (
              <TaskCard
                key={task.taskId}
                task={task}
                titles={titles}
                canControl={canControl}
                pending={command.isPending}
                onRetry={(taskId) => send("orchestration_retry_task", { taskId })}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
