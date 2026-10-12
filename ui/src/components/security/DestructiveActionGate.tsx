import { useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Dialog, Button, Input, Alert } from "../ui";
import { useApprovalDecision, type ApprovalItem } from "../../features/governance";

export interface DestructiveActionGateProps {
  approval: ApprovalItem;
  isOpen: boolean;
  onClose: () => void;
  onDecided?: () => void;
}

export function DestructiveActionGate({ approval, isOpen, onClose, onDecided }: DestructiveActionGateProps) {
  const [confirmText, setConfirmText] = useState("");
  const decision = useApprovalDecision();

  const isDestructive = approval.risk === "high";
  const requiredConfirmText = "CONFIRM";
  
  const canApprove = !isDestructive || confirmText === requiredConfirmText;

  const handleApprove = async () => {
    if (!canApprove) return;
    try {
      await decision.mutateAsync({ decision: "approve", approvalId: approval.approvalId });
      onDecided?.();
      onClose();
    } catch (e) {
      // Error is handled by react-query / global handler
    }
  };

  const handleReject = async () => {
    try {
      await decision.mutateAsync({ decision: "reject", approvalId: approval.approvalId, reason: "Rejected by operator" });
      onDecided?.();
      onClose();
    } catch (e) {
      // Error handled
    }
  };

  return (
    <Dialog 
      open={isOpen} 
      onClose={onClose} 
      title={
        <div className="flex items-center gap-2 text-danger">
          {isDestructive ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
          {isDestructive ? "Destructive Action Approval Gate" : "Action Requires Approval"}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">
          An agent has requested to execute a high-risk action that requires human approval.
        </p>
        
        <div className="bg-surface-alt p-4 rounded-md border border-border">
          <div className="font-semibold mb-2">Action Details</div>
          <div className="text-sm space-y-1">
            <div className="flex"><span className="text-muted-foreground w-24">Action:</span> <span>{approval.action}</span></div>
            <div className="flex"><span className="text-muted-foreground w-24">Risk Level:</span> <span className={`capitalize ${isDestructive ? 'text-danger' : 'text-warning'}`}>{approval.risk}</span></div>
            <div className="flex"><span className="text-muted-foreground w-24">Reason:</span> <span>{approval.reason}</span></div>
          </div>
        </div>

        {isDestructive && (
          <Alert variant="danger">
            This action is highly destructive and may lead to data loss or significant environment changes.
          </Alert>
        )}

        {isDestructive && (
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-sm font-medium">
              Type <strong>{requiredConfirmText}</strong> to proceed:
            </label>
            <Input 
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={requiredConfirmText}
            />
          </div>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" onClick={handleReject} loading={decision.isPending}>
            Reject Action
          </Button>
          <Button 
            variant="danger" 
            onClick={handleApprove} 
            disabled={!canApprove}
            loading={decision.isPending}
          >
            Approve Action
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

