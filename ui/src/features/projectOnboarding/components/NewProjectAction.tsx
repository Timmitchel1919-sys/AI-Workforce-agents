import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useOnboardingCapabilities } from "../hooks/useOnboarding";
import { useT } from "../lib/useT";
import "../onboarding.css";

/**
 * Primary "+ New Project" action. Shown only when the Control Plane says the
 * operator may create projects; while loading or on failure it is absent
 * (the entry screen itself reports capability errors and denials).
 */
export function NewProjectAction() {
  const { tt } = useT();
  const { capabilities } = useOnboardingCapabilities();
  if (!capabilities?.canCreate) return null;
  return (
    <Link className="ob-link-button ob-link-button--primary" to="/projects/new">
      <Plus size={16} aria-hidden />
      {tt("projects.newProject")}
    </Link>
  );
}
