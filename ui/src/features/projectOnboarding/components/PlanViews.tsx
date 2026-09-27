import type { ProvisioningPlan } from "../types";
import { useT } from "../lib/useT";
import { FindingRows } from "./AnalysisView";
import { DefList, FindingList, Tag, Unavailable, type Tone } from "./common";

const yesNo = (v: boolean, yes: string, no: string) => (v ? yes : no);

export function TechnologyView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const tech = plan.technology;
  const groups: [string, typeof tech.languages][] = [
    [tt("tech.languages"), tech.languages],
    [tt("tech.frameworks"), tech.frameworks],
    [tt("tech.dataStorage"), tech.dataStorage],
    [tt("tech.authentication"), tech.authentication],
    [tt("tech.packageManagers"), tech.packageManagers],
    [tt("tech.buildSystems"), tech.buildSystems],
    [tt("tech.testSystems"), tech.testSystems],
    [tt("tech.deploymentTargets"), tech.deploymentTargets],
  ];
  return (
    <div className="ob-stack">
      <p>
        <Tag tone={tech.origin === "detected" ? "success" : "info"}>
          {tech.origin === "detected" ? tt("tech.detected") : tt("tech.proposed")}
        </Tag>
      </p>
      {groups.map(([label, findings]) => (
        <div key={label}>
          <h4 className="ob-subtitle">{label}</h4>
          <FindingList findings={findings} />
        </div>
      ))}
      {tech.overrides.length > 0 ? (
        <div>
          <h4 className="ob-subtitle">{tt("tech.overrides")}</h4>
          <OverrideList overrides={tech.overrides} />
        </div>
      ) : null}
    </div>
  );
}

