import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "../../../components/ui";
import type { ProjectSummary } from "../../executionPlans";
import { MAX_REQUEST_LENGTH, MAX_TASK_ID_LENGTH } from "../types";
import { useT } from "../lib/useT";
import { Notice } from "./common";

export interface RequestFormValues { request: string; projectId?: string; taskId?: string }

/**
 * Collects the user's request and nothing else. All analysis happens on the
 * server; the only client-side check is that something was typed.
 */
export function RequestForm({ projects, projectsFailed, pending, onSubmit }: {
  projects: readonly ProjectSummary[];
  projectsFailed: boolean;
  pending: boolean;
  onSubmit: (values: RequestFormValues) => void;
}) {
  const { tt } = useT();
  const [request, setRequest] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [missing, setMissing] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (missing) summaryRef.current?.focus();
  }, [missing]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (request.trim().length === 0) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit({
      request,
      ...(projectId ? { projectId } : {}),
      ...(taskId.trim() ? { taskId: taskId.trim() } : {}),
    });
  }

  return (
    <form className="pi-form" onSubmit={submit} noValidate aria-busy={pending}>
      {missing ? (
        <div ref={summaryRef} role="alert" tabIndex={-1} className="pi-error-summary">
          <h3 className="pi-error-summary__title">{tt("form.errorSummaryTitle")}</h3>
          <ul>
            <li>
              <a
                href="#pi-request"
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById("pi-request")?.focus();
                }}
              >
                {tt("form.requestRequired")}
              </a>
            </li>
          </ul>
        </div>
      ) : null}

      <div className="pi-field">
        <label htmlFor="pi-request" className="pi-label">{tt("form.requestLabel")}</label>
        <textarea
          id="pi-request"
          className="pi-textarea"
          rows={6}
          maxLength={MAX_REQUEST_LENGTH}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          aria-describedby="pi-request-hint pi-request-count"
          aria-invalid={missing}
          disabled={pending}
        />
        <div className="pi-field__foot">
          <p id="pi-request-hint" className="pi-muted">{tt("form.requestHint")}</p>
          <p id="pi-request-count" className="pi-muted" data-testid="request-counter">
            {tt("form.counter", { count: request.length, max: MAX_REQUEST_LENGTH })}
          </p>
        </div>
      </div>

      <div className="pi-form__row">
        <div className="pi-field">
          <label htmlFor="pi-project" className="pi-label">{tt("form.projectLabel")}</label>
          <select
            id="pi-project"
            className="pi-select"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            disabled={pending}
          >
            <option value="">{tt("form.projectDetect")}</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.displayName}</option>
            ))}
          </select>
          {projectsFailed ? <p className="pi-muted">{tt("form.projectsUnavailable")}</p> : null}
        </div>
        <div className="pi-field">
          <label htmlFor="pi-task" className="pi-label">{tt("form.taskLabel")}</label>
          <input
            id="pi-task"
            className="pi-input"
            type="text"
            maxLength={MAX_TASK_ID_LENGTH}
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            autoComplete="off"
            disabled={pending}
          />
          <p className="pi-muted">{tt("form.taskHint")}</p>
        </div>
      </div>

      <Notice>{tt("form.noExecution")}</Notice>

      <div className="pi-actions">
        <Button type="submit" variant="primary" loading={pending} disabled={pending}>
          <Send size={16} aria-hidden /> {pending ? tt("form.submitting") : tt("form.submit")}
        </Button>
      </div>
    </form>
  );
}
