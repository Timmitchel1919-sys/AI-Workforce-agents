import { useId } from "react";
import { useI18n } from "../../../i18n";
import type { ProjectOption } from "../lib/projects";

interface Props {
  projects: readonly ProjectOption[];
  value: string;
  onChange: (projectId: string) => void;
}

/** Real registered projects only. One project => static text; none => nothing. */
export function ProjectSelector({ projects, value, onChange }: Props) {
  const { t } = useI18n();
  const id = useId();
  if (projects.length === 0) return null;
  if (projects.length === 1) {
    return (
      <div className="sg-project">
        <span className="sg-project__label">{t("spatial.project.label")}</span>{" "}
        <span className="sg-project__static" data-testid="sg-project-static">
          {projects[0].displayName || projects[0].projectId}
        </span>
      </div>
    );
  }
  return (
    <div className="sg-project">
      <label className="sg-project__label" htmlFor={id}>
        {t("spatial.project.label")}
      </label>
      <select id={id} className="sg-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {projects.map((p) => (
          <option key={p.projectId} value={p.projectId}>
            {p.displayName || p.projectId}
          </option>
        ))}
      </select>
    </div>
  );
}
