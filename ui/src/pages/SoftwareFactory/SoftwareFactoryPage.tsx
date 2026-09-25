import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Factory, Lock, Plus } from "lucide-react";
import { Dialog, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/useAuth";
import {
  useSoftwareFactoryCommand,
  useSoftwareFactoryPrograms,
  type ProgramSummary,
  type SoftwareFactoryUiState,
} from "../../features/softwareFactory";
import { useProjects } from "../../features/executionPlans";
import { formatDateTime, translateStatus, useI18n } from "../../i18n";
import "../Approvals/ApprovalsPage.css";
import "../Infrastructure/InfrastructurePage.css";
import { commandLabel } from "./feedback";
import "./SoftwareFactoryPage.css";

interface Notice {
  tone: "ok" | "error";
  text: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Software Factory — the EO-5.1 program list, scoped to one selected
 * project. Read-only view of what the Control Plane serves; "New program"
 * only sends a create-program command the backend validates, authorizes and
 * audits. Nothing here executes or fabricates state.
 */
export default function SoftwareFactoryPage() {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const { status: projectStatus, projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const projectId = selectedProjectId || projects[0]?.projectId || "";
  const { status, programs, refetch } = useSoftwareFactoryPrograms(projectId || undefined);
  const [creating, setCreating] = useState(false);
  const canCreate =
    Boolean(projectId) && accessDetails.capabilities.includes("create_program");
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("softwareFactory.title")}
        description={t("softwareFactory.description")}
        actions={
          canCreate ? (
            <button type="button" className="ui-button primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden /> {t("softwareFactory.createProgram")}
            </button>
          ) : undefined
        }
      />

      <ProjectScope
        projectStatus={projectStatus}
        projectId={projectId}
        projects={projects}
        onProjectChange={setSelectedProjectId}
      />

      {notice ? (
        <p className={`gov-notice gov-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      {projectId ? (
        <>
          <FactoryState state={status} refetch={() => void refetch()} onRetry={() => void refetch()} />

          {status === "ready" ? (
            <ul className="infra-grid">
              {programs.map((program) => (
                <ProgramCard key={program.id} program={program} projectId={projectId} />
              ))}
            </ul>
          ) : null}

          {status === "empty" ? (
            <EmptyState
              title={t("softwareFactory.emptyTitle")}
              description={t("softwareFactory.emptyDescription")}
              primaryAction={
                canCreate ? (
                  <button type="button" className="ui-button primary" onClick={() => setCreating(true)}>
                    <Plus size={16} aria-hidden /> {t("softwareFactory.createProgram")}
                  </button>
                ) : undefined
              }
            />
          ) : null}
        </>
      ) : null}

      {creating && projectId ? (
        <CreateProgramDialog
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(text) => {
            setCreating(false);
            setNotice({ tone: "ok", text });
          }}
        />
      ) : null}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Project scope                                                       */
/* ------------------------------------------------------------------ */

function ProjectScope({
  projectStatus,
  projectId,
  projects,
  onProjectChange,
}: {
  projectStatus: ReturnType<typeof useProjects>["status"];
  projectId: string;
  projects: ReturnType<typeof useProjects>["projects"];
  onProjectChange: (value: string) => void;
}) {
  const { t } = useI18n();
  if (projectStatus === "loading") {
    return <Skeleton height={56} width="100%" />;
  }
  if (projectStatus === "error" || projectStatus === "forbidden" || projectStatus === "unauthenticated") {
    return (
      <ErrorState
        icon={<Lock size={28} />}
        title={t("softwareFactory.projectsUnavailable")}
        description={t("softwareFactory.errorDescription")}
      />
    );
  }
  if (projectStatus === "empty") {
    return <EmptyState title={t("softwareFactory.noProjectsAvailable")} />;
  }
  return (
    <label className="gov-field sf-project-scope">
      <span>{t("softwareFactory.selectProject")}</span>
      <select
        value={projectId}
        onChange={(event) => onProjectChange(event.target.value)}
        aria-describedby="sf-project-scope-hint"
      >
        {projectId ? null : (
          <option value="" disabled>
            {t("softwareFactory.projectScopeTitle")}
          </option>
        )}
        {projects.map((project) => (
          <option key={project.projectId} value={project.projectId}>
            {project.displayName}
          </option>
        ))}
      </select>
      <small id="sf-project-scope-hint" className="gov-muted">
        {t("softwareFactory.projectScopeDescription")}
      </small>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

function FactoryState({ state, onRetry }: { state: SoftwareFactoryUiState; refetch: () => void; onRetry: () => void }) {
  const { t } = useI18n();
  if (state === "loading") {
    return (
      <div className="gov-list" role="status" aria-label={t("softwareFactory.loading")}>
        <Skeleton height={96} width="100%" />
        <Skeleton height={96} width="100%" />
      </div>
    );
  }
  if (state === "unauthenticated" || state === "forbidden") {
    return (
      <ErrorState
        icon={<Lock size={28} />}
        title={t(state === "forbidden" ? "softwareFactory.forbiddenTitle" : "softwareFactory.unauthenticatedTitle")}
        description={t(
          state === "forbidden" ? "softwareFactory.forbiddenDescription" : "softwareFactory.unauthenticatedDescription",
        )}
      />
    );
  }
  if (state === "error" || state === "not_found" || state === "conflict") {
    return (
      <ErrorState
        title={t("softwareFactory.errorTitle")}
        description={t("softwareFactory.errorDescription")}
        onRetry={onRetry}
        retryLabel={t("common.retry")}
      />
    );
  }
  return null;
}

function ProgramStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = status === "active" ? "positive" : status === "failed" ? "negative" : status === "paused" ? "warning" : "neutral";
  return <span className={`gov-pill gov-pill--${tone}`}>{translateStatus(t, status)}</span>;
}

function ProgramCard({ program, projectId }: { program: ProgramSummary; projectId: string }) {
  const { t, language } = useI18n();
  return (
    <li className="gov-card sf-program-card">
      <div className="gov-card__head">
        <Factory size={16} aria-hidden />
        <strong className="infra-card__title">{program.name}</strong>
        <ProgramStatusPill status={program.status} />
      </div>
      <p className="infra-card__description">{program.objective}</p>
      <dl className="infra-facts">
        <div>
          <dt>{t("softwareFactory.workstreams")}</dt>
          <dd>{program.workstreamIds.length}</dd>
        </div>
        <div>
          <dt>{t("softwareFactory.taskCountLabel")}</dt>
          <dd>
            {t("softwareFactory.taskCount", { count: program.taskCount })} ·{" "}
            {t("softwareFactory.activeTaskCount", { count: program.activeTaskCount })}
          </dd>
        </div>
      </dl>
      <p className="gov-muted">
        {t("softwareFactory.updated", { time: formatDateTime(program.updatedAt, language) ?? program.updatedAt })}
      </p>
      <Link
        to={`/software-factory/${encodeURIComponent(projectId)}/${encodeURIComponent(program.id)}`}
        className="sf-card__cta"
      >
        {t("softwareFactory.openProgram", { name: program.name })}
        <ArrowRight size={14} aria-hidden />
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Create program                                                      */
/* ------------------------------------------------------------------ */

function CreateProgramDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (text: string) => void;
}) {
  const { t } = useI18n();
  const mutation = useSoftwareFactoryCommand(projectId);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = ID_PATTERN.test(id) && name.trim().length > 0 && objective.trim().length > 0;

  const submit = () => {
    if (!valid) {
      setError(t("softwareFactory.formIncomplete"));
      return;
    }
    mutation.mutate(
      {
        kind: "create-program",
        request: { projectId, id: id.trim(), name: name.trim(), objective: objective.trim() },
      },
      {
        onSuccess: () => onCreated(t("softwareFactory.programCreated")),
        onError: (e) => setError(commandLabel(t, e)),
      },
    );
  };

  return (
    <Dialog open onClose={onClose} title={t("softwareFactory.createProgram")} description={t("softwareFactory.createProgramHint")}>
      <form
        className="gov-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="gov-field">
          <span>{t("softwareFactory.fieldId")}</span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9_-]{0,63}"
            placeholder="web-platform"
            aria-describedby="sf-program-id-hint"
            required
          />
          <small id="sf-program-id-hint" className="gov-muted">
            {t("softwareFactory.fieldIdHint")}
          </small>
        </label>
        <label className="gov-field">
          <span>{t("softwareFactory.fieldName")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required />
        </label>
        <label className="gov-field">
          <span>{t("softwareFactory.fieldObjective")}</span>
          <textarea value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={2000} rows={3} required />
        </label>

        {error ? (
          <p className="plan-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("softwareFactory.cancel")}
          </button>
          <button type="submit" className="ui-button primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            <Plus size={16} aria-hidden /> {mutation.isPending ? t("softwareFactory.working") : t("softwareFactory.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}