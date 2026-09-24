import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog } from "../../../components/ui";
import {
  PlanClientError,
  usePlanCommand,
  useTechnologyCatalog,
  type PlanningRequestInput,
} from "../../../features/executionPlans";
import { useI18n } from "../../../i18n";
import { COMPONENT_KINDS, DEPLOYMENT_STAGES, DEPLOYMENT_TARGETS, TARGET_PLATFORMS, label } from "./planLabels";

interface ComponentDraft {
  key: number;
  id: string;
  kind: string;
  platforms: string[];
  technologies: string[];
  deployTarget: string;
  deployStage: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
let nextKey = 1;

function emptyComponent(): ComponentDraft {
  return { key: nextKey++, id: "", kind: "web_frontend", platforms: [], technologies: [], deployTarget: "", deployStage: "staging" };
}

/**
 * Builds a planning REQUEST only. The Control Plane plans it (environments,
 * agents, blockers, status) — the browser never manufactures a plan, and
 * creating a plan executes nothing.
 */
export function CreatePlanDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const { catalog, failed } = useTechnologyCatalog(true);
  const mutation = usePlanCommand(projectId);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [components, setComponents] = useState<ComponentDraft[]>([emptyComponent()]);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<ComponentDraft>) =>
    setComponents((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const compatible = (c: ComponentDraft) =>
    catalog.filter(
      (tech) => tech.componentKinds.includes(c.kind) && c.platforms.every((p) => tech.platforms.includes(p)),
    );

  const valid =
    title.trim().length > 0 &&
    components.length > 0 &&
    components.every((c) => ID_PATTERN.test(c.id) && c.platforms.length > 0 && c.technologies.length > 0) &&
    new Set(components.map((c) => c.id)).size === components.length;

  const submit = () => {
    if (!valid) {
      setError(t("plans.formIncomplete"));
      return;
    }
    const request: PlanningRequestInput = {
      projectId,
      title: title.trim(),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      components: components.map((c) => ({
        id: c.id,
        kind: c.kind,
        platforms: c.platforms,
        technologies: c.technologies,
      })),
      deployments: components
        .filter((c) => c.deployTarget)
        .map((c) => ({ componentId: c.id, targetType: c.deployTarget, stage: c.deployStage })),
    };
    mutation.mutate(
      { kind: "create", request },
      {
        onSuccess: onCreated,
        onError: (e) =>
          setError(
            t(
              e instanceof PlanClientError && (e.code === "FORBIDDEN" || e.code === "UNAUTHENTICATED")
                ? "plans.actionForbidden"
                : e instanceof PlanClientError && e.code === "INVALID"
                  ? "plans.actionInvalid"
                  : "plans.actionFailed",
            ),
          ),
      },
    );
  };

  return (
    <Dialog open onClose={onClose} title={t("plans.createTitle")} description={t("plans.createHint")}>
      <form
        className="plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {failed ? <p className="plan-warning">{t("plans.catalogUnavailable")}</p> : null}
        <label className="plan-field">
          <span>{t("plans.fieldTitle")}</span>
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="plan-field">
          <span>{t("plans.fieldSummary")}</span>
          <textarea maxLength={2000} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>

        <fieldset className="plan-fieldset">
          <legend>{t("plans.componentsLabel")}</legend>
          {components.map((c, index) => {
            const techs = compatible(c);
            return (
              <div key={c.key} className="plan-component-form">
                <div className="plan-form__grid">
                  <label className="plan-field">
                    <span>{t("plans.componentId")}</span>
                    <input
                      value={c.id}
                      onChange={(e) => update(c.key, { id: e.target.value.toLowerCase() })}
                      pattern="[a-z0-9][a-z0-9_-]{0,63}"
                      aria-describedby={`component-id-hint-${c.key}`}
                      required
                    />
                    <small id={`component-id-hint-${c.key}`} className="plan-muted">
                      {t("plans.componentIdHint")}
                    </small>
                  </label>
                  <label className="plan-field">
                    <span>{t("plans.componentKind")}</span>
                    <select value={c.kind} onChange={(e) => update(c.key, { kind: e.target.value, technologies: [] })}>
                      {COMPONENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {label.kind(t, k)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <fieldset className="plan-choices">
                  <legend>{t("plans.platformsLabel")}</legend>
                  {TARGET_PLATFORMS.map((p) => (
                    <label key={p} className="plan-choice">
                      <input
                        type="checkbox"
                        checked={c.platforms.includes(p)}
                        onChange={(e) =>
                          update(c.key, {
                            platforms: e.target.checked ? [...c.platforms, p] : c.platforms.filter((x) => x !== p),
                            technologies: [],
                          })
                        }
                      />
                      <span>{label.platform(t, p)}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="plan-choices">
                  <legend>{t("plans.technologiesLabel")}</legend>
                  {techs.length === 0 ? (
                    <p className="plan-muted">{t("plans.noMatchingTechnology")}</p>
                  ) : (
                    techs.map((tech) => (
                      <label key={tech.id} className="plan-choice">
                        <input
                          type="checkbox"
                          checked={c.technologies.includes(tech.id)}
                          onChange={(e) =>
                            update(c.key, {
                              technologies: e.target.checked
                                ? [...c.technologies, tech.id]
                                : c.technologies.filter((x) => x !== tech.id),
                            })
                          }
                        />
                        <span>{tech.label}</span>
                      </label>
                    ))
                  )}
                </fieldset>
                <div className="plan-form__grid">
                  <label className="plan-field">
                    <span>{t("plans.deploymentLabel")}</span>
                    <select value={c.deployTarget} onChange={(e) => update(c.key, { deployTarget: e.target.value })}>
                      <option value="">{t("plans.deploymentNone")}</option>
                      {DEPLOYMENT_TARGETS.map((d) => (
                        <option key={d} value={d}>
                          {label.target(t, d)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {c.deployTarget ? (
                    <label className="plan-field">
                      <span>{t("plans.deploymentStage")}</span>
                      <select value={c.deployStage} onChange={(e) => update(c.key, { deployStage: e.target.value })}>
                        {DEPLOYMENT_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {label.stage(t, s)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {components.length > 1 ? (
                  <button
                    type="button"
                    className="ui-button"
                    onClick={() => setComponents((list) => list.filter((x) => x.key !== c.key))}
                    aria-label={`${t("plans.removeComponent")} ${index + 1}`}
                  >
                    <Trash2 size={16} aria-hidden /> {t("plans.removeComponent")}
                  </button>
                ) : null}
              </div>
            );
          })}
          <button type="button" className="ui-button" onClick={() => setComponents((list) => [...list, emptyComponent()])}>
            <Plus size={16} aria-hidden /> {t("plans.addComponent")}
          </button>
        </fieldset>

        {error ? (
          <p className="plan-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="plan-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("plans.cancel")}
          </button>
          <button type="submit" className="ui-button primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending ? t("plans.working") : t("plans.submitCreate")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
