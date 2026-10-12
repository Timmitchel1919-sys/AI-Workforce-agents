import { useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, XCircle } from "lucide-react";
import { useFile } from "../hooks/useRuntime";
import { badgeKeyFor, classifyDiffLine, formatBytes, formatDuration } from "../lib/logic";
import { useT } from "../lib/useT";
import type { FileChange, RuntimeSession, ValidationStageResult } from "../types";
import { errorCode } from "../api/runtimeClient";
import { DefList, ErrorPanel, Notice, Skeleton, Tag, type Tone } from "./common";

const TABS = ["files", "diff", "preview", "tests"] as const;
export type CenterTab = (typeof TABS)[number];

/* ---------------------------- FILES ---------------------------- */

function FilesTab({ executionId, path }: { executionId: string; path: string | undefined }) {
  const { tt } = useT();
  const { file, isLoading, error, refetch } = useFile(executionId, path);
  if (!path) {
    return <div className="lw-empty"><p>{tt("files.choose")}</p></div>;
  }
  if (isLoading) return <Skeleton label={tt("files.loading")} />;
  if (error) {
    const code = errorCode(error);
    if (code === "FORBIDDEN" || code === "INVALID" || code === "NOT_FOUND") {
      return (
        <Notice tone="warning" title={tt("files.refusedTitle")}>
          {tt("files.refusedBody", { path })}{" "}
          <span data-testid="refusal-reason">{error instanceof Error ? error.message : ""}</span>
        </Notice>
      );
    }
    return <ErrorPanel error={error} onRetry={() => void refetch()} />;
  }
  if (!file) return null;
  return (
    <div className="lw-stack">
      <p className="lw-strong">{file.path}</p>
      <p className="lw-muted">{tt("files.size", { size: formatBytes(file.size) })}</p>
      {file.truncated ? <Notice tone="warning">{tt("files.truncated")}</Notice> : null}
      <pre className="lw-code" tabIndex={0} aria-label={tt("files.contentLabel", { path: file.path })}>{file.content}</pre>
    </div>
  );
}

/* ---------------------------- DIFF ---------------------------- */

function DiffBlock({ change, defaultOpen, index }: { change: FileChange; defaultOpen: boolean; index: number }) {
  const { tt, formatTime } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const id = `lw-diff-${index}`;
  return (
    <li className="lw-change">
      <div className="lw-change__head">
        <Tag tone={change.operation === "delete" ? "danger" : "info"}>{tt(`tree.badge.${badgeKeyFor(change.operation)}`)}</Tag>
        <strong className="lw-strong">{change.path}</strong>
      </div>
      <p className="lw-muted">
        {tt("diff.meta", { time: formatTime(change.at), task: change.taskId, agent: change.agentId })}
        {change.renamedFrom ? ` · ${tt("diff.renamedFrom", { from: change.renamedFrom })}` : ""}
      </p>
      {change.diff ? (
        <>
          <button type="button" className="lw-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {open ? tt("diff.collapse") : tt("diff.expand")}
          </button>
          {open ? (
            <pre id={id} className="lw-diff" tabIndex={0} aria-label={tt("diff.label", { path: change.path })}>
              {change.diff.split("\n").map((line, i) => (
                <span key={i} className={`lw-diff__line lw-diff__line--${classifyDiffLine(line)}`}>{line}{"\n"}</span>
              ))}
            </pre>
          ) : null}
        </>
      ) : <p className="lw-muted">{tt("diff.noDiff")}</p>}
    </li>
  );
}

