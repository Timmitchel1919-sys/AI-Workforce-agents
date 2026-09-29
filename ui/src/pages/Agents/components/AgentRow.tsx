import { Link } from "react-router-dom";
import { formatDateTime, useI18n } from "../../../i18n";
import { Badge } from "../../../components/ui";
import type { AgentListItem } from "../../../features/agents";
import { AxisBadges, PolicyBadgeList } from "./agentPresentation";

export function AgentRow({ agent }: { agent: AgentListItem }) {
  const { t, language } = useI18n();
  const agentHref = `/agents/${agent.id}`;
  const specialist = agent.specialist;

  // A legacy flat agent has no model policy, no project scope and no
  // limitations. That is reported as "no specialist profile", never rendered
  // with blank cells that read like a healthy agent with no constraints.
  const modelLabel = specialist
    ? specialist.modelPolicy.model ?? specialist.modelPolicy.provider
    : t("common.unavailable");

  const assignmentLabel = specialist?.currentAssignmentId
    ? specialist.currentTaskId ?? specialist.currentAssignmentId
    : t("agents.noAssignment");

  return (
    <tr className="agent-row">
      <td className="agent-row__cell agent-row__cell--primary">
        <Link
          to={agentHref}
          className="agent-row__link"
          aria-label={t("common.viewDetails", { name: agent.name })}
        >
          <div className="agent-row__name-block">
            <span className="agent-row__name">{agent.name}</span>
            {agent.description ? (
              <span className="agent-row__description">{agent.description}</span>
            ) : null}
            <span className="agent-row__scope">
              {specialist ? (
                <>
                  <Badge variant="info">{t("agents.specialists")}</Badge>
                  <span>{specialist.department}</span>
                  <span>·</span>
                  <span>
                    {t("agents.descriptorVersion")} {specialist.descriptorVersion}
                  </span>
                </>
              ) : (
                <Badge variant="warning">{t("agents.legacyAgentTitle")}</Badge>
              )}
            </span>
          </div>
        </Link>
      </td>
      <td className="agent-row__cell">
        <AxisBadges agent={agent} t={t} />
      </td>
      <td className="agent-row__cell agent-row__cell--muted">{modelLabel}</td>
      <td className="agent-row__cell">
        <PolicyBadgeList
          values={agent.capabilities}
          variant="info"
          emptyLabel={t("agents.noCapabilities")}
        />
      </td>
      <td className="agent-row__cell agent-row__cell--muted">
        {specialist?.currentAssignmentId ? (
          <span className="agent-row__assignment">{assignmentLabel}</span>
        ) : (
          <span className="agent-row__muted">{t("agents.noAssignment")}</span>
        )}
      </td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.taskCount}</td>
      <td className="agent-row__cell agent-row__cell--muted">
        {formatDateTime(agent.lastActivityAt, language) ?? t("common.notReported")}
      </td>
    </tr>
  );
}

export default AgentRow;
