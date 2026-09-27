import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Dialog, ErrorState, Skeleton } from "../../../components/ui";
import { OnboardingClientError } from "../api/onboardingClient";
import type { OnboardingPatch } from "../api/onboardingClient";
import { useOnboardingCapabilities, useOnboardingCommand, useOnboardingSession } from "../hooks/useOnboarding";
import {
  EDITABLE,
  GUIDED_STEPS,
  PLAN_STEPS,
  PROGRESS_STATUSES,
  initialStep,
  stepsFor,
  type WizardStep,
} from "../lib/steps";
import { validateIdentitySource, type FieldErrors } from "../lib/validation";
import { useT } from "../lib/useT";
import type { OnboardingIdentity, OnboardingSession, OnboardingSource } from "../types";
import { AnalysisView } from "./AnalysisView";
import { CommandError, ErrorSummary, Notice, Section } from "./common";
import { IdentityFields, SourceFields } from "./DraftFields";
import { FIELD_IDS } from "../lib/fieldIds";
import { AutonomyEditor, CostEditor, GitEditor, OverridesEditor } from "./PlanEditors";
import {
  ArchitectureView,
  AutonomyView,
  CostView,
  DeploymentView,
  EnvironmentsView,
  GitView,
  GovernanceView,
  IntegrationsView,
  PipelineView,
  SecretsView,
  TechnologyView,
  WorkforceView,
} from "./PlanViews";
import { ProvisioningProgress } from "./ProvisioningProgress";
import { ReviewStep } from "./ReviewStep";
import { Stepper } from "./Stepper";

const FIELD_ORDER: (keyof FieldErrors)[] = ["name", "code", "repositoryUrl", "specification", "objective"];

function pickErrors(errors: FieldErrors, keys: (keyof FieldErrors)[]): FieldErrors {
  const out: FieldErrors = {};
  for (const key of keys) if (errors[key]) out[key] = errors[key];
  return out;
}

