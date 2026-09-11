import { Link } from "react-router-dom";
import { KeyValue, Metric, MetricGroup } from "../../../components/ui";
import { Stack } from "../../../components/layout";
import { formatSuccessRate, type AgentListItem } from "../agentsView";

/**
 * Current workload — real counters from `AgentView.stats` plus the single
 * in-flight task the contract tracks (`currentTaskId`). There is no queued-
 * task count or current-workflow field on the contract, so those are not
 * shown rather than guessed.
 */
export function AgentWorkloadCard({ agent }: { agent: AgentListItem }) {
  return (
    <Stack gap="md">
      <MetricGroup>
        <Metric label="Tasks" value={agent.taskCount} />
        <Metric label="Completed" value={agent.completed} />
        <Metric label="Failed" value={agent.failed} />
        <Metric
          label="Success rate"
          value={formatSuccessRate(agent.successRate)}
        />
      </MetricGroup>
      <KeyValue
        rows={[
          {
            key: "Current task",
            value: agent.currentTaskId ? (
              <Link
                to={`/tasks/${encodeURIComponent(agent.currentTaskId)}`}
                className="link"
              >
                {agent.currentTaskId}
              </Link>
            ) : (
              "None"
            ),
          },
          { key: "Cancelled", value: agent.cancelled },
        ]}
      />
    </Stack>
  );
}
