import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { useProjects } from "../../executionPlans";
import { usePrepareRequest, usePromptHistory, usePromptRequest, useRequestApproval } from "../hooks/usePromptIntelligence";
import { PREPARE_CAPABILITY } from "../types";
import { useT } from "../lib/useT";
import { HistoryList } from "./HistoryList";
import { RequestForm, type RequestFormValues } from "./RequestForm";
import { ResultView } from "./ResultView";
import { ErrorPanel, Notice, Skeleton } from "./common";

/**
 * Observational + operational view of the prompt pipeline. The browser only
 * submits the request and displays what the Control Plane prepared.
 */
export function PromptIntelligenceWorkspace() {
  const { tt } = useT();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { accessDetails } = useAuth();
  const canPrepare = accessDetails?.capabilities?.includes(PREPARE_CAPABILITY) ?? false;

  const { projects, status: projectsStatus } = useProjects();
  const history = usePromptHistory();
  const detail = usePromptRequest(requestId);
  const prepare = usePrepareRequest();
  const approval = useRequestApproval();
  const [live, setLive] = useState("");

  function submit(values: RequestFormValues) {
    if (prepare.isPending) return;
    setLive(tt("live.analyzing"));
    prepare.mutate(values, {
      onSuccess: (view) => {
        setLive(tt("live.prepared", { status: tt(`status.${view.execution.validation}`) }));
        navigate(`/prompt-intelligence/${encodeURIComponent(view.record.requestId)}`);
      },
      onError: () => setLive(tt("live.failed")),
    });
  }

  function requestApproval() {
    if (!requestId || approval.isPending) return;
    setLive(tt("live.requestingApproval"));
    approval.mutate(requestId, {
      onSuccess: () => setLive(tt("live.approvalRequested")),
      onError: () => setLive(tt("live.approvalFailed")),
    });
  }

  const projectsFailed = projectsStatus !== "ready" && projectsStatus !== "empty" && projectsStatus !== "loading";

  return (
    <div className="pi-workspace">
      <p className="pi-visually-hidden" role="status" aria-live="polite" data-testid="live-region">{live}</p>

      <div className="pi-layout">
        <div className="pi-main">
          <section className="pi-panel" aria-labelledby="pi-form-heading">
            <h2 id="pi-form-heading" className="pi-panel__title">{tt("form.title")}</h2>
            {canPrepare ? (
              <>
                <RequestForm
                  projects={projects}
                  projectsFailed={projectsFailed}
                  pending={prepare.isPending}
                  onSubmit={submit}
                />
                {prepare.error ? (
                  <ErrorPanel
                    error={prepare.error}
                    onRetry={prepare.variables ? () => submit(prepare.variables!) : undefined}
                    onDismiss={() => prepare.reset()}
                  />
                ) : null}
              </>
            ) : (
              <Notice>
                <strong>{tt("access.readOnlyTitle")}</strong>
                <p>{tt("access.readOnlyBody")}</p>
              </Notice>
            )}
          </section>

          <section className="pi-panel" aria-labelledby="pi-result-heading" aria-busy={prepare.isPending || detail.isLoading}>
            <h2 id="pi-result-heading" className="pi-panel__title">{tt("result.title")}</h2>
            {prepare.isPending ? <Skeleton label={tt("result.preparing")} /> : null}
            {!prepare.isPending && !requestId ? <p className="pi-muted">{tt("result.none")}</p> : null}
            {!prepare.isPending && requestId && detail.isLoading ? <Skeleton label={tt("result.loading")} /> : null}
            {!prepare.isPending && requestId && !detail.isLoading && detail.error ? (
              <ErrorPanel error={detail.error} onRetry={() => { void detail.refetch(); }} />
            ) : null}
            {!prepare.isPending && requestId && detail.view ? (
              <ResultView
                view={detail.view}
                canPrepare={canPrepare}
                onRequestApproval={requestApproval}
                approvalPending={approval.isPending}
                approvalError={approval.error}
                onDismissApprovalError={() => approval.reset()}
              />
            ) : null}
          </section>
        </div>

        <aside className="pi-side">
          <HistoryList
            requests={history.requests}
            isLoading={history.isLoading}
            error={history.error}
            onRetry={() => { void history.refetch(); }}
            selectedId={requestId}
          />
        </aside>
      </div>
    </div>
  );
}
