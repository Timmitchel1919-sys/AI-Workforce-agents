import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/ui";
import type { OrchTask } from "../types";
import { useT } from "../lib/useT";
import { canRetryTask } from "../lib/runLogic";
import { DefList, Notice, Tag, TaskStatusTag, TextList, Unavailable } from "./common";

export function TaskCard({ task, titles, canControl, pending, onRetry }: {
  task: OrchTask;
  titles: ReadonlyMap<string, string>;
  canControl: boolean;
  pending: boolean;
  onRetry: (taskId: string) => void;
}) {
  const { tt, label, formatTime } = useT();
  const headingId = `eo-task-${task.taskId}`;
  const agent = task.assignedAgent;
  const model = task.assignedModel;
  const result = task.result;
  const modelText = model?.model
    ? (model.provider ? tt("task.modelValue", { model: model.model, provider: model.provider }) : tt("task.modelOnly", { model: model.model }))
    : null;
  const items: { label: string; value: ReactNode }[] = [
    { label: tt("task.agent"), value: agent ? agent.agentName : <span className="eo-unavailable">{tt("task.noAgent")}</span> },
  ];
  if (agent) items.push({ label: tt("task.routingEvidence"), value: <TextList items={agent.reasons} /> });
  items.push({
    label: tt("task.model"),
    value: modelText ? <>{modelText}{model?.reason ? <span className="eo-muted eo-block">{model.reason}</span> : null}</> : (model?.reason ? model.reason : <Unavailable />),
  });
  items.push({ label: tt("task.capabilities"), value: <TextList items={task.requiredCapabilities} /> });
  items.push({
    label: tt("task.dependencies"),
    value: <TextList items={task.dependencies.map((id) => titles.get(id) ?? id)} />,
  });
  items.push({ label: tt("task.permittedTools"), value: <TextList items={task.permittedTools} /> });
  items.push({ label: tt("task.deniedTools"), value: <TextList items={task.deniedTools} /> });
  if (task.estimate) items.push({ label: tt("task.estimate"), value: String(task.estimate.inputTokens) });

  return (
    <li className="eo-task" aria-labelledby={headingId} data-task-status={task.status}>
      <div className="eo-task__head">
        <h4 id={headingId} className="eo-task__title">{task.title}</h4>
        <div className="eo-task__tags">
          <TaskStatusTag status={task.status} />
          <Tag>{label("taskType", task.type)}</Tag>
          {task.gate ? <Tag tone="info" icon={<ShieldCheck size={14} aria-hidden />}>{label("gate", task.gate)}</Tag> : null}
          {task.destructive ? <Tag tone="warning">{tt("task.destructive")}</Tag> : null}
          <Tag>{tt("task.attempts", { attempts: task.attempts, max: task.maxAttempts })}</Tag>
        </div>
      </div>
      {task.description ? <p className="eo-muted">{task.description}</p> : null}

      <DefList items={items} />

      {task.status === "WAITING_APPROVAL" || task.approval ? (
        <div className="eo-sub" data-testid="task-approval">
          <p className="eo-strong">
            {task.approval ? tt("task.approvalState", { state: label("approvalState", task.approval.state) }) : tt("task.approval")}
          </p>
          {task.status === "WAITING_APPROVAL" ? (
            <>
              <p className="eo-muted">{tt("task.approvalHelp")}</p>
              <Link to="/approvals" className="eo-link">{tt("task.approvalLink")}</Link>
            </>
          ) : null}
        </div>
      ) : null}

      {task.status === "BLOCKED" || task.blockedReason ? (
        <div className="eo-sub" data-testid="task-blocked">
          <p className="eo-strong">
            {tt("task.blocked")}{task.blockKind ? ` · ${label("blockKind", task.blockKind)}` : ""}
          </p>
          {task.blockedReason ? <p>{tt("task.blockedReason", { reason: task.blockedReason })}</p> : null}
          {task.blockKind === "security" ? <Notice tone="warning">{tt("task.securityBlock")}</Notice> : null}
        </div>
      ) : null}

      {task.failures.length > 0 ? (
        <div className="eo-sub" data-testid="task-failures">
          <p className="eo-strong">{tt("task.failures")}</p>
          <ul className="eo-list">
            {task.failures.map((failure, index) => (
              <li key={`${failure.at}-${index}`} className="eo-list__item">
                <span className="eo-strong">
                  {tt("task.failureLine", {
                    classification: label("failureClass", failure.classification),
                    recovery: label("recovery", failure.recovery),
                    attempt: failure.retryCount + 1,
                  })}
                </span>
                <span className="eo-block eo-muted">{failure.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div className="eo-sub" data-testid="task-result">
          <p className="eo-strong">{tt("task.result")}</p>
          <p className={`eo-verify eo-verify--${result.verified ? "yes" : "no"}`}>
            {tt("task.claimedVerified", {
              claimed: label("claimed", result.claimed),
              verified: result.verified ? tt("common.yes") : tt("common.no"),
            })}
          </p>
          {result.verified ? (
            result.verification ? <p className="eo-muted">{tt("task.verification")}: {result.verification}</p> : null
          ) : (
            <p className="eo-muted">{tt("task.notVerified")}{result.verification ? ` ${result.verification}` : ""}</p>
          )}
          {result.summary ? <p>{tt("task.summary")}: {result.summary}</p> : null}
          {result.verdict ? <p>{tt("task.verdict")}: {label("verdict", result.verdict)}</p> : null}
          {result.checks.length > 0 ? (
            <ul className="eo-list" aria-label={tt("task.checks")}>
              {result.checks.map((check, index) => (
                <li key={`${index}-${check.name}`} className="eo-list__item">
                  {check.name}: {check.passed ? tt("task.checkPassed") : tt("task.checkFailed")}
                </li>
              ))}
            </ul>
          ) : null}
          {result.verifiedAt ? <p className="eo-muted">{formatTime(result.verifiedAt)}</p> : null}
        </div>
      ) : null}

      {task.acceptanceCriteria.length > 0 ? (
        <div className="eo-sub">
          <p className="eo-strong">{tt("task.acceptance")}</p>
          <TextList items={task.acceptanceCriteria} />
        </div>
      ) : null}

      {canControl && canRetryTask(task) ? (
        <div className="eo-actions">
          <Button
            type="button"
            onClick={() => onRetry(task.taskId)}
            disabled={pending}
            aria-label={tt("controls.retryTaskLabel", { title: task.title })}
          >
            <RotateCcw size={16} aria-hidden /> {tt("controls.retryTask")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
