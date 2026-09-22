import { Table } from "../../../components/ui";
import type { TaskListItem } from "../../../features/tasks";
import { TaskRow } from "./TaskRow";

export function TaskRegistry({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <div className="tasks-registry">
      <Table caption="Task registry">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assigned Agent</th>
            <th scope="col">Project / Type</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default TaskRegistry;

