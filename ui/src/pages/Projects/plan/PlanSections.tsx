import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, Clock, OctagonAlert, ShieldCheck, XCircle } from "lucide-react";
import type { ExecutionPlanView, PlannedEnvironment } from "../../../features/executionPlans";
import { useI18n } from "../../../i18n";
import { Pill } from "./PlanOverview";
import { APPROVAL_STATE, BLOCKER, label, versionLabel } from "./planLabels";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="plan-section" aria-labelledby={`plan-${id}-title`} id={`plan-${id}`}>
      <h3 id={`plan-${id}-title`}>{title}</h3>
      {children}
    </section>
  );
}

function toolchainLabel(tc: { kind: string; minimum?: { major: number; minor: number; patch: number } }) {
  return tc.minimum ? `${tc.kind} ≥ ${versionLabel(tc.minimum)}` : tc.kind;
}

/* ------------------------------------------------------------------ */
/* Blockers — prominent, one card per blocker                         */
/* ------------------------------------------------------------------ */

export function BlockersPanel({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  if (plan.blockers.length === 0) {
    return (
      <Section id="blockers" title={t("plans.blockers")}>
        <Pill tone="positive" icon={CheckCircle2}>
          {t("plans.noBlockers")}
        </Pill>
      </Section>
    );
  }
  return (
    <section className="plan-section plan-blockers" aria-labelledby="plan-blockers-title" role="region">
      <h3 id="plan-blockers-title">
        <OctagonAlert size={18} aria-hidden /> {t("plans.blockers")} ({plan.blockers.length})
      </h3>
      <p className="plan-muted">{t("plans.blockersIntro")}</p>
      <ul className="plan-blocker-list">
        {plan.blockers.map((b) => {
          const meta = BLOCKER[b.code];
          return (
            <li key={`${b.code}:${b.subjectId}`} className="plan-blocker" data-blocker={b.code}>
              <div className="plan-blocker__head">
                <Pill tone="negative" icon={OctagonAlert}>
                  {meta ? t(meta.label) : b.code}
                </Pill>
                <code>{b.subjectId}</code>
              </div>
              {meta ? <p>{t(meta.explain)}</p> : null}
              {b.missing.length > 0 ? (
                <p>
                  <strong>{t("plans.missing")}:</strong> {b.missing.join(", ")}
                </p>
              ) : null}
              {b.reasonCodes.length > 0 ? (
                <p className="plan-muted">{b.reasonCodes.map((r) => label.reason(t, r)).join(" · ")}</p>
              ) : null}
              {meta ? (
                <p className="plan-guidance">
                  <strong>{t("plans.resolution")}:</strong> {t(meta.guide)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Architecture + technologies                                        */
/* ------------------------------------------------------------------ */

export function ArchitectureSection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="architecture" title={t("plans.architecture")}>
      <p>
        {t(plan.architecture.style === "multi_platform" ? "plans.multiPlatform" : "plans.singlePlatform")} ·{" "}
        {plan.architecture.platforms.map((p) => label.platform(t, p)).join(", ")}
      </p>
      <ul className="plan-rows">
        {plan.architecture.components.map((c) => (
          <li key={c.componentId} className="plan-row">
            <code>{c.componentId}</code>
            <span>{label.kind(t, c.kind)}</span>
            <span className="plan-muted">{c.platforms.map((p) => label.platform(t, p)).join(", ")}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function TechnologySection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="technologies" title={t("plans.technologies")}>
      <ul className="plan-rows">
        {plan.analysis.technologies.map((tech) => (
          <li key={`${tech.componentId}:${tech.technologyId}`} className="plan-row plan-row--stacked">
            <div className="plan-row">
              <strong>{tech.technologyId}</strong>
              <span className="plan-muted">{tech.componentId}</span>
              <Pill tone="info" icon={CircleDashed}>
                {t("plans.required")}
              </Pill>
            </div>
            <p className="plan-muted">
              {t("plans.requiredToolchains")}:{" "}
              {tech.toolchains
                .flatMap((tc) => [toolchainLabel(tc), ...(tc.components ?? []).map((c) => `${tc.kind}:${c.name}`)])
                .join(", ") || "—"}
              {tech.os?.os ? ` · ${t("plans.hostOs", { os: tech.os.os })}` : ""}
            </p>
          </li>
        ))}
        {plan.analysis.unsupportedTechnologies.map((u) => (
          <li key={`${u.componentId}:${u.technologyId}`} className="plan-row">
            <Pill tone="negative" icon={XCircle}>
              {t("plans.unsupportedTechnology", { technology: u.technologyId })}
            </Pill>
            <span className="plan-muted">{u.componentId}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Environments — REQUIRED vs AVAILABLE vs SELECTED, with evidence    */
/* ------------------------------------------------------------------ */

function EnvironmentCard({ env }: { env: PlannedEnvironment }) {
  const { t } = useI18n();
  const eligible = env.match.candidates.filter((c) => c.eligible).length;
  const required = [
    ...(env.requirement.os?.os ? [t("plans.hostOs", { os: env.requirement.os.os })] : []),
    ...(env.requirement.requiredCapabilities ?? []),
    ...(env.requirement.toolchains ?? []).flatMap((tc) => [
      toolchainLabel(tc),
      ...(tc.components ?? []).map((c) => `${tc.kind}:${c.name}`),
    ]),
  ];
  return (
    <li className="plan-card" data-environment={env.id} data-status={env.status}>
      <div className="plan-row">
        <strong>{t("plans.forComponents", { components: env.componentIds.join(", ") })}</strong>
        {env.status === "satisfied" ? (
          <Pill tone="positive" icon={CheckCircle2}>
            {t("plans.selected")}: {env.match.selectedInstanceId}
          </Pill>
        ) : (
          <Pill tone="negative" icon={OctagonAlert}>
            {t("plans.envUnavailable")}
          </Pill>
        )}
      </div>
      <dl className="plan-facts">
        <div>
          <dt>{t("plans.required")}</dt>
          <dd>{required.join(" · ") || "—"}</dd>
        </div>
        <div>
          <dt>{t("plans.available")}</dt>
          <dd>{eligible}</dd>
        </div>
      </dl>
      <p className="plan-muted">
        {t(env.descriptorSupport === "supported" ? "plans.envTypeSupported" : "plans.envTypeUnsupported")}
      </p>
      <details className="plan-details">
        <summary>
          {t("plans.envCandidates")} ({env.match.candidates.length})
        </summary>
        {env.match.candidates.length === 0 ? (
          <p className="plan-muted">{t("plans.envNoCandidates")}</p>
        ) : (
          <ul className="plan-rows">
            {env.match.candidates.map((c) => (
              <li key={c.instanceId} className="plan-row">
                <code>{c.instanceId}</code>
                {c.instanceId === env.match.selectedInstanceId ? (
                  <Pill tone="positive" icon={CheckCircle2}>
                    {t("plans.selected")}
                  </Pill>
                ) : c.eligible ? (
                  <Pill tone="info" icon={CheckCircle2}>
                    {t("plans.eligible")}
                  </Pill>
                ) : (
                  <Pill tone="neutral" icon={XCircle}>
                    {t("plans.rejected")}
                  </Pill>
                )}
                {c.reasonCodes.length > 0 ? (
                  <span className="plan-muted">
                    {c.reasonCodes.map((r) => label.reason(t, r)).join(" · ")}
                    {c.missingCapabilities.length + c.missingToolchains.length > 0
                      ? ` (${[...c.missingCapabilities, ...c.missingToolchains].join(", ")})`
                      : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

export function EnvironmentSection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="environments" title={t("plans.environments")}>
      <ul className="plan-cards">
        {plan.environments.map((env) => (
          <EnvironmentCard key={env.id} env={env} />
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Agents (≠ models)                                                  */
/* ------------------------------------------------------------------ */

export function AgentSection({ plan, names }: { plan: ExecutionPlanView; names: Record<string, string> }) {
  const { t } = useI18n();
  const purpose = (id: string) => {
    const p = plan.agentRequirements.find((r) => r.id === id)?.purpose;
    return p === "security_review" ? t("plans.agentPurposeSecurity") : p === "test" ? t("plans.agentPurposeTest") : t("plans.agentPurposeBuild");
  };
  return (
    <Section id="agents" title={t("plans.agents")}>
      <ul className="plan-cards">
        {plan.agents.map((a) => {
          const qualified = a.candidates.filter((c) => c.qualifies).length;
          return (
            <li key={a.requirementId} className="plan-card" data-agent-requirement={a.requirementId}>
              <div className="plan-row">
                <strong>{purpose(a.requirementId)}</strong>
                <code>{a.requirementId}</code>
                {a.agentId ? (
                  <Pill tone="positive" icon={CheckCircle2}>
                    {t("plans.agentSelected")}: {names[a.agentId] ?? a.agentId}
                  </Pill>
                ) : (
                  <Pill tone="negative" icon={OctagonAlert}>
                    {t("plans.noQualifiedAgent")}
                  </Pill>
                )}
              </div>
              <dl className="plan-facts">
                <div>
                  <dt>{t("plans.requiredCapabilities")}</dt>
                  <dd>{a.requiredCapabilities.join(", ")}</dd>
                </div>
                <div>
                  <dt>{t("plans.agentsAvailable")}</dt>
                  <dd>{a.candidates.length}</dd>
                </div>
                <div>
                  <dt>{t("plans.agentsQualified")}</dt>
                  <dd>{qualified}</dd>
                </div>
              </dl>
              {a.candidates.length > 0 ? (
                <details className="plan-details">
                  <summary>{t("plans.agentsAvailable")}</summary>
                  <ul className="plan-rows">
                    {a.candidates.map((c) => (
                      <li key={c.agentId} className="plan-row">
                        <span>{names[c.agentId] ?? c.agentId}</span>
                        {c.qualifies ? (
                          <Pill tone="positive" icon={CheckCircle2}>
                            {t("plans.agentsQualified")}
                          </Pill>
                        ) : (
                          <span className="plan-muted">
                            {c.reasonCodes.map((r) => label.agentReason(t, r)).join(" · ")}
                            {c.missingCapabilities.length > 0 ? ` (${c.missingCapabilities.join(", ")})` : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function ModelSection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  if (plan.models.length === 0) return null;
  return (
    <Section id="models" title={t("plans.models")}>
      <p className="plan-muted">{t("plans.modelNote")}</p>
      <ul className="plan-rows">
        {plan.models.map((m) => (
          <li key={m.id} className="plan-row">
            <code>{m.agentRequirementId}</code>
            <span>{m.capabilities.join(", ")}</span>
            {m.status === "satisfied" ? (
              <Pill tone="positive" icon={CheckCircle2}>
                {t("plans.modelSatisfied")}
              </Pill>
            ) : m.status === "missing" ? (
              <Pill tone="negative" icon={OctagonAlert}>
                {t("plans.modelMissing")}
              </Pill>
            ) : (
              <Pill tone="neutral" icon={CircleDashed}>
                {t("plans.modelNotEvaluated")}
              </Pill>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Dependencies (ordered list with edges)                             */
/* ------------------------------------------------------------------ */

export function DependencySection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  const items = new Map(plan.dependencies.items.map((d) => [d.id, d]));
  const conflicted = new Set(plan.dependencies.conflicts.map((c) => c.dependencyId));
  return (
    <Section id="dependencies" title={t("plans.dependencies")}>
      {plan.dependencies.items.length === 0 ? (
        <p className="plan-muted">{t("plans.noDependencies")}</p>
      ) : (
        <>
          <p className="plan-muted">{t("plans.resolutionOrder")}</p>
          <ol className="plan-deps">
            {[...plan.dependencies.order, ...plan.dependencies.items.map((d) => d.id).filter((id) => !plan.dependencies.order.includes(id))].map((id) => {
              const d = items.get(id);
              return (
                <li key={id} className={d?.kind === "toolchain_component" ? "plan-deps__component" : undefined}>
                  <code>{id}</code>
                  {d?.minimum ? <span className="plan-muted"> ≥ {versionLabel(d.minimum)}</span> : null}
                  {conflicted.has(id) ? (
                    <Pill tone="negative" icon={OctagonAlert}>
                      {t("plans.stateConflict")}
                    </Pill>
                  ) : (
                    <Pill tone="info" icon={CircleDashed}>
                      {t("plans.required")}
                    </Pill>
                  )}
                  {d && d.dependsOn.length > 0 ? (
                    <span className="plan-muted"> — {t("plans.dependsOn", { deps: d.dependsOn.join(", ") })}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Build / test / security / deployment — PLANNED, never results      */
/* ------------------------------------------------------------------ */

export function BuildSection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="build" title={t("plans.build")}>
      <ul className="plan-rows">
        {plan.build.map((b) => (
          <li key={b.id} className="plan-row plan-row--stacked">
            <div className="plan-row">
              <strong>{b.componentId}</strong>
              <Pill tone="info" icon={CircleDashed}>
                {t("plans.statePlanned")}
              </Pill>
            </div>
            <p className="plan-muted">
              {t("plans.environment")}: {b.environmentRequirementId} · {t("plans.artifact")}: {b.expectedArtifact.kind}
              {b.dependencyIds.length > 0 ? ` · ${t("plans.dependsOn", { deps: b.dependencyIds.join(", ") })}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function TestSection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="tests" title={t("plans.tests")}>
      <ul className="plan-rows">
        {plan.tests.map((s) => (
          <li key={s.id} className="plan-row">
            <span>{label.test(t, s.type)}</span>
            <span className="plan-muted">{s.componentId}</span>
            <Pill tone="info" icon={CircleDashed}>
              {t("plans.stateRequired")}
            </Pill>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function SecuritySection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="security" title={t("plans.security")}>
      <ul className="plan-rows">
        {plan.security.map((s) => (
          <li key={s.id} className="plan-row">
            <ShieldCheck size={16} aria-hidden />
            <span>{label.check(t, s.check)}</span>
            <Pill tone="info" icon={CircleDashed}>
              {t("plans.stateRequired")}
            </Pill>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function DeploymentSection({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <Section id="deployment" title={t("plans.deployment")}>
      {plan.deployment.length === 0 ? (
        <p className="plan-muted">{t("plans.noDeployments")}</p>
      ) : (
        <ul className="plan-rows">
          {plan.deployment.map((d) => (
            <li key={d.id} className="plan-row plan-row--stacked">
              <div className="plan-row">
                <strong>
                  {label.target(t, d.targetType)} · {label.stage(t, d.stage)}
                </strong>
                <Pill tone="info" icon={CircleDashed}>
                  {t("plans.statePlanned")}
                </Pill>
              </div>
              <p className="plan-muted">
                {d.componentId} · {t("plans.artifact")}: {d.requiredArtifact.kind}
                {d.rollbackRequired ? ` · ${t("plans.rollback")}` : ""}
                {d.credentialRef ? ` · ${t("plans.credentialReference", { kind: d.credentialRef.kind })}` : ""}
              </p>
              {d.preDeploymentGates.length > 0 ? (
                <p className="plan-muted">
                  {t("plans.gates")}: {d.preDeploymentGates.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function ApprovalSection({ plan, actions }: { plan: ExecutionPlanView; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Section id="approvals" title={t("plans.approvals")}>
      {plan.approvalRequirements.length === 0 ? (
        <p className="plan-muted">{t("plans.noApprovalsRequired")}</p>
      ) : (
        <>
          <ul className="plan-rows">
            {plan.approvalRequirements.map((a) => (
              <li key={a.id} className="plan-row">
                <span>{label.approvalReason(t, a.reason)}</span>
                <span className="plan-muted">{a.subjectIds.join(", ")}</span>
              </li>
            ))}
          </ul>
          <Pill
            tone={plan.approval.state === "approved" ? "positive" : plan.approval.state === "rejected" ? "negative" : "warning"}
            icon={plan.approval.state === "approved" ? CheckCircle2 : plan.approval.state === "rejected" ? XCircle : Clock}
          >
            {t(APPROVAL_STATE[plan.approval.state])}
          </Pill>
        </>
      )}
      {actions}
    </Section>
  );
}
