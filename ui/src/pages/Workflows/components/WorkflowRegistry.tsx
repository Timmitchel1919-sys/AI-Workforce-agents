import { Table } from "../../../components/ui";
import type { WorkflowView } from "../../../features/workflows";
import { WorkflowRow } from "./WorkflowRow";

export function WorkflowRegistry({ workflows }: { workflows: readonly WorkflowView[] }) {
  return (
    <div className="workflows-registry">
      <Table caption="Workflow registry">
        <thead>
          <tr>
            <th scope="col">Workflow</th>
            <th scope="col">Status</th>
            <th scope="col">Progress</th>
            <th scope="col">Agents</th>
            <th scope="col">Project</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => (
            <WorkflowRow key={workflow.workflowId} workflow={workflow} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default WorkflowRegistry;