export function OverrideList({ overrides }: { overrides: readonly { field: string; value: string; recommended?: string; reason?: string }[] }) {
  const { tt } = useT();
  return (
    <ul className="ob-list">
      {overrides.map((o, i) => (
        <li key={`${o.field}-${i}`} className="ob-list__item">
          <span className="ob-strong">{o.field}</span>: <code className="ob-code">{o.value}</code>{" "}
          <Tag tone="warning">{tt("tech.differs")}</Tag>
          <div className="ob-muted ob-evidence">
            {tt("tech.recommended")}: {o.recommended ?? tt("common.notEstablished")}
            {o.reason ? ` | ${tt("tech.reason")}: ${o.reason}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ArchitectureView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const a = plan.architecture;
  return (
    <div className="ob-stack">
      <p>{a.summary}</p>
      {a.components.length > 0 ? (
        <ul className="ob-list">
          {a.components.map((c, i) => (
            <li key={`${c.name}-${i}`} className="ob-list__item">
              <Tag>{c.kind}</Tag> <span className="ob-strong">{c.name}</span>
              <div className="ob-muted ob-evidence">{tt("common.evidence")}: {c.evidence}</div>
            </li>
          ))}
        </ul>
      ) : (
        <span className="ob-unavailable">{tt("common.notEstablished")}</span>
      )}
      <FindingRows findings={a.findings} />
    </div>
  );
}

const AVAILABILITY_TONE: Record<string, Tone> = {
  qualified_instance_available: "success",
  no_qualified_instance: "warning",
  unsupported: "danger",
};

export function EnvironmentsView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  if (plan.environments.length === 0) return <span className="ob-unavailable">{tt("common.notEstablished")}</span>;
  return (
    <ul className="ob-cards">
      {plan.environments.map((env, i) => (
        <li key={`${env.environmentType}-${i}`} className="ob-card">
          <div className="ob-card__head">
            <span className="ob-strong">{env.environmentType}</span>
            <Tag tone={AVAILABILITY_TONE[env.availability] ?? "neutral"}>{tt(`environments.${env.availability}`)}</Tag>
          </div>
          <p>{env.purpose}</p>
          <DefList
            items={[
              { label: tt("environments.supported"), value: yesNo(env.supported, tt("common.yes"), tt("common.no")) },
              { label: tt("environments.need"), value: env.provisioningNeed },
              {
                label: tt("environments.requirements"),
                value: env.requirements.length > 0 ? env.requirements.join(", ") : tt("common.none"),
              },
            ]}
          />
          <p className="ob-muted">{tt("environments.note")}</p>
        </li>
      ))}
    </ul>
  );
}

export function WorkforceView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  if (plan.workforce.length === 0) return <span className="ob-unavailable">{tt("common.notEstablished")}</span>;
  return (
    <ul className="ob-cards">
      {plan.workforce.map((w, i) => (
        <li key={`${w.role}-${i}`} className="ob-card">
          <div className="ob-card__head">
            <span className="ob-strong">{w.role}</span>
            <Tag tone={w.availability === "registered" ? "success" : "neutral"}>
              {w.availability === "registered" ? tt("workforce.registered") : tt("workforce.roadmap")}
            </Tag>
            <Tag tone={w.qualified ? "success" : "warning"}>
              {w.qualified ? tt("workforce.qualified") : tt("workforce.notQualified")}
            </Tag>
          </div>
          <p className="ob-muted">{w.reason}</p>
          {w.agentId ? <p className="ob-muted">{tt("workforce.agentId")}: <code className="ob-code">{w.agentId}</code></p> : null}
        </li>
      ))}
    </ul>
  );
}

export function AutonomyView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const a = plan.autonomy;
  const join = (list: readonly string[]) => (list.length > 0 ? list.join(", ") : tt("common.none"));
  return (
    <div className="ob-stack">
      <DefList
        items={[
          { label: tt("permissions.level"), value: `${a.level} - ${tt(`permissions.level${a.level}.name`)}` },
          { label: tt("permissions.requested"), value: join(a.requested) },
          { label: tt("permissions.granted"), value: join(a.granted) },
          { label: tt("permissions.approvalRequired"), value: join(a.approvalRequired) },
        ]}
      />
      <p className="ob-muted">{a.note}</p>
    </div>
  );
}

const INTEGRATION_TONE: Record<string, Tone> = {
  connected: "success",
  required: "warning",
  optional: "neutral",
  unavailable: "danger",
  needs_authorization: "warning",
};

export function IntegrationsView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  if (plan.integrations.length === 0) return <span className="ob-unavailable">{tt("common.none")}</span>;
  return (
    <ul className="ob-cards">
      {plan.integrations.map((it, i) => (
        <li key={`${it.provider}-${i}`} className="ob-card">
          <div className="ob-card__head">
            <span className="ob-strong">{it.provider}</span>
            <Tag tone={INTEGRATION_TONE[it.state] ?? "neutral"}>{tt(`integrations.${it.state}`)}</Tag>
          </div>
          <p>{it.purpose}</p>
          <p className="ob-muted">{it.note}</p>
        </li>
      ))}
    </ul>
  );
}

export function SecretsView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  return (
    <div className="ob-stack">
      <p className="ob-muted">{tt("secrets.note")}</p>
      {plan.secrets.length === 0 ? (
        <span className="ob-unavailable">{tt("secrets.none")}</span>
      ) : (
        <ul className="ob-list" data-testid="secret-names">
          {plan.secrets.map((s) => (
            <li key={s.name} className="ob-list__item">
              <code className="ob-code">{s.name}</code> <Tag tone="info">{tt(`envClass.${s.classification}`)}</Tag>{" "}
              <Tag tone="warning">{tt("secrets.referenceRequired")}</Tag>
              {s.evidence ? <div className="ob-muted ob-evidence">{tt("common.evidence")}: {s.evidence}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GitView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const g = plan.git;
  const on = (v: boolean) => yesNo(v, tt("common.yes"), tt("common.no"));
  return (
    <DefList
      items={[
        { label: tt("git.defaultBranch"), value: g.defaultBranch ?? <Unavailable /> },
        { label: tt("git.developmentBranch"), value: g.developmentBranch ?? <Unavailable /> },
        { label: tt("git.agentBranchPattern"), value: <code className="ob-code">{g.agentBranchPattern}</code> },
        { label: tt("git.testsRequired"), value: on(g.testsRequired) },
        { label: tt("git.reviewRequired"), value: on(g.reviewRequired) },
        { label: tt("git.securityCheckRequired"), value: on(g.securityCheckRequired) },
        { label: tt("git.autoCommit"), value: on(g.autoCommit) },
        { label: tt("git.autoPush"), value: on(g.autoPush) },
        { label: tt("git.pullRequestRequired"), value: on(g.pullRequestRequired) },
        { label: tt("git.mergePolicy"), value: g.mergePolicy === "manual" ? tt("git.mergeManual") : tt("git.mergeApprovedOnly") },
        { label: tt("git.allowDirectDefaultBranchWrites"), value: on(g.allowDirectDefaultBranchWrites) },
      ]}
    />
  );
}

export function PipelineView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  return (
    <ul className="ob-cards">
      {plan.pipeline.map((p) => (
        <li key={p.stage} className="ob-card" data-stage={p.stage} data-status={p.status}>
          <div className="ob-card__head">
            <span className="ob-strong">{tt(`pipeline.stage.${p.stage}`)}</span>
            <Tag tone={p.status === "resolved" ? "success" : "warning"}>
              {p.status === "resolved" ? tt("pipeline.resolved") : tt("pipeline.unresolved")}
            </Tag>
          </div>
          {p.status === "resolved" && p.command ? (
            <p><code className="ob-code">{p.command}</code></p>
          ) : (
            <p className="ob-muted">{tt("pipeline.unresolvedNote")}</p>
          )}
          {p.evidence ? <p className="ob-muted ob-evidence">{tt("common.evidence")}: {p.evidence}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function DeploymentView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const d = plan.deployment;
  return (
    <div className="ob-stack">
      <p className="ob-alert ob-alert--info" role="note">
        {tt("deployment.sla", { minutes: d.visibilitySlaMinutes })} {d.slaNote}
      </p>
      <p className="ob-muted">
        {d.existingDeploymentPreserved ? tt("deployment.preserved") : tt("deployment.notPreserved")}
      </p>
      {d.targets.length === 0 ? (
        <span className="ob-unavailable">{tt("common.notEstablished")}</span>
      ) : (
        <ul className="ob-cards">
          {d.targets.map((t) => (
            <li key={t.environment} className="ob-card">
              <div className="ob-card__head">
                <span className="ob-strong">{t.environment}</span>
                <Tag tone={t.origin === "detected" ? "success" : "info"}>
                  {t.origin === "detected" ? tt("tech.detected") : tt("tech.proposed")}
                </Tag>
                <Tag tone="warning">{tt("deployment.modelledNotDeployed")}</Tag>
              </div>
              <DefList
                items={[
                  { label: tt("deployment.provider"), value: t.provider },
                  { label: tt("deployment.buildCommand"), value: t.buildCommand ? <code className="ob-code">{t.buildCommand}</code> : <Unavailable /> },
                  { label: tt("deployment.healthCheck"), value: t.healthCheck ?? <Unavailable /> },
                ]}
              />
              {t.evidence ? <p className="ob-muted ob-evidence">{tt("common.evidence")}: {t.evidence}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CostView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const c = plan.cost;
  const money = (v: number | undefined) => (v === undefined ? <Unavailable /> : `${v} ${c.currency}`);
  return (
    <div className="ob-stack">
      <p className="ob-alert ob-alert--warning" role="note">
        <Tag tone="warning">{tt("budget.notEnforced")}</Tag> {c.enforcementNote}
      </p>
      <DefList
        items={[
          { label: tt("budget.daily"), value: money(c.dailyLimit) },
          { label: tt("budget.monthly"), value: money(c.monthlyLimit) },
          { label: tt("budget.task"), value: money(c.taskLimit) },
          { label: tt("budget.warningThreshold"), value: `${c.warningThresholdPercent}%` },
          { label: tt("budget.hardStop"), value: yesNo(c.hardStop, tt("common.yes"), tt("common.no")) },
        ]}
      />
    </div>
  );
}

export function GovernanceView({ plan }: { plan: ProvisioningPlan }) {
  const { tt } = useT();
  const g = plan.governance;
  const join = (list: readonly string[]) => (list.length > 0 ? list.join(", ") : tt("common.none"));
  return (
    <DefList
      items={[
        { label: tt("audit.baseline"), value: join(g.auditBaseline) },
        { label: tt("audit.approvals"), value: join(g.approvals) },
        { label: tt("audit.securityFindings"), value: String(g.securityFindings) },
      ]}
    />
  );
}
