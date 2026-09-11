import { useState } from "react";
import { Button, Dialog, Field, Textarea, Alert } from "../../../components/ui";
import { Ban, Power } from "../../../components/ui/icons";
import { useToast } from "../../../components/ui";
import { useAuth } from "../../../auth/useAuth";
import { can } from "../../../auth/permissions";
import { useDisableAgent, useEnableAgent } from "../../../features/agents";
import { isApiError, safeErrorMessage } from "../../../api";
import type { AgentListItem } from "../agentsView";

/**
 * The only control action exposed in the first Agents UI: enable / disable an
 * agent. Both are non-destructive, reversible, and already governed by the
 * Control Plane (authorization + `control_command` audit). The action is
 * permission-gated for UX only — the backend re-checks — and confirmed through
 * a dialog. No optimistic state: the server result is authoritative.
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
  const disable = useDisableAgent();
  const enable = useEnableAgent();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const willDisable = agent.enabled;
  const capability = willDisable ? "disable_agent" : "enable_agent";
  if (!can(role, capability)) return null;

  const mutation = willDisable ? disable : enable;

  function close() {
    setOpen(false);
    setReason("");
    setErrorText(null);
  }

  async function confirm() {
    setErrorText(null);
    try {
      const result = await mutation.mutateAsync({
        agentId: agent.id,
        reason: reason.trim() || undefined,
      });
      toast({
        tone: "success",
        title: willDisable ? "Agent disabled" : "Agent enabled",
        detail: result.reason || undefined,
      });
      close();
      onChanged();
    } catch (err) {
      const conflict = isApiError(err) && err.category === "conflict";
      if (conflict) onChanged();
      setErrorText(
        conflict
          ? "This agent changed since the page loaded. It has been refreshed — review and try again."
          : safeErrorMessage(err),
      );
    }
  }

  return (
    <>
      <Button
        variant={willDisable ? "danger" : "primary"}
        size="sm"
        iconLeft={willDisable ? Ban : Power}
        onClick={() => setOpen(true)}
      >
        {willDisable ? "Disable agent" : "Enable agent"}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={willDisable ? "Disable this agent?" : "Enable this agent?"}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={willDisable ? "danger" : "primary"}
              size="sm"
              loading={mutation.isPending}
              onClick={() => void confirm()}
            >
              {willDisable ? "Disable agent" : "Enable agent"}
            </Button>
          </>
        }
      >
        <p className="text-body-sm">
          {willDisable
            ? `"${agent.name}" will stop being assigned new work. Running tasks are unaffected. You can re-enable it later.`
            : `"${agent.name}" will become eligible for task assignment again.`}
        </p>
        <Field label="Reason (optional)" htmlFor="agent-action-reason">
          <Textarea
            id="agent-action-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Recorded in the audit trail"
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
