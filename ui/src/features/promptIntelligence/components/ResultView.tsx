import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Copy, Info, ShieldAlert, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "../../../components/ui";
import {
  CONTEXT_CATEGORIES,
  EXCLUDED_REASONS,
  UNRESOLVED_PROJECT,
  type PromptRequestView,
  type PromptValidationCheck,
  type ResolvedFragment,
} from "../types";
import { useT } from "../lib/useT";
import { DefList, ErrorPanel, Notice, Section, StatusTag, Tag, Text, TextList, Unavailable, type Tone } from "./common";

const RISK_TONE: Record<string, Tone> = { low: "success", medium: "warning", high: "danger" };

const CHECK_VIEW = {
  pass: { tone: "success" as Tone, icon: <CheckCircle2 size={14} aria-hidden /> },
  warn: { tone: "warning" as Tone, icon: <AlertTriangle size={14} aria-hidden /> },
  fail: { tone: "danger" as Tone, icon: <XCircle size={14} aria-hidden /> },
  info: { tone: "info" as Tone, icon: <Info size={14} aria-hidden /> },
};

export interface ResultViewProps {
  view: PromptRequestView;
  canPrepare: boolean;
  onRequestApproval: () => void;
  approvalPending: boolean;
  approvalError: unknown;
  onDismissApprovalError: () => void;
}

/** Renders the pipeline top to bottom. Every value comes from the backend; nothing is derived here except the next step from `execution`. */
export function ResultView(props: ResultViewProps) {
  const { view } = props;
  const { tt } = useT();
  return (
    <ol className="pi-pipeline" aria-label={tt("result.pipelineLabel")}>
      <li><RequestSection view={view} /></li>
      <li><IntentSection view={view} /></li>
      <li><ContextSection view={view} /></li>
      <li><PromptSection view={view} /></li>
      <li><ValidationSection view={view} /></li>
      <li><CapabilitySection view={view} /></li>
      <li><NextStepSection {...props} /></li>
    </ol>
  );
}

function RequestSection({ view }: { view: PromptRequestView }) {
  const { tt, formatTime } = useT();
  const { record } = view;
  const project = record.projectId === UNRESOLVED_PROJECT ? undefined : (record.intent.project.displayName ?? record.projectId);
  return (
    <Section id="pi-sec-request" step={1} title={tt("request.title")}>
      <blockquote className="pi-quote">{record.request}</blockquote>
      <DefList
        items={[
          { label: tt("request.requester"), value: <Text value={record.requestedBy} /> },
          { label: tt("request.time"), value: formatTime(record.createdAt) },
          { label: tt("request.id"), value: <code className="pi-code">{record.requestId}</code> },
          { label: tt("request.project"), value: project ?? <span className="pi-unavailable">{tt("common.notIdentified")}</span> },
          ...(record.taskId ? [{ label: tt("request.task"), value: <code className="pi-code">{record.taskId}</code> }] : []),
        ]}
      />
    </Section>
  );
}

