import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useOnboardingSessions } from "../hooks/useOnboarding";
import { isInProgress } from "../lib/steps";
import { useT } from "../lib/useT";
import { formatDateTime } from "../../../i18n";
import { Tag } from "./common";

/** In-progress drafts. Visually and semantically distinct from real projects. */
export function ResumeList() {
  const { tt, language } = useT();
  const { sessions, isLoading, error } = useOnboardingSessions();
  const drafts = sessions.filter((s) => isInProgress(s.status));

  if (isLoading) return null;
  if (error) {
    return (
      <section className="ob-resume" aria-labelledby="ob-resume-heading">
        <h2 id="ob-resume-heading" className="ob-resume__title">{tt("resume.title")}</h2>
        <p role="alert" className="ob-muted">
          {tt("resume.error")}
        </p>
      </section>
    );
  }
  if (drafts.length === 0) return null;

  return (
    <section className="ob-resume" aria-labelledby="ob-resume-heading">
      <h2 id="ob-resume-heading" className="ob-resume__title">{tt("resume.title")}</h2>
      <p className="ob-muted">{tt("resume.description")}</p>
      <ul className="ob-resume__list">
        {drafts.map((s) => (
          <li key={s.id}>
            <Link className="ob-resume__item" to={`/projects/onboarding/${encodeURIComponent(s.id)}`}>
              <span className="ob-strong">{s.name || tt("resume.untitled")}</span>
              <span className="ob-muted">{s.code}</span>
              <Tag tone={s.status.endsWith("failed") ? "danger" : "info"}>{tt("resume.draftLabel")}: {tt(`status.${s.status}`)}</Tag>
              <span className="ob-muted">{tt("resume.updated", { when: formatDateTime(s.updatedAt, language) ?? s.updatedAt })}</span>
              <span className="ob-resume__cta">{tt("resume.continue")}<ArrowRight size={16} aria-hidden /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
