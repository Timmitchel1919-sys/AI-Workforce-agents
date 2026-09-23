import { Table } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import type { TaskListItem } from "../../../features/tasks";
import { TaskRow } from "./TaskRow";

export function TaskRegistry({ tasks }: { tasks: TaskListItem[] }) {
  const { t } = useI18n();
  return (
    <div className="tasks-registry">
      <Table caption={t("tasks.registry")}>
        <thead>
          <tr>
            <th scope="col">{t("tasks.colTask")}</th>
            <th scope="col">{t("common.status")}</th>
            <th scope="col">{t("common.priority")}</th>
            <th scope="col">{t("tasks.colAgent")}</th>
            <th scope="col">{t("tasks.colProjectType")}</th>
            <th scope="col">{t("common.updated")}</th>
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

