import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderGit2, FolderInput, Sparkles } from "lucide-react";
import { Button, ErrorState, Skeleton } from "../../../components/ui";
import { useOnboardingCapabilities, useOnboardingCommand } from "../hooks/useOnboarding";
import { useT } from "../lib/useT";
import type { OnboardingKind, OnboardingMode } from "../types";
import { CommandError, Notice, Tag } from "./common";

const KIND_ICON = {
  create_new: <Sparkles size={22} aria-hidden />,
  import_existing: <FolderGit2 size={22} aria-hidden />,
  import_local: <FolderInput size={22} aria-hidden />,
} as const;
const KINDS: OnboardingKind[] = ["create_new", "import_existing", "import_local"];
const MODES: OnboardingMode[] = ["guided", "auto"];

/** Selecting only creates a DRAFT onboarding session; no project exists until provisioning succeeds. */
export function EntryScreen() {
  const { tt } = useT();
  const navigate = useNavigate();
  const { capabilities, isLoading, error, refetch } = useOnboardingCapabilities();
  const command = useOnboardingCommand();
  const [kind, setKind] = useState<OnboardingKind>("import_existing");
  const [mode, setMode] = useState<OnboardingMode>("guided");

  if (isLoading) {
    return (
      <div role="status" aria-label={tt("entry.loading")} className="ob-stack">
        <Skeleton height={120} width="100%" />
        <Skeleton height={120} width="100%" />
      </div>
    );
  }
  if (error || !capabilities) {
    return (
      <ErrorState
        title={tt("entry.errorTitle")}
        description={error instanceof Error ? error.message : tt("entry.errorBody")}
        onRetry={() => void refetch()}
        retryLabel={tt("common.retry")}
      />
    );
  }
  if (!capabilities.canCreate) {
    return <Notice tone="warning"><strong>{tt("entry.deniedTitle")}</strong> {tt("entry.deniedBody")}</Notice>;
  }

  const kindStatus = (k: OnboardingKind) => capabilities.kinds.find((c) => c.kind === k);
  const selectedAvailable = kindStatus(kind)?.available ?? false;

  const create = () => {
    if (!selectedAvailable || command.isPending) return;
    command.mutate(
      { command: "onboarding_create", mode, kind },
      { onSuccess: (session) => navigate(`/projects/onboarding/${encodeURIComponent(session.id)}`) },
    );
  };

  return (
    <form
      className="ob-stack"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <fieldset className="ob-fieldset">
        <legend className="ob-legend">{tt("entry.howStart")}</legend>
        <div className="ob-choice-grid">
          {KINDS.map((k) => {
            const info = kindStatus(k);
            const available = info?.available ?? false;
            return (
              <label key={k} className={`ob-choice${kind === k ? " is-selected" : ""}${available ? "" : " is-disabled"}`}>
                <input type="radio" name="onboarding-kind" value={k} checked={kind === k} disabled={!available} onChange={() => setKind(k)} />
                <span className="ob-choice__body">
                  <span className="ob-choice__title">{KIND_ICON[k]} {tt(`kind.${k}`)}</span>
                  <span className="ob-muted ob-block">{tt(`entry.kindHelp.${k}`)}</span>
                  {available ? null : (
                    <span className="ob-block">
                      <Tag tone="warning">{tt("entry.unavailable")}</Tag>{" "}
                      <span className="ob-muted" data-testid={`kind-note-${k}`}>{info?.note ?? tt("entry.unavailableNoNote")}</span>
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="ob-fieldset">
        <legend className="ob-legend">{tt("entry.modeLegend")}</legend>
        <div className="ob-choice-grid ob-choice-grid--two">
          {MODES.map((m) => (
            <label key={m} className={`ob-choice${mode === m ? " is-selected" : ""}`}>
              <input type="radio" name="onboarding-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              <span className="ob-choice__body">
                <span className="ob-choice__title">{tt(`mode.${m}`)}</span>
                <span className="ob-muted ob-block">{tt(`entry.modeHelp.${m}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Notice>{tt("entry.draftNote")}</Notice>
      <CommandError error={command.error} onDismiss={() => command.reset()} />

      <div className="ob-actions">
        <Button type="submit" variant="primary" loading={command.isPending} disabled={!selectedAvailable || command.isPending}>
          {tt("entry.continue")}
        </Button>
      </div>
    </form>
  );
}