function IntentSection({ view }: { view: PromptRequestView }) {
  const { tt, label } = useT();
  const { intent } = view.record;
  return (
    <Section id="pi-sec-intent" step={2} title={tt("intent.title")}>
      <DefList
        items={[
          { label: tt("intent.category"), value: <Tag tone="info">{label("intentCategory", intent.category)}</Tag> },
          { label: tt("intent.language"), value: label("language", intent.language) },
          { label: tt("intent.objective"), value: <Text value={intent.objective} /> },
          { label: tt("intent.target"), value: <Text value={intent.target} /> },
          { label: tt("intent.operation"), value: <Text value={intent.operation} /> },
          { label: tt("intent.scope"), value: <Text value={intent.scope} /> },
          {
            label: tt("intent.risk"),
            value: (
              <Tag tone={RISK_TONE[intent.risk] ?? "neutral"}>{tt("intent.riskValue", { level: label("risk", intent.risk) })}</Tag>
            ),
          },
          { label: tt("intent.explicitConstraints"), value: <TextList items={intent.explicitConstraints} /> },
          { label: tt("intent.impliedConstraints"), value: <TextList items={intent.impliedConstraints} /> },
        ]}
      />

      <div>
        <h4 className="pi-subtitle">{tt("intent.ambiguity")}</h4>
        {intent.ambiguity.length === 0 ? (
          <p className="pi-muted">{tt("intent.noAmbiguity")}</p>
        ) : (
          <ul className="pi-list">
            {intent.ambiguity.map((issue) => (
              <li key={issue.code} className="pi-list__item">
                {issue.severity === "high" ? (
                  <Tag tone="warning">{tt("intent.needsClarification")}</Tag>
                ) : (
                  <Tag tone="info">{tt("intent.defaultApplied")}</Tag>
                )}{" "}
                <span>{issue.message}</span>
                {issue.severity === "low" && issue.appliedDefault ? (
                  <span className="pi-muted pi-block">{tt("intent.defaultValue", { value: issue.appliedDefault })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="pi-subtitle">{tt("intent.destructive")}</h4>
        {intent.destructive.length === 0 ? (
          <p className="pi-muted">{tt("intent.noDestructive")}</p>
        ) : (
          <ul className="pi-list">
            {intent.destructive.map((finding, index) => (
              <li key={`${finding.kind}-${index}`} className="pi-list__item">
                <Tag tone="danger" icon={<ShieldAlert size={14} aria-hidden />}>{label("destructive", finding.kind)}</Tag>{" "}
                <span className="pi-code">{finding.matched}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {intent.securityOverrideAttempts.length > 0 ? (
        <div>
          <h4 className="pi-subtitle">{tt("intent.securityOverrides")}</h4>
          <ul className="pi-list">
            {intent.securityOverrideAttempts.map((attempt, index) => (
              <li key={`${index}-${attempt}`} className="pi-list__item">
                <Tag tone="danger" icon={<ShieldAlert size={14} aria-hidden />}>{tt("intent.notApplied")}</Tag> <span>{attempt}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function FragmentCard({ fragment }: { fragment: ResolvedFragment }) {
  const { tt, label } = useT();
  return (
    <li className="pi-card">
      <p className="pi-strong">{fragment.key}</p>
      <p>{fragment.value}</p>
      <DefList
        items={[
          { label: tt("context.source"), value: fragment.source },
          { label: tt("context.origin"), value: <Text value={fragment.origin} /> },
          { label: tt("context.authority"), value: label("authority", fragment.authority) },
          { label: tt("context.precedence"), value: label("precedence", fragment.precedence) },
          { label: tt("context.why"), value: <TextList items={fragment.relevance.reasons} emptyLabel={tt("common.unavailable")} /> },
        ]}
      />
      {fragment.files && fragment.files.length > 0 ? <TextList items={fragment.files} /> : null}
    </li>
  );
}

function ContextSection({ view }: { view: PromptRequestView }) {
  const { tt, label } = useT();
  const { context } = view.record;
  const grouped = CONTEXT_CATEGORIES.map((category) => ({
    category,
    fragments: context.fragments.filter((fragment) => fragment.category === category),
  })).filter((group) => group.fragments.length > 0);
  const excludedCounts = EXCLUDED_REASONS.map((reason) => ({
    reason,
    count: context.excluded.filter((item) => item.reason === reason).length,
  })).filter((entry) => entry.count > 0);
  return (
    <Section id="pi-sec-context" step={3} title={tt("context.title")}>
      {grouped.length === 0 ? <p className="pi-muted">{tt("context.noFragments")}</p> : null}
      {grouped.map((group) => (
        <div key={group.category}>
          <h4 className="pi-subtitle">{label("contextCategory", group.category)}</h4>
          <ul className="pi-cards">
            {group.fragments.map((fragment) => <FragmentCard key={`${fragment.source}-${fragment.key}`} fragment={fragment} />)}
          </ul>
        </div>
      ))}

      <div>
        <h4 className="pi-subtitle">{tt("context.relevantFiles")}</h4>
        <TextList items={context.relevantFiles} />
      </div>

      <div>
        <h4 className="pi-subtitle">{tt("context.conflicts")}</h4>
        {context.conflicts.length === 0 ? (
          <p className="pi-muted">{tt("context.noConflicts")}</p>
        ) : (
          <ul className="pi-cards">
            {context.conflicts.map((conflict, index) => (
              <li key={`${conflict.key}-${index}`} className="pi-card">
                <p className="pi-strong">{label("contextCategory", conflict.category)} / {conflict.key}</p>
                <DefList
                  items={[
                    {
                      label: tt("context.winner"),
                      value: <>{conflict.winner.value} <span className="pi-muted">({conflict.winner.source}, {label("precedence", conflict.winner.precedence)})</span></>,
                    },
                    {
                      label: tt("context.overridden"),
                      value: <>{conflict.overridden.value} <span className="pi-muted">({conflict.overridden.source}, {label("precedence", conflict.overridden.precedence)})</span></>,
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="pi-subtitle">{tt("context.excluded")}</h4>
        {excludedCounts.length === 0 ? (
          <p className="pi-muted">{tt("context.noExcluded")}</p>
        ) : (
          <ul className="pi-list">
            {excludedCounts.map((entry) => (
              <li key={entry.reason} className="pi-list__item">{label("excluded", entry.reason)}: {entry.count}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="pi-subtitle">{tt("context.missing")}</h4>
        {context.missing.length === 0 ? (
          <p className="pi-muted">{tt("context.noMissing")}</p>
        ) : (
          <ul className="pi-list">
            {context.missing.map((category) => (
              <li key={category} className="pi-list__item">
                <Tag tone="warning">{label("contextCategory", category)}</Tag>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="pi-subtitle">{tt("context.sources")}</h4>
        {context.sources.length === 0 ? (
          <Unavailable />
        ) : (
          <ul className="pi-list">
            {context.sources.map((source) => (
              <li key={source.source} className="pi-list__item">
                <span className="pi-strong">{source.source}</span>{" "}
                <Tag tone={source.status === "ok" ? "success" : source.status === "empty" ? "neutral" : "danger"}>
                  {label("sourceStatus", source.status)}
                </Tag>{" "}
                <span className="pi-muted">{tt("context.fragmentCount", { count: source.fragments })}</span>
                {source.note ? <span className="pi-muted pi-block">{source.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function PromptSection({ view }: { view: PromptRequestView }) {
  const { tt, label } = useT();
  const { prompt } = view.record;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(prompt.text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const sectionEntries = Object.entries(prompt.sections).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0,
  );

  return (
    <Section id="pi-sec-prompt" step={4} title={tt("prompt.title")}>
      <div className="pi-actions">
        <Tag>{tt("prompt.version", { version: prompt.version })}</Tag>
        <Button type="button" onClick={() => { void copy(); }}>
          <Copy size={16} aria-hidden /> {tt("prompt.copy")}
        </Button>
        <span role="status" aria-live="polite" className="pi-muted">
          {copyState === "copied" ? tt("prompt.copied") : copyState === "failed" ? tt("prompt.copyFailed") : ""}
        </span>
      </div>
      {prompt.text.trim().length > 0 ? <pre className="pi-pre" tabIndex={0} aria-label={tt("prompt.textLabel")}>{prompt.text}</pre> : <Unavailable />}
      <details className="pi-details">
        <summary>{tt("prompt.structured")}</summary>
        {sectionEntries.length === 0 ? (
          <Unavailable />
        ) : (
          <div className="pi-stack">
            {sectionEntries.map(([name, value]) => (
              <div key={name}>
                <h4 className="pi-subtitle">{label("promptSection", name)}</h4>
                {Array.isArray(value) ? <TextList items={value as string[]} /> : <p>{String(value)}</p>}
              </div>
            ))}
          </div>
        )}
      </details>
    </Section>
  );
}

function ValidationSection({ view }: { view: PromptRequestView }) {
  const { tt, label } = useT();
  const { validation } = view.record;
  return (
    <Section id="pi-sec-validation" step={5} title={tt("validation.title")}>
      <p>
        <StatusTag status={validation.status} /> <span className="pi-muted">{label("statusHelp", validation.status)}</span>
      </p>
      <div>
        <h4 className="pi-subtitle">{tt("validation.checks")}</h4>
        {validation.checks.length === 0 ? (
          <Unavailable />
        ) : (
          <ul className="pi-list">
            {validation.checks.map((check: PromptValidationCheck) => {
              const style = CHECK_VIEW[check.outcome] ?? CHECK_VIEW.info;
              return (
                <li key={check.key} className="pi-list__item">
                  <Tag tone={style.tone} icon={style.icon}>{label("outcome", check.outcome)}</Tag>{" "}
                  <span className="pi-strong">{check.title}</span>
                  <span className="pi-muted pi-block">{check.detail}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {validation.reasons.length > 0 ? (
        <div>
          <h4 className="pi-subtitle">{tt("validation.reasons")}</h4>
          <TextList items={validation.reasons} />
        </div>
      ) : null}
      {validation.status === "CLARIFY" ? (
        <div>
          <h4 className="pi-subtitle">{tt("validation.clarifications")}</h4>
          <TextList items={validation.clarifications} />
        </div>
      ) : null}
    </Section>
  );
}

function CapabilitySection({ view }: { view: PromptRequestView }) {
  const { tt, label } = useT();
  const capabilities = view.execution.requiredCapabilities;
  return (
    <Section id="pi-sec-capability" step={6} title={tt("capability.title")}>
      <Notice>{tt("capability.note")}</Notice>
      {capabilities.length === 0 ? (
        <p className="pi-muted">{tt("capability.none")}</p>
      ) : (
        <ul className="pi-cards">
          {capabilities.map((item) => (
            <li key={`${item.capability}-${item.role}`} className="pi-card">
              <p className="pi-card__head">
                <code className="pi-code pi-strong">{item.capability}</code> <Tag>{label("role", item.role)}</Tag>
              </p>
              <p className="pi-muted">{item.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The next step is derived ONLY from `execution`. There is no execute control anywhere in this phase. */
function NextStepSection({ view, canPrepare, onRequestApproval, approvalPending, approvalError, onDismissApprovalError }: ResultViewProps) {
  const { tt } = useT();
  const { execution, record } = view;
  const approvalState = execution.approval.state;
  const link = <Link to="/approvals" className="pi-link">{tt("next.openApprovals")}</Link>;
  let body;
  if (execution.executionReady) {
    body = (
      <Notice>
        <strong>{tt("next.readyTitle")}</strong>
        <p>{tt("next.readyBody")}</p>
      </Notice>
    );
  } else if (execution.validation === "BLOCKED") {
    body = (
      <Notice tone="warning">
        <strong>{tt("next.blockedTitle")}</strong>
        <TextList items={[...record.validation.reasons, ...execution.blockedBy]} emptyLabel={tt("common.unavailable")} />
      </Notice>
    );
  } else if (execution.validation === "CLARIFY") {
    body = (
      <Notice tone="warning">
        <strong>{tt("next.clarifyTitle")}</strong>
        <p>{tt("next.clarifyBody")}</p>
        <TextList items={record.validation.clarifications} emptyLabel={tt("common.unavailable")} />
      </Notice>
    );
  } else if (approvalState === "requested") {
    body = (
      <Notice>
        <strong>{tt("next.waitingTitle")}</strong>
        <p>{tt("next.waitingBody")}</p>
        <p>{link}</p>
      </Notice>
    );
  } else if (approvalState === "rejected" || approvalState === "expired") {
    body = (
      <Notice tone="warning">
        <strong>{approvalState === "rejected" ? tt("next.rejectedTitle") : tt("next.expiredTitle")}</strong>
        <p>{tt("next.rejectedBody")}</p>
        <TextList items={execution.blockedBy} emptyLabel={tt("common.unavailable")} />
        <p>{link}</p>
      </Notice>
    );
  } else if (approvalState === "required") {
    body = (
      <Notice tone="warning">
        <strong>{tt("next.approvalTitle")}</strong>
        <p>{tt("next.approvalBody")}</p>
        <TextList items={execution.blockedBy} emptyLabel={tt("common.unavailable")} />
        <p>{link}</p>
        {canPrepare ? (
          <div className="pi-actions">
            <Button type="button" variant="primary" loading={approvalPending} disabled={approvalPending} onClick={onRequestApproval}>
              {approvalPending ? tt("next.requesting") : tt("next.requestApproval")}
            </Button>
          </div>
        ) : (
          <p className="pi-muted">{tt("next.cannotRequest")}</p>
        )}
      </Notice>
    );
  } else {
    body = (
      <Notice tone="warning">
        <strong>{tt("next.notReadyTitle")}</strong>
        <TextList items={execution.blockedBy} emptyLabel={tt("common.unavailable")} />
      </Notice>
    );
  }
  return (
    <Section id="pi-sec-next" step={7} title={tt("next.title")}>
      {body}
      <ErrorPanel error={approvalError} onDismiss={onDismissApprovalError} onRetry={approvalError ? onRequestApproval : undefined} />
      <p className="pi-muted">{tt("next.noExecute")}</p>
    </Section>
  );
}
