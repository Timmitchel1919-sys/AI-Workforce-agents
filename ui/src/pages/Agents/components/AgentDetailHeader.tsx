import { Link } from "react-router-dom";
import {
  Badge,
  Identifier,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { Stack } from "../../../components/layout";
import type { AgentListItem } from "../agentsView";

/**
 * The agent detail masthead: status, id, and the quick-facts row (project,
 * last updated). Only fields the `AgentView` contract actually carries are
 * shown — there is no description, model, or provider on the contract, so
 * those read "Not available" rather than being invented. The page title
 * itself (agent name) and the primary action are owned by `PageFrame`.
 */
export function AgentDetailHeader({ agent }: { agent: AgentListItem }) {
  return (
    <Stack gap="sm">
      <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
        <StatusBadge status={agent.status} />
        {!agent.enabled ? <Badge tone="warning">Disabled</Badge> : null}
        <Identifier value={agent.id} />
      </div>

      {agent.disabledReason ? (
        <p className="text-caption">Disabled reason: {agent.disabledReason}</p>
      ) : null}

      <dl className="agent-detail-facts">
        <div>
          <dt className="text-label">Role / type</dt>
          <dd>{agent.role || "Not available"}</dd>
        </div>
        <div>
          <dt className="text-label">Model</dt>
          <dd>Not available</dd>
        </div>
        <div>
          <dt className="text-label">Provider</dt>
          <dd>Not available</dd>
        </div>
        <div>
          <dt className="text-label">Project</dt>
          <dd>
            {agent.currentProjectId ? (
              <Link
                to={`/projects/${encodeURIComponent(agent.currentProjectId)}`}
                className="link"
              >
                {agent.currentProjectId}
              </Link>
            ) : (
              "Not available"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-label">Updated</dt>
          <dd>
            {agent.lastActivityAt ? (
              <Timestamp value={agent.lastActivityAt} relative />
            ) : (
              "Not available"
            )}
          </dd>
        </div>
      </dl>
    </Stack>
  );
}