export function OnboardingWizard({ onboardingId }: { onboardingId: string }) {
  const { tt } = useT();
  const navigate = useNavigate();
  const { session, isLoading, error, refetch } = useOnboardingSession(onboardingId);
  const { capabilities } = useOnboardingCapabilities();
  const command = useOnboardingCommand();

  const [step, setStep] = useState<WizardStep | null>(null);
  const [identity, setIdentity] = useState<Partial<OnboardingIdentity>>({});
  const [source, setSource] = useState<Partial<OnboardingSource>>({});
  const [codeTouched, setCodeTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [localStale, setLocalStale] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [syncedRevision, setSyncedRevision] = useState<string | null>(null);
  const provisionFired = useRef(false);
  const seenStatus = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Adopt the server state whenever a new revision arrives (initial load, reload-latest, command result).
  if (session && syncedRevision !== `${session.id}:${session.revision}`) {
    setSyncedRevision(`${session.id}:${session.revision}`);
    setIdentity({ ...session.draft.identity });
    setSource({ ...session.draft.source });
    setCodeTouched(session.draft.identity.code.length > 0);
  }

  const status = session?.status;
  const projectId = session?.projectId;

  // ready -> the Project Control Center (only when it became ready while this page was open).
  useEffect(() => {
    if (status === "ready" && projectId && seenStatus.current && seenStatus.current !== "ready") {
      navigate(`/projects/${encodeURIComponent(projectId)}`, { replace: true });
    }
    if (status) seenStatus.current = status;
  }, [status, projectId, navigate]);

  const effectiveStep: WizardStep | null = !session
    ? null
    : PROGRESS_STATUSES.includes(session.status) && session.status !== "approved"
      ? "progress"
      : (step ?? initialStep(session));

  // Move keyboard focus to the new step heading (skip the very first render).
  const previousStep = useRef<WizardStep | null>(null);
  useEffect(() => {
    if (previousStep.current && effectiveStep && previousStep.current !== effectiveStep) headingRef.current?.focus();
    previousStep.current = effectiveStep;
  }, [effectiveStep]);

  if (isLoading) {
    return (
      <div role="status" aria-label={tt("wizard.loading")} className="ob-stack">
        <Skeleton height={48} width="100%" />
        <Skeleton height={200} width="100%" />
      </div>
    );
  }
  if (error || !session || !effectiveStep) {
    const code = error instanceof OnboardingClientError ? error.code : "NETWORK";
    return (
      <ErrorState
        title={tt(code === "FORBIDDEN" ? "error.forbiddenTitle" : code === "NOT_FOUND" ? "wizard.notFoundTitle" : "wizard.loadErrorTitle")}
        description={error instanceof Error ? error.message : tt("wizard.loadErrorBody")}
        onRetry={() => void refetch()}
        retryLabel={tt("common.retry")}
        secondaryAction={<Link className="ob-link-button" to="/projects">{tt("common.backToProjects")}</Link>}
      />
    );
  }

  if (session.status === "cancelled") {
    return (
      <Notice tone="warning">
        <strong>{tt("wizard.cancelledTitle")}</strong> {tt("wizard.cancelledBody")}{" "}
        <Link className="ob-link-button" to="/projects">{tt("common.backToProjects")}</Link>
      </Notice>
    );
  }

  const editable = EDITABLE.includes(session.status);
  const pending = command.isPending;
  const planExists = Boolean(session.plan);
  const planStale =
    localStale || (planExists && (session.status === "source_configured" || session.status === "analyzed" || session.status === "analysis_failed"));
  const steps = stepsFor(session.mode);
  const goto = (next: WizardStep) => {
    setShowErrors(false);
    setStep(next);
  };
  const neighbours = (current: WizardStep) => {
    const list = GUIDED_STEPS as readonly WizardStep[];
    const i = list.indexOf(current);
    return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined };
  };

  const reload = () => {
    command.reset();
    void refetch();
  };

  const buildPatch = (): OnboardingPatch => {
    const cleanIdentity: Partial<OnboardingIdentity> = { ...identity };
    if (!cleanIdentity.owner?.trim()) delete cleanIdentity.owner;
    return { identity: cleanIdentity, source };
  };

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch {
      return undefined; // surfaced through command.error
    }
  };

  const saveDraft = () =>
    command.mutateAsync({ command: "onboarding_update", id: session.id, expectedRevision: session.revision, patch: buildPatch() });

  const validate = (keys: (keyof FieldErrors)[], requireObjective = false): boolean => {
    const all = validateIdentitySource(session.kind, identity, source, { requireObjective });
    const picked = pickErrors(all, keys);
    setErrors(picked);
    setShowErrors(true);
    return Object.keys(picked).length === 0;
  };

  const patchPlanInputs = async (patch: OnboardingPatch) => {
    const result = await run(() =>
      command.mutateAsync({ command: "onboarding_update", id: session.id, expectedRevision: session.revision, patch }),
    );
    if (result) setLocalStale(true);
    return result;
  };

  const analyze = (from: OnboardingSession) =>
    command.mutateAsync({ command: "onboarding_analyze", id: from.id, expectedRevision: from.revision });
  const generatePlan = (from: OnboardingSession) =>
    command.mutateAsync({ command: "onboarding_plan", id: from.id, expectedRevision: from.revision });

  const onAnalyze = async () => {
    const result = await run(() => analyze(session));
    if (result) setLocalStale(planExists);
  };
  const onGeneratePlan = async (thenStep?: WizardStep) => {
    const result = await run(() => generatePlan(session));
    if (result) {
      setLocalStale(false);
      if (thenStep) goto(thenStep);
    }
  };

  const onAutoRun = async () => {
    if (!validate(FIELD_ORDER, true)) return;
    const done = await run(async () => {
      const saved = await saveDraft();
      const analyzed = await analyze(saved);
      return generatePlan(analyzed);
    });
    if (done) {
      setLocalStale(false);
      goto("review");
    }
  };

  const onApprove = async () => {
    if (!session.plan) return;
    await run(() =>
      command.mutateAsync({
        command: "onboarding_approve_plan",
        id: session.id,
        expectedRevision: session.revision,
        planVersion: session.plan!.planVersion,
        planHash: session.plan!.planHash,
      }),
    );
  };

  /** Provisioning begins only here, exactly once per click sequence (the server is idempotent too). */
  const onProvision = async () => {
    if (!session.plan || provisionFired.current) return;
    provisionFired.current = true;
    const result = await run(() =>
      command.mutateAsync({
        command: "onboarding_provision",
        id: session.id,
        expectedRevision: session.revision,
        planHash: session.plan!.planHash,
      }),
    );
    if (result) setStep("progress");
    else provisionFired.current = false;
  };

  const onResume = async () => {
    if (!session.plan) return;
    await run(() =>
      command.mutateAsync({
        command: "onboarding_provision",
        id: session.id,
        expectedRevision: session.revision,
        planHash: (session.approval?.planHash ?? session.plan!.planHash),
      }),
    );
  };
  const onRevalidate = async () => {
    await run(() => command.mutateAsync({ command: "onboarding_revalidate", id: session.id, expectedRevision: session.revision }));
  };
  const onCancel = async () => {
    const result = await run(() =>
      command.mutateAsync({ command: "onboarding_cancel", id: session.id, expectedRevision: session.revision }),
    );
    setConfirmCancel(false);
    if (result) navigate("/projects");
  };

  const formErrors = showErrors
    ? FIELD_ORDER.filter((key) => errors[key]).map((key) => ({ id: FIELD_IDS[key], message: tt(`validation.${errors[key]}`) }))
    : [];

  const reachable = (candidate: WizardStep): boolean => {
    if (candidate === "identity" || candidate === "source" || candidate === "setup") return true;
    if (candidate === "analyze") return session.status !== "draft";
    return planExists;
  };

  const footer = (current: WizardStep, options: { onNext?: () => void; nextLabel?: string; nextDisabled?: boolean } = {}) => {
    const { prev, next } = neighbours(current);
    return (
      <div className="ob-actions ob-actions--sticky">
        {prev ? <Button type="button" disabled={pending} onClick={() => goto(prev)}>{tt("common.back")}</Button> : null}
        {next || options.onNext ? (
          <Button
            type="button"
            variant="primary"
            disabled={pending || options.nextDisabled}
            loading={pending && Boolean(options.onNext)}
            onClick={() => (options.onNext ? options.onNext() : next && goto(next))}
          >
            {options.nextLabel ?? tt("common.next")}
          </Button>
        ) : null}
      </div>
    );
  };

  const staleBanner = planStale ? (
    <Notice tone="warning">
      {tt("plan.stale")}{" "}
      <Button type="button" size="small" loading={pending} onClick={() => void onGeneratePlan()}>{tt("plan.regenerate")}</Button>
    </Notice>
  ) : null;

  const editorProps = { session, disabled: !editable, busy: pending, onPatch: patchPlanInputs };
  const editorKey = `${session.id}:${session.revision}`;

  const planBody = (current: WizardStep): ReactNode => {
    const plan = session.plan;
    if (!plan) {
      return (
        <div className="ob-stack">
          <Notice>{tt("plan.missing")}</Notice>
          <Button type="button" variant="primary" loading={pending} disabled={pending || !session.analysis} onClick={() => void onGeneratePlan()}>
            {tt("plan.generate")}
          </Button>
          {!session.analysis ? <p className="ob-muted">{tt("plan.needsAnalysis")}</p> : null}
        </div>
      );
    }
    switch (current) {
      case "technology":
        return (
          <div className="ob-stack">
            <TechnologyView plan={plan} />
            <Section id="st-arch" title={tt("step.architecture")}><ArchitectureView plan={plan} /></Section>
            <OverridesEditor key={editorKey} {...editorProps} />
          </div>
        );
      case "environments": return <EnvironmentsView plan={plan} />;
      case "workforce": return <WorkforceView plan={plan} />;
      case "permissions":
        return (
          <div className="ob-stack">
            <AutonomyView plan={plan} />
            <AutonomyEditor key={editorKey} {...editorProps} />
          </div>
        );
      case "integrations": return <IntegrationsView plan={plan} />;
      case "secrets": return <SecretsView plan={plan} />;
      case "git":
        return (
          <div className="ob-stack">
            <GitView plan={plan} />
            <GitEditor key={editorKey} {...editorProps} />
          </div>
        );
      case "pipeline": return <PipelineView plan={plan} />;
      case "deployment": return <DeploymentView plan={plan} />;
      case "budget":
        return (
          <div className="ob-stack">
            <CostView plan={plan} />
            <CostEditor key={editorKey} {...editorProps} />
          </div>
        );
      case "audit": return <GovernanceView plan={plan} />;
      default: return null;
    }
  };

  let body: ReactNode = null;

  if (effectiveStep === "identity") {
    body = (
      <form
        noValidate
        className="ob-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!validate(["name", "code"])) return;
          if (await run(saveDraft)) goto("source");
        }}
      >
        <ErrorSummary title={tt("validation.summary")} items={formErrors} />
        <IdentityFields value={identity} errors={showErrors ? errors : {}} disabled={!editable} codeTouched={codeTouched}
          onCodeTouched={() => setCodeTouched(true)} onChange={setIdentity} />
        <div className="ob-actions ob-actions--sticky">
          <Button type="submit" variant="primary" loading={pending} disabled={pending || !editable}>{tt("common.saveAndContinue")}</Button>
        </div>
      </form>
    );
  } else if (effectiveStep === "source") {
    body = (
      <form
        noValidate
        className="ob-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!validate(["repositoryUrl", "specification"])) return;
          if (await run(saveDraft)) goto("analyze");
        }}
      >
        <ErrorSummary title={tt("validation.summary")} items={formErrors} />
        <SourceFields kind={session.kind} value={source} errors={showErrors ? errors : {}} disabled={!editable}
          providers={capabilities?.providers} gapNote={capabilities?.gaps.find((g) => g.key.includes("repository"))?.note} onChange={setSource} />
        <div className="ob-actions ob-actions--sticky">
          <Button type="button" disabled={pending} onClick={() => goto("identity")}>{tt("common.back")}</Button>
          <Button type="submit" variant="primary" loading={pending} disabled={pending || !editable || session.kind === "import_local"}>
            {tt("common.saveAndContinue")}
          </Button>
        </div>
      </form>
    );
  } else if (effectiveStep === "setup") {
    body = (
      <form
        noValidate
        className="ob-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onAutoRun();
        }}
      >
        <Notice>{tt("wizard.autoIntro")}</Notice>
        <ErrorSummary title={tt("validation.summary")} items={formErrors} />
        <IdentityFields minimal value={identity} errors={showErrors ? errors : {}} disabled={!editable || pending} codeTouched={codeTouched}
          onCodeTouched={() => setCodeTouched(true)} onChange={setIdentity} />
        <SourceFields kind={session.kind} value={source} errors={showErrors ? errors : {}} disabled={!editable || pending}
          providers={capabilities?.providers} onChange={setSource} />
        <div className="ob-actions ob-actions--sticky">
          <Button type="submit" variant="primary" loading={pending} disabled={pending || !editable}>{tt("wizard.autoRun")}</Button>
          {session.plan ? <Button type="button" onClick={() => goto("review")}>{tt("wizard.goToReview")}</Button> : null}
        </div>
        {pending ? <p role="status" className="ob-muted">{tt("wizard.autoWorking")}</p> : null}
      </form>
    );
  } else if (effectiveStep === "analyze") {
    const analyzing = session.status === "analyzing";
    body = (
      <div className="ob-stack">
        {session.kind === "import_local" ? <Notice tone="warning">{tt("source.localUnavailable")}</Notice> : null}
        {analyzing || (pending && command.variables?.command === "onboarding_analyze") ? (
          <p role="status" className="ob-live">{tt("analysis.running")}</p>
        ) : null}
        {session.status === "analysis_failed" ? (
          <div role="alert" className="ob-alert ob-alert--danger" data-testid="analysis-failed">
            <strong>{tt("analysis.failedTitle")}</strong>
            <p>{session.failure?.message ?? tt("analysis.failedBody")}</p>
          </div>
        ) : null}
        {session.analysis && session.status !== "analysis_failed" ? <AnalysisView analysis={session.analysis} /> : null}
        {!session.analysis && !analyzing && session.status !== "analysis_failed" ? <p className="ob-muted">{tt("analysis.intro")}</p> : null}
        {staleBanner}
        <div className="ob-actions ob-actions--sticky">
          <Button type="button" disabled={pending} onClick={() => goto("source")}>{tt("common.back")}</Button>
          <Button
            type="button"
            variant={session.analysis && session.status !== "analysis_failed" ? "secondary" : "primary"}
            loading={pending && command.variables?.command === "onboarding_analyze"}
            disabled={pending || analyzing || !editable || session.kind === "import_local"}
            onClick={() => void onAnalyze()}
          >
            {session.status === "analysis_failed" ? tt("analysis.retry") : session.analysis ? tt("analysis.rerun") : tt("analysis.run")}
          </Button>
          {session.analysis && session.status !== "analysis_failed" ? (
            <Button type="button" variant="primary" loading={pending && command.variables?.command === "onboarding_plan"}
              disabled={pending || !editable} onClick={() => void onGeneratePlan("technology")}>
              {planExists ? tt("plan.regenerate") : tt("plan.generate")}
            </Button>
          ) : null}
          {planExists && !planStale ? <Button type="button" disabled={pending} onClick={() => goto("technology")}>{tt("common.next")}</Button> : null}
        </div>
      </div>
    );
  } else if (PLAN_STEPS.includes(effectiveStep)) {
    body = (
      <div className="ob-stack">
        {staleBanner}
        {planBody(effectiveStep)}
        {footer(effectiveStep)}
      </div>
    );
  } else if (effectiveStep === "review") {
    body = (
      <ReviewStep
        session={session}
        planStale={planStale}
        pending={pending}
        onBack={() => goto(session.mode === "auto" ? "setup" : "audit")}
        onRegenerate={() => void onGeneratePlan()}
        onApprove={() => void onApprove()}
        onProvision={() => void onProvision()}
      />
    );
  } else if (effectiveStep === "progress") {
    body = <ProvisioningProgress session={session} pending={pending} onResume={() => void onResume()} onRevalidate={() => void onRevalidate()} />;
  }

  const cancellable = !["provisioning", "validating", "ready"].includes(session.status);

  return (
    <div className="ob-wizard">
      <div className="ob-wizard__meta">
        <span className="ob-muted">
          {tt(session.mode === "auto" ? "mode.auto" : "mode.guided")} | {tt(`kind.${session.kind}`)} | {tt(`status.${session.status}`)}
        </span>
        {cancellable ? (
          <Button type="button" variant="ghost" size="small" onClick={() => setConfirmCancel(true)} disabled={pending}>
            {tt("cancel.action")}
          </Button>
        ) : null}
      </div>

      {session.mode === "guided" || effectiveStep === "progress" ? (
        <Stepper steps={effectiveStep === "progress" ? [...GUIDED_STEPS, "progress"] : steps} current={effectiveStep} reachable={reachable} onSelect={goto} />
      ) : null}

      <h2 ref={headingRef} tabIndex={-1} className="ob-step-title">{tt(`step.${effectiveStep}`)}</h2>

      <CommandError error={command.error} onReload={reload} onDismiss={() => command.reset()} />
      {body}

      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={tt("cancel.title")}
        description={tt("cancel.body")}
      >
        <div className="ob-actions">
          <Button type="button" onClick={() => setConfirmCancel(false)}>{tt("cancel.keep")}</Button>
          <Button type="button" variant="danger" loading={pending} onClick={() => void onCancel()}>{tt("cancel.confirm")}</Button>
        </div>
      </Dialog>
    </div>
  );
}
