import { Link } from "react-router-dom";
import { usePlanHistory, usePreviousRevision, type ExecutionPlanView } from "../../../features/executionPlans";
import { formatDateTime, useI18n } from "../../../i18n";
import { PlanStatusPill } from "./PlanOverview";
import { PLAN_STATUS, label } from "./planLabels";

/** Bounded, cursor-paginated revision list of this plan series. */
export function PlanHistory({ plan }: { plan: ExecutionPlanView }) {
  const { t, language } = useI18n();
  const history = usePlanHistory(plan.projectId, plan.planId);
  const base = `/projects/${encodeURIComponent(plan.projectId)}/execution-plan`;

  return (
    <section className="plan-section" aria-labelledby="plan-history-title">
      <h3 id="plan-history-title">{t("plans.history")}</h3>
      {history.loading ? <p className="plan-muted">{t("plans.loading")}</p> : null}
      {!history.loading && history.items.length === 0 ? <p className="plan-muted">{t("plans.historyEmpty")}</p> : null}
      <ol className="plan-history">
        {history.items.map((item) => {
          const viewing = item.version === plan.version;
          const href = item.current ? base : `${base}?plan=${encodeURIComponent(item.planId)}&version=${item.version}`;
          return (
            <li key={item.id} className={`plan-history__item${viewing ? " is-viewing" : ""}`} aria-current={viewing ? "true" : undefined}>
              <Link to={href} className="plan-history__link" aria-label={t("plans.viewVersion", { version: item.version })}>
                <strong>{t("plans.version", { version: item.version })}</strong>
                <span className="plan-muted">
                  {item.current ? t("plans.current") : t("plans.historical")} ·{" "}
                  {formatDateTime(item.createdAt, language)}
                </span>
              </Link>
              <PlanStatusPill status={item.status} />
              {viewing ? <span className="plan-muted">{t("plans.viewing")}</span> : null}
            </li>
          );
        })}
      </ol>
      {history.hasMore ? (
        <button type="button" className="ui-button" onClick={history.loadMore} disabled={history.loadingMore}>
          {t("plans.loadMore")}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Simple comparison with the previous revision: status, blockers, selected
 * environments and agent assignments. Both sides are server-returned plans.
 */
export function PlanComparison({ plan, names }: { plan: ExecutionPlanView; names: Record<string, string> }) {
  const { t } = useI18n();
  const previous = usePreviousRevision(plan.projectId, plan.planId, plan.version);
  if (!previous) return null;

  const changes: string[] = [];
  // A previous revision is normally "superseded" BY this one — comparing that
  // lifecycle marker would be misleading; blockers carry the real change.
  if (previous.status !== "superseded" && previous.status !== plan.status) {
    changes.push(t("plans.compStatus", { from: t(PLAN_STATUS[previous.status]), to: t(PLAN_STATUS[plan.status]) }));
  }
  const before = new Set(previous.blockers.map((b) => b.code));
  const after = new Set(plan.blockers.map((b) => b.code));
  for (const code of before) if (!after.has(code)) changes.push(t("plans.compBlockerResolved", { code: label.blocker(t, code) }));
  for (const code of after) if (!before.has(code)) changes.push(t("plans.compBlockerAdded", { code: label.blocker(t, code) }));

  const none = t("plans.none");
  for (const env of plan.environments) {
    const key = env.componentIds.join(", ");
    const old = previous.environments.find((e) => e.componentIds.join(", ") === key);
    const from = old?.match.selectedInstanceId ?? none;
    const to = env.match.selectedInstanceId ?? none;
    if (from !== to) changes.push(t("plans.compEnvChanged", { components: key, from, to }));
  }
  for (const agent of plan.agents) {
    const old = previous.agents.find((a) => a.requirementId === agent.requirementId);
    const from = old?.agentId ? (names[old.agentId] ?? old.agentId) : none;
    const to = agent.agentId ? (names[agent.agentId] ?? agent.agentId) : none;
    if (from !== to) changes.push(t("plans.compAgentChanged", { requirement: agent.requirementId, from, to }));
  }

  return (
    <section className="plan-section" aria-labelledby="plan-comparison-title">
      <h3 id="plan-comparison-title">{t("plans.comparison", { version: previous.version })}</h3>
      {changes.length === 0 ? (
        <p className="plan-muted">{t("plans.compNoChanges")}</p>
      ) : (
        <ul className="plan-rows">
          {changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
