import { useEffect, useId, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../../i18n";
import type { CommandPhase } from "../hooks/useNodeCommand";
import type { NodeAction } from "../lib/nodeActions";

interface Props {
  state: CommandPhase;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
  /** Where focus goes on close if the element that opened the dialog no longer exists. */
  restoreFocusTo?: () => HTMLElement | null;
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation + result for a spatial command. It is rendered INSIDE the workspace, so Focus Mode's
 * inert siblings can never hide it, and it is a real modal dialog: initial focus lands on the SAFE
 * choice, Tab is trapped, Escape closes only this dialog (never Focus Mode), and focus returns to
 * where it came from. While a request is in flight nothing can be dismissed or resubmitted.
 */
export function CommandConfirmDialog({ state, onConfirm, onCancel, onDismiss, restoreFocusTo }: Props) {
  const { t } = useI18n();
  const open = state.phase !== "idle";
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const phase = state.phase;
  const action = state.phase === "idle" ? null : state.action;

  // Remember the opener; restore focus when the dialog closes.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      // The opener may be gone by now (a cancelled task no longer offers its button, a pruned node
      // has no inspector): never let focus fall to <body>.
      const opener = returnFocus.current;
      // <body> is "nothing was focused" (e.g. the trigger was activated without taking focus), not an opener.
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
      else restoreFocusTo?.()?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restoreFocusTo is read at close time only
  }, [open]);

  // Focus: safe choice while confirming; the Close button once a result is shown.
  useEffect(() => {
    if (phase === "confirming") cancelRef.current?.focus();
    if (phase === "done") closeRef.current?.focus();
    // The buttons unmount while a request is in flight; keep focus (and so the Tab trap and the
    // Escape guard) inside the dialog instead of dropping it to the page behind.
    if (phase === "requesting") dialogRef.current?.focus();
  }, [phase]);

  if (state.phase === "idle" || !action) return null;
  const busy = state.phase === "requesting";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // Consumed here: it must not also exit Focus Mode.
      e.preventDefault();
      e.stopPropagation();
      if (state.phase === "confirming") onCancel();
      else if (state.phase === "done") onDismiss();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      // Nothing focusable (a request is in flight): Tab must not escape to the page behind.
      e.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const key = (suffix: string) => `spatial.command.${suffix}` as MessageKey;

  return (
    <div
      className="sg-cmd-overlay"
      data-testid="sg-command-dialog"
      // A click on the dimmed backdrop must not move focus out to the page behind it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        className="sg-cmd-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="sg-panel__title">
          {t(key(`title.${action.command}`))}
        </h2>
        <p id={descId}>{t(key(`description.${action.command}`), { label: state.nodeLabel })}</p>

        {state.phase === "confirming" && (
          // Keyed per target so a new confirmation always starts with an empty reason.
          <ConfirmBody
            key={`${action.command}:${action.targetId}`}
            action={action}
            cancelRef={cancelRef}
            onCancel={onCancel}
            onConfirm={onConfirm}
            keyOf={key}
          />
        )}

        {state.phase === "requesting" && (
          <p role="status" data-testid="sg-command-requesting">
            {t(key("requesting"))}
          </p>
        )}

        {state.phase === "done" && (
          <>
            <div role="status" data-testid="sg-command-result" data-outcome={state.result.ok ? "ok" : state.result.kind}>
              {state.result.ok ? (
                <>
                  <p>
                    {t(key(state.result.inProgress ? "resultInProgress" : state.result.noChange ? "resultNoChange" : "resultOk"), {
                      reason: state.result.reason,
                    })}
                  </p>
                  {state.result.followUpIssues.length > 0 && (
                    <p role="alert" data-testid="sg-command-followup">
                      {t(key("followUpIncomplete"), {
                        steps: state.result.followUpIssues.map((i) => t(key(`followUp.${i}`))).join(", "),
                      })}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    <strong>{t(key(`failure.${state.result.kind}`))}</strong>
                  </p>
                  <p>{state.result.reason}</p>
                  {(state.result.kind === "unknown_outcome" || state.result.kind === "network") && (
                    <p className="sg-muted">{t(key("checkBeforeRetry"))}</p>
                  )}
                </>
              )}
              <p className="sg-muted">{t(key("reference"), { id: state.result.correlationId })}</p>
            </div>
            <div className="sg-cmd-actions">
              <button ref={closeRef} type="button" className="sg-btn" onClick={onDismiss}>
                {t(key("close"))}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmBody({
  action,
  cancelRef,
  onCancel,
  onConfirm,
  keyOf,
}: {
  action: NodeAction;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  keyOf: (suffix: string) => MessageKey;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const needsReason = action.reason !== "none";
  const reasonMissing = action.reason === "required" && reason.trim() === "";
  return (
    <>
      {needsReason && (
        <label className="sg-cmd-field">
          <span>{t(keyOf(action.reason === "required" ? "reasonRequired" : "reasonOptional"))}</span>
          <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <p className="sg-muted">{t(keyOf("staleNote"))}</p>
      <div className="sg-cmd-actions">
        {/* The safe choice comes first and takes initial focus. */}
        <button ref={cancelRef} type="button" className="sg-btn" onClick={onCancel}>
          {t(keyOf("keep"))}
        </button>
        <button
          type="button"
          className={action.destructive ? "sg-btn sg-btn--danger" : "sg-btn sg-btn--primary"}
          disabled={reasonMissing}
          onClick={() => onConfirm(reason)}
        >
          {t(keyOf(`confirm.${action.command}`))}
        </button>
      </div>
    </>
  );
}
