import type { WorkflowProgress } from "../../../features/workflows";
import { useI18n } from "../../../i18n";

export function WorkflowProgressBar({ progress }: { progress: WorkflowProgress }) {
  const { t } = useI18n();
  const percent = Math.round(progress.fraction * 100);
  const tone = progress.failed > 0 ? "danger" : percent === 100 ? "success" : "primary";

  return (
    <div className="workflow-progress">
      <div
        className="workflow-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("workflows.progressLabel", { completed: progress.completed, total: progress.total })}
      >
        <div
          className={`workflow-progress__fill workflow-progress__fill--${tone}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="workflow-progress__label">
        {progress.completed}/{progress.total}
      </span>
    </div>
  );
}

export default WorkflowProgressBar;
