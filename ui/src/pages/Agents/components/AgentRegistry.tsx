import { Table } from "../../../components/ui";
import type { AgentListItem } from "../../../features/agents";
import { AgentRow } from "./AgentRow";

export function AgentRegistry({ agents }: { agents: AgentListItem[] }) {
  return (
    <div className="agents-registry">
      <Table caption="Agent registry">
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Status</th>
            <th scope="col">Model</th>
            <th scope="col">Capabilities</th>
            <th scope="col">Tasks</th>
            <th scope="col">Health</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default AgentRegistry;
