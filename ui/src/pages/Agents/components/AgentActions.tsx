import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  Field,
  Textarea,
  useToast,
} from "../../../components/ui";
import { Ban, Power, type LucideIcon } from "../../../components/ui/icons";
import { useAuth } from "../../../auth/useAuth";
import { useAgentActions } from "../../../features/agents";
import { isApiError, safeErrorMessage } from "../../../api";
import {
  agentActionConsequence,
  agentActionDialogTitle,
  agentActionLabel,
  availableAgentActions,
  type AgentAction,
} from "../agentActions";
import type { AgentListItem } from "../agentsView";

const ACTION_ICON: Record<AgentAction, LucideIcon> = {
  disable: Ban,
  enable: Power,
};

/** A safe, specific message for the confirmation dialog's failure states. */
function describeFailure(err: unknown): string {
  if (isApiError(err)) {
    if (err.category === "unauthenticated") {
      return "Your session has expired. Sign in again to continue.";
    }
    if (err.category === "forbidden") {
      return "You are not authorized to perform this action.";
    }
    if (err.category === "conflict") {
      return "This agent changed since the page loaded. It has been refreshed — review and try again.";
    }
  }
  return safeErrorMessage(err);
}

/**
 * Agent lifecycle controls (UI-5C).
 *
 *   AgentActions → useAgentActions() → agentsApi.* → ApiClient → Control Plane
 *
 * Only `disable` / `enable` exist on the backend today (see `agentActions.ts`
 * for the full operation matrix) — both non-destructive and reversible,
 * both already governed end-to-end by the Control Plane (authorization +
 * `control_command` audit). Availability is derived from the agent's current
 * status and the operator's role, never hardcoded; the Control Plane still
 * re-validates every request. No optimistic state: a successful command
 * invalidates the agent queries and the caller (`onChanged`) refetches —
 * the rendered status always comes from the server.
 */
export function AgentActions({
  agent,
  onChanged,
}: {
  agent: AgentListItem;
  onChanged: () => void;
}) {
  const { role } = useAuth();
  const { toast } = useToast();
  const { execute, status } = useAgentActions();

  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null);
  const [reason, setReason] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const actions = availableAgentActions(agent, role);
  if (actions.length === 0) return null;

  const submitting = status === "pending";

  function openDialog(action: AgentAction) {
    setPendingAction(action);
    setReason("");
    setErrorText(null);
  }

  function closeDialog() {
    if (submitting) return; // don't dismiss mid-flight
    setPendingAction(null);
    setReason("");
    setErrorText(null);
  }

  async function confirm() {
    if (!pendingAction || submitting) return;
    setErrorText(null);
    try {
      const result = await execute(pendingAction, {
        agentId: agent.id,
        reason: reason.trim() || undefined,
      });
      toast({
        tone: "success",
        title: pendingAction === "disable" ? "Agent disabled" : "Agent enabled",
        detail: result.reason || undefined,
      });
      setPendingAction(null);
      setReason("");
      onChanged();
    } catch (err) {
      if (isApiError(err) && err.category === "conflict") onChanged();
      setErrorText(describeFailure(err));
    }
  }

  // Exactly one action ever applies at a time (an agent is either enabled or
  // disabled), so a single visible button — not a "More" menu — is the
  // correct affordance. The action-list shape stays ready for a future
  // second concurrently-valid action without a rewrite.
  const primary = actions[0]!;
  const Icon = ACTION_ICON[primary];

  return (
    <>
      <Button
        variant={primary === "disable" ? "danger" : "primary"}
        size="sm"
        iconLeft={Icon}
        onClick={() => openDialog(primary)}
        disabled={submitting}
      >
        {agentActionLabel(primary)}
      </Button>

      <Dialog
        open={pendingAction !== null}
        onClose={closeDialog}
        title={
          pendingAction ? agentActionDialogTitle(pendingAction, agent) : ""
        }
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant={pendingAction === "disable" ? "danger" : "primary"}
              size="sm"
              loading={submitting}
              disabled={submitting}
              onClick={() => void confirm()}
            >
              {pendingAction ? agentActionLabel(pendingAction) : ""}
            </Button>
          </>
        }
      >
        <p className="text-body-sm">
          {pendingAction ? agentActionConsequence(pendingAction, agent) : ""}
        </p>
        <Field label="Reason (optional)" htmlFor="agent-action-reason">
          <Textarea
            id="agent-action-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Recorded in the audit trail"
            disabled={submitting}
          />
        </Field>
        {errorText ? (
          <Alert tone="danger" title="The command did not run">
            {errorText}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
