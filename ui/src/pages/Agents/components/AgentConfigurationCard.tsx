import { KeyValue } from "../../../components/ui";
import { Stack } from "../../../components/layout";
import type { AgentListItem } from "../agentsView";

/**
 * Configuration summary — only fields the `AgentView` contract exposes and
 * that are safe to show an operator. The contract carries no model,
 * provider, temperature, tool, or runtime configuration for agents, and it
 * NEVER carries credentials or secrets — so none of those appear here.
 *
 * The Control Plane has no `configure_agent` command yet (see
 * `agentActions.ts`'s operation matrix), so this stays read-only rather than
 * a fabricated editor.
 */
export function AgentConfigurationCard({ agent }: { agent: AgentListItem }) {
  return (
    <Stack gap="sm">
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
      <p className="text-caption">
        Configuration management is not available yet.
      </p>
    </Stack>
  );
}
