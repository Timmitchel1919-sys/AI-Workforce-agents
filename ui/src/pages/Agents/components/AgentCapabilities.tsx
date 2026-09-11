import { Badge, EmptyState } from "../../../components/ui";

/**
 * Capability badges for one agent. Renders only capabilities the Control
 * Plane actually reported (`AgentView.capabilities`) — never a hardcoded
 * catalog. An agent with no reported capabilities gets an explicit empty
 * state rather than a blank card.
 */
export function AgentCapabilities({
  capabilities,
}: {
  capabilities: readonly string[];
}) {
  if (capabilities.length === 0) {
    return (
      <EmptyState
        title="No capabilities reported"
        detail="The Control Plane has not reported any capabilities for this agent."
      />
    );
  }

  return (
    <span className="agent-caps">
      {capabilities.map((c) => (
        <Badge key={c} tone="neutral">
          {c}
        </Badge>
      ))}
    </span>
  );
}
