import { Skeleton } from "../../../components/ui";

export function TaskLoadingState() {
  return (
    <div className="tasks-loading" role="status" aria-live="polite" aria-label="Loading tasks">
      <div className="tasks-loading__header">
        <Skeleton height={22} width="26%" />
        <Skeleton height={14} width="42%" />
      </div>

      <div className="tasks-loading__metrics">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="tasks-loading__metric">
            <Skeleton height={16} width="50%" />
            <Skeleton height={32} width="36%" />
          </div>
        ))}
      </div>

      <div className="tasks-loading__toolbar">
        <Skeleton height={42} width="100%" />
        <div className="tasks-loading__toolbar-filters">
          <Skeleton height={42} width="48%" />
          <Skeleton height={42} width="48%" />
        </div>
      </div>

      <div className="tasks-loading__table">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="tasks-loading__row">
            <Skeleton height={20} width="30%" />
            <Skeleton height={20} width="14%" />
            <Skeleton height={20} width="14%" />
            <Skeleton height={20} width="18%" />
            <Skeleton height={20} width="14%" />
            <Skeleton height={20} width="10%" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskLoadingState;

