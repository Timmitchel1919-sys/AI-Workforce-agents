import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { Button } from "../../../components/ui";
import { useRunCommand, usePreparedRequests } from "../hooks/useOrchestration";
import { PLANNABLE_VALIDATIONS } from "../types";
import { useT } from "../lib/useT";
import { ErrorPanel, Notice, Skeleton } from "./common";

const OPTION_MAX = 90;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > OPTION_MAX ? `${flat.slice(0, OPTION_MAX - 1)}…` : flat;
}

/**
 * Creates a plan from a prepared (validated) request. Planning only decomposes
 * the request into tasks; nothing is executed. Creation is one command.
 */
export function PlanFromRequest() {
  const { tt, label } = useT();
  const navigate = useNavigate();
  const prepared = usePreparedRequests(true);
  const command = useRunCommand();
  const [requestId, setRequestId] = useState("");
  const [missing, setMissing] = useState(false);
  const inFlight = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (missing) summaryRef.current?.focus();
  }, [missing]);

  const plannable = [...prepared.requests]
    .filter((item) => PLANNABLE_VALIDATIONS.includes(item.validation))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending || inFlight.current) return;
    if (!requestId) {
      setMissing(true);
      return;
    }
    setMissing(false);
    inFlight.current = true;
    command.mutate(
      { command: "orchestration_create", body: { requestId } },
      {
        onSuccess: (view) => navigate(`/execution-center/${encodeURIComponent(view.run.runId)}`),
        // Stay locked after success (we are navigating away); only a failure re-enables the form.
        onError: () => { inFlight.current = false; },
      },
    );
  }

  return (
    <section className="eo-panel" aria-labelledby="eo-plan-heading">
      <h2 id="eo-plan-heading" className="eo-panel__title">{tt("plan.title")}</h2>
      <p className="eo-muted">{tt("plan.description")}</p>
      {prepared.isLoading ? <Skeleton label={tt("plan.loading")} /> : null}
      {!prepared.isLoading && prepared.error ? <ErrorPanel error={prepared.error} onRetry={() => void prepared.refetch()} /> : null}
      {!prepared.isLoading && !prepared.error && plannable.length === 0 ? <Notice>{tt("plan.noRequests")}</Notice> : null}
      {!prepared.isLoading && !prepared.error && plannable.length > 0 ? (
        <form className="eo-form" onSubmit={submit} noValidate aria-busy={command.isPending}>
          {missing ? (
            <div ref={summaryRef} role="alert" tabIndex={-1} className="eo-error-summary">
              <h3 className="eo-error-summary__title">{tt("plan.errorSummaryTitle")}</h3>
              <ul><li>{tt("plan.selectRequired")}</li></ul>
            </div>
          ) : null}
          {command.error ? <ErrorPanel error={command.error} onDismiss={() => command.reset()} /> : null}
          <div className="eo-field">
            <label className="eo-label" htmlFor="eo-request">{tt("plan.selectLabel")}</label>
            <select
              id="eo-request"
              className="eo-select"
              value={requestId}
              onChange={(event) => { setRequestId(event.target.value); setMissing(false); }}
              aria-invalid={missing ? "true" : undefined}
              disabled={command.isPending}
            >
              <option value="">{tt("plan.choose")}</option>
              {plannable.map((item) => (
                <option key={item.requestId} value={item.requestId}>
                  {tt("plan.optionLabel", { request: clip(item.request), status: label("validation", item.validation) })}
                </option>
              ))}
            </select>
          </div>
          <div className="eo-actions">
            <Button type="submit" variant="primary" loading={command.isPending} disabled={command.isPending}>
              <ListChecks size={16} aria-hidden /> {command.isPending ? tt("plan.submitting") : tt("plan.submit")}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
