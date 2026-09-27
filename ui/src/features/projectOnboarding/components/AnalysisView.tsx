import type { ArchitectureFinding, ProjectAnalysis } from "../types";
import { useT } from "../lib/useT";
import { DefList, FindingList, Section, Tag, Unavailable, type Tone } from "./common";

const SEVERITY_TONE: Record<ArchitectureFinding["severity"], Tone> = { info: "info", warning: "warning", blocker: "danger" };

export function FindingRows({ findings }: { findings: readonly ArchitectureFinding[] }) {
  const { tt } = useT();
  if (findings.length === 0) return <span className="ob-unavailable">{tt("analysis.noneReported")}</span>;
  return (
    <ul className="ob-list">
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`} className="ob-list__item">
          <Tag tone={SEVERITY_TONE[f.severity]}>{tt(`severity.${f.severity}`)}</Tag> <span>{f.message}</span>
          {f.evidence ? <div className="ob-muted ob-evidence">{tt("common.evidence")}: {f.evidence}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** Discovery is evidence, not a decision: nothing here has been approved. */
export function AnalysisView({ analysis }: { analysis: ProjectAnalysis }) {
  const { tt } = useT();
  const coverage =
    analysis.coverageConfigured === "unknown" ? tt("analysis.coverageUnknown")
      : analysis.coverageConfigured ? tt("common.yes") : tt("common.no");
  return (
    <div className="ob-stack" data-testid="analysis-view">
      <p className="ob-muted">
        {analysis.basis === "repository" ? tt("analysis.basisRepository") : tt("analysis.basisSpecification")}
      </p>
      <DefList
        items={[
          { label: tt("analysis.commit"), value: analysis.repository.commit ?? <Unavailable /> },
          { label: tt("analysis.branch"), value: analysis.repository.branch ?? analysis.repository.defaultBranch ?? <Unavailable /> },
          { label: tt("analysis.visibility"), value: analysis.repository.visibility ?? <Unavailable /> },
          { label: tt("analysis.coverage"), value: coverage },
        ]}
      />
      {analysis.truncated ? <p className="ob-alert ob-alert--warning">{tt("analysis.truncated")}</p> : null}

      <Section id="an-languages" title={tt("analysis.languages")}><FindingList findings={analysis.languages} /></Section>
      <Section id="an-frameworks" title={tt("analysis.frameworks")}><FindingList findings={analysis.frameworks} /></Section>
      <Section id="an-pm" title={tt("analysis.packageManagers")}><FindingList findings={analysis.packageManagers} /></Section>
      <Section id="an-build" title={tt("analysis.buildSystems")}><FindingList findings={analysis.buildSystems} /></Section>
      <Section id="an-tests" title={tt("analysis.testFrameworks")}><FindingList findings={analysis.testFrameworks} /></Section>

      <Section id="an-commands" title={tt("analysis.commands")}>
        {analysis.commands.length === 0 ? (
          <span className="ob-unavailable">{tt("analysis.commandsNone")}</span>
        ) : (
          <ul className="ob-list">
            {analysis.commands.map((c, i) => (
              <li key={`${c.purpose}-${i}`} className="ob-list__item">
                <span className="ob-strong">{c.purpose}</span> <code className="ob-code">{c.command}</code>
                <div className="ob-muted ob-evidence">{tt("common.evidence")}: {c.evidence}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="an-deployment" title={tt("analysis.deployment")}><FindingList findings={analysis.deployment} /></Section>

      <Section id="an-env" title={tt("analysis.envVars")} description={tt("analysis.envVarsNote")}>
        {analysis.envVars.length === 0 ? (
          <span className="ob-unavailable">{tt("analysis.noneReported")}</span>
        ) : (
          <ul className="ob-list">
            {analysis.envVars.map((v) => (
              <li key={v.name} className="ob-list__item">
                <code className="ob-code">{v.name}</code>{" "}
                <Tag tone={v.classification === "public_client" ? "neutral" : v.classification === "unclassified" ? "warning" : "info"}>
                  {tt(`envClass.${v.classification}`)}
                </Tag>
                <div className="ob-muted ob-evidence">{tt("common.evidence")}: {v.evidence}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="an-security" title={tt("analysis.security")}><FindingRows findings={analysis.security} /></Section>

      <Section id="an-docs" title={tt("analysis.documentation")}>
        {analysis.documentation.length === 0 ? (
          <span className="ob-unavailable">{tt("analysis.noneReported")}</span>
        ) : (
          <ul className="ob-list">
            {analysis.documentation.map((d) => (
              <li key={d.path} className="ob-list__item"><code className="ob-code">{d.path}</code> <Tag>{d.kind}</Tag></li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="an-findings" title={tt("analysis.findings")} description={tt("analysis.findingsNote")}>
        <FindingRows findings={analysis.findings} />
      </Section>

      <Section id="an-unavailable" title={tt("analysis.unavailable")}>
        {analysis.unavailable.length === 0 ? (
          <span className="ob-muted">{tt("analysis.nothingUnavailable")}</span>
        ) : (
          <ul className="ob-list">
            {analysis.unavailable.map((u) => <li key={u} className="ob-list__item">{u}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}
