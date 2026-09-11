import { Link } from "react-router-dom";
import { Badge, KeyValue, Spinner, Timestamp } from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { useAuth } from "../../../auth/useAuth";
import { isApiError } from "../../../api";
import { accessLevelLabel, agentPermissions } from "../governance";
import { useAgentGovernance } from "../useAgentGovernance";
import type { AgentListItem } from "../agentsView";

/**
 * Governance summary (UI-5E): the operator's own access level, which real
 * Control Plane capabilities they hold for this agent, and whether the
 * agent's current task is blocked on a pending approval. This is a
 * *representation* of Control-Plane-issued authorization state — it is not
 * itself a security boundary, and every action still re-validates against
 * the backend regardless of what is shown here.
 *
 * Environment, ownership, and policy-compliance metadata are not part of
 * the `AgentView` contract (or any contract in this repository), so none of
 * that is fabricated — the card says so plainly instead.
 */
export function AgentGovernanceCard({ agent }: { agent: AgentListItem }) {
  const { role } = useAuth();
  const permissions = agentPermissions(role);
  const governance = useAgentGovernance(agent.currentTaskId);

  return (
    <Stack gap="md">
      <KeyValue
        rows={[{ key: "Your access level", value: accessLevelLabel(role) }]}
      />

      <div>
        <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>
          Permissions
        </p>
        <Stack gap="2xs">
          {permissions.map((p) => (
            <span
              key={p.capability}
              className="ui-inline"
              style={{
                justifyContent: "space-between",
                gap: "var(--space-sm)",
              }}
            >
              <span className="text-body-sm">{p.label}</span>
              <Badge tone={p.granted ? "success" : "neutral"}>
                {p.granted ? "Granted" : "Not granted"}
              </Badge>
            </span>
          ))}
        </Stack>
        <p className="text-caption" style={{ marginTop: "var(--space-2xs)" }}>
          Configuration and deletion are not yet supported by the Control Plane
          for agents — there is no permission to display for them.
        </p>
      </div>

      <div>
        <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>
          Approval status
        </p>
        {governance.isPending ? (
          <Spinner label="Checking for a pending approval" />
        ) : governance.isError ? (
          <p className="text-caption">
            {isApiError(governance.error) &&
            governance.error.category === "forbidden"
              ? "You do not have permission to view approval status."
              : "Approval status is unavailable right now."}
          </p>
        ) : governance.pendingApproval ? (
          <Stack gap="2xs">
            <Badge tone="warning">Approval required</Badge>
            <p className="text-body-sm">
              This agent&rsquo;s current task is awaiting approval before it can
              continue.
            </p>
            <KeyValue
              rows={[
                { key: "Action", value: governance.pendingApproval.action },
                { key: "Risk", value: governance.pendingApproval.risk },
                {
                  key: "Requested by",
                  value: governance.pendingApproval.requestedBy,
                },
                {
                  key: "Requested",
                  value: (
                    <Timestamp
                      value={governance.pendingApproval.requestedAt}
                      relative
                    />
                  ),
                },
              ]}
            />
            <Link to="/approvals" className="link">
              View approval
            </Link>
          </Stack>
        ) : (
          <p className="text-caption">
            No approval pending for this agent&rsquo;s current task.
          </p>
        )}
      </div>

      <p className="text-caption">
        Environment, ownership, and policy-compliance metadata are not yet
        exposed by the Control Plane for agents.
      </p>
    </Stack>
  );
}
