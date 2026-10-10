import { useId } from "react";
import { useI18n } from "../../i18n";
import type { ProjectOption } from "./projectScope";
import "./ProjectPicker.css";

interface ProjectPickerProps {
  projects: readonly ProjectOption[];
  value: string;
  onChange: (projectId: string) => void;
}

/** Real registered projects only. One project renders as static text; none renders nothing. */
export function ProjectPicker({ projects, value, onChange }: ProjectPickerProps) {
  const { t } = useI18n();
  const id = useId();

  if (projects.length === 0) return null;

  const label = t("projectScope.label");

  if (projects.length === 1) {
    return (
      <div className="project-picker">
        <span className="project-picker__label">{label}</span>{" "}
        <span className="project-picker__static">
          {projects[0].displayName || projects[0].projectId}
        </span>
      </div>
    );
  }

  return (
    <div className="project-picker">
      <label className="project-picker__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="project-picker__select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {projects.map((project) => (
          <option key={project.projectId} value={project.projectId}>
            {project.displayName || project.projectId}
          </option>
        ))}
      </select>
    </div>
  );
}
