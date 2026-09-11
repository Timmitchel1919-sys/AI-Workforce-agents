import { KeyValue } from "../../../components/ui";
import type { AgentListItem } from "../agentsView";

/**
 * Configuration summary — only fields the `AgentView` contract exposes and
 * that are safe to show an operator. The contract carries no model,
 * provider, temperature, tool, or runtime configuration for agents, and it
 * NEVER carries credentials or secrets — so none of those appear here.
 */
export function AgentConfigurationCard({ agent }: { agent: AgentListItem }) {
  return (
    <KeyValue
      rows={[
        { key: "Role", value: agent.role || "Not available" },
        {
          key: "Allowed projects",
          value:
            agent.allowedProjects.length > 0
              ? agent.allowedProjects.join(", ")
              : "Not available",
        },
        {
          key: "Assignable",
          value: agent.enabled ? "Yes" : "No (disabled)",
        },
      ]}
    />
  );
}