function ScopeReportView({ scope }: { scope: RuntimeSession["scope"] }) {
  const { tt } = useT();
  if (!scope) return <Notice>{tt("diff.scopeNone")}</Notice>;
  const flagged = scope.status === "FLAGGED_FOR_REVIEW";
  return (
    <div className={`lw-scope ${flagged ? "lw-scope--flagged" : "lw-scope--ok"}`} data-scope={scope.status}>
      <strong>
        {flagged ? <AlertTriangle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}{" "}
        {tt(`diff.scope.${scope.status}`)}
      </strong>
      <p className="lw-muted">{flagged ? tt("diff.scopeFlaggedHelp") : tt("diff.scopeOkHelp")}</p>
      {scope.unexpected.length > 0 ? (
        <div>
          <strong>{tt("diff.unexpected")}</strong>
          <ul className="lw-list">{scope.unexpected.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {scope.sensitive.length > 0 ? (
        <div>
          <strong>{tt("diff.sensitive")}</strong>
          <ul className="lw-list">{scope.sensitive.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {scope.expected.length > 0 ? (
        <details>
          <summary>{tt("diff.expected", { count: scope.expected.length })}</summary>
          <ul className="lw-list">{scope.expected.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function DiffTab({ session }: { session: RuntimeSession }) {
  const { tt } = useT();
  return (
    <div className="lw-stack">
      <ScopeReportView scope={session.scope} />
      {session.changes.length === 0 ? (
        <div className="lw-empty"><p>{tt("diff.empty")}</p></div>
      ) : (
        <ul className="lw-changes" aria-label={tt("diff.listLabel")}>
          {session.changes.map((change, index) => (
            <DiffBlock key={`${change.path}-${change.at}-${index}`} change={change} index={index} defaultOpen={index < 5} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------- PREVIEW ---------------------------- */

function PreviewTab() {
  const { tt } = useT();
  return <Notice title={tt("preview.title")}>{tt("preview.body")}</Notice>;
}

/* ---------------------------- TESTS ---------------------------- */

const STAGE_TONE: Record<ValidationStageResult["status"], Tone> = {
  passed: "success", failed: "danger", skipped: "neutral", unavailable: "warning",
};

function StageCard({ stage }: { stage: ValidationStageResult }) {
  const { tt, label } = useT();
  const icon = stage.status === "passed" ? <CheckCircle2 size={14} aria-hidden />
    : stage.status === "failed" ? <XCircle size={14} aria-hidden />
    : stage.status === "skipped" ? <CircleSlash size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />;
  const duration = formatDuration(stage.durationMs);
  return (
    <li className="lw-stage" data-stage={stage.stage} data-status={stage.status}>
      <div className="lw-stage__head">
        <h4 className="lw-stage__title">{label("stage", stage.stage)}</h4>
        <Tag tone={STAGE_TONE[stage.status]} icon={icon}>{label("stageStatus", stage.status)}</Tag>
      </div>
      {stage.note ? <p className="lw-muted">{stage.note}</p> : null}
      <DefList
        items={[
          ...(stage.command ? [{ label: tt("tests.command"), value: <code className="lw-inline-code">{stage.command}</code> }] : []),
          ...(duration ? [{ label: tt("tests.duration"), value: duration }] : []),
          ...(stage.counts ? [{
            label: tt("tests.counts"),
            value: tt("tests.countsValue", { total: stage.counts.total, passed: stage.counts.passed, failed: stage.counts.failed, skipped: stage.counts.skipped }),
          }] : []),
          ...(stage.warnings > 0 ? [{ label: tt("tests.warnings"), value: stage.warnings }] : []),
        ]}
      />
      {stage.errors.length > 0 ? (
        <div>
          <strong>{tt("tests.errors", { count: stage.errors.length })}</strong>
          <ul className="lw-list lw-list--errors">{stage.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      ) : null}
    </li>
  );
}

function TestsTab({ session }: { session: RuntimeSession }) {
  const { tt } = useT();
  if (session.validation.length === 0) return <div className="lw-empty"><p>{tt("tests.empty")}</p></div>;
  return <ul className="lw-stages" aria-label={tt("tests.listLabel")}>{session.validation.map((s) => <StageCard key={s.stage} stage={s} />)}</ul>;
}

/* ---------------------------- Container ---------------------------- */

export function CenterPanel({ session, tab, onTab, filePath }: {
  session: RuntimeSession;
  tab: CenterTab;
  onTab: (tab: CenterTab) => void;
  filePath: string | undefined;
}) {
  const { tt } = useT();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const target = TABS[next] as CenterTab;
    onTab(target);
    refs.current[target]?.focus();
  };
  return (
    <section className="lw-panel lw-area-center" aria-label={tt("tabs.label")}>
      <div role="tablist" aria-label={tt("tabs.label")} className="lw-tabs" onKeyDown={onKeyDown}>
        {TABS.map((id) => (
          <button
            key={id}
            ref={(el) => { refs.current[id] = el; }}
            type="button"
            role="tab"
            id={`lw-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`lw-tabpanel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`lw-tab${tab === id ? " is-active" : ""}`}
            onClick={() => onTab(id)}
          >
            {tt(`tabs.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`lw-tabpanel-${tab}`} aria-labelledby={`lw-tab-${tab}`} className="lw-tabpanel">
        {tab === "files" ? <FilesTab executionId={session.executionId} path={filePath} /> : null}
        {tab === "diff" ? <DiffTab session={session} /> : null}
        {tab === "preview" ? <PreviewTab /> : null}
        {tab === "tests" ? <TestsTab session={session} /> : null}
      </div>
    </section>
  );
}
