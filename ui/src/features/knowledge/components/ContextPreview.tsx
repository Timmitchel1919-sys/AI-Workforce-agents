import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "../../../components/ui";
import { useContextPreview } from "../hooks/useKnowledge";
import { budgetPercent } from "../lib/logic";
import { useT } from "../lib/useT";
import { CONTEXT_ROLES, CONTEXT_SECTIONS, type ContextItem, type ContextPackage, type ContextRole } from "../types";
import { ErrorPanel, Notice, NeedsProject, Skeleton, Tag } from "./common";

function ItemView({ item }: { item: ContextItem }) {
  const { tt, label } = useT();
  return (
    <li className="kn-ctx-item" data-memory-id={item.memoryId}>
      <strong>{item.title}</strong>
      <p className="kn-text">{item.text}</p>
      <p className="kn-muted">{tt("context.citation", { citation: item.citation })}</p>
      <p className="kn-muted">{tt("context.why", { why: item.why })}</p>
      <div className="kn-row__meta">
        <Tag>{label("confidence", item.confidence)}</Tag>
        <Tag>{label("importance", item.importance)}</Tag>
        {item.stale ? <Tag tone="warning">{label("freshness", "POTENTIALLY_STALE")}</Tag> : null}
        {item.conflict ? <Tag tone="danger">{tt("context.conflictItem")}</Tag> : null}
      </div>
    </li>
  );
}

export function ContextResult({ context }: { context: ContextPackage }) {
  const { tt, label } = useT();
  const percent = budgetPercent(context.budget.usedChars, context.budget.limitChars);
  const reasons = context.excluded.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.reason]: (acc[entry.reason] ?? 0) + 1 }), {});
  return (
    <div className="kn-stack" data-testid="context-result">
      {context.status === "KNOWLEDGE_CONFLICT_DETECTED" ? (
        <div className="kn-alert kn-alert--warning" role="alert" data-testid="context-conflict-banner">
          <div>
            <strong>{tt("context.conflictTitle")}</strong>
            <p>{tt("context.conflictBody", { count: context.conflicts.length })}</p>
            <ul className="kn-list">
              {context.conflicts.map((conflict) => (
                <li key={conflict.conflictId}>{conflict.facet}: {conflict.titles[0]} / {conflict.titles[1]}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <div>
        <progress className="kn-progress" max={context.budget.limitChars} value={context.budget.usedChars} aria-label={tt("context.budget")} />
        <p className="kn-muted">{tt("context.budgetUsed", { used: context.budget.usedChars, limit: context.budget.limitChars, percent })}</p>
      </div>
      <p className="kn-muted" data-testid="context-excluded">
        {tt("context.excluded", { count: context.excluded.length })}
        {context.excluded.length > 0
          ? ` (${Object.entries(reasons).map(([reason, count]) => `${label("excludedReason", reason)}: ${count}`).join(", ")})`
          : ""}
      </p>
      {CONTEXT_SECTIONS.map((section) => {
        const items = context.items.filter((item) => item.section === section);
        const texts = context.sections[section] ?? [];
        if (items.length === 0 && texts.length === 0) return null;
        return (
          <section key={section} className="kn-sub" aria-labelledby={`kn-ctx-${section}`}>
            <h4 id={`kn-ctx-${section}`} className="kn-sub__title">{label("section", section)}</h4>
            {items.length > 0 ? (
              <ul className="kn-list">{items.map((item) => <ItemView key={item.memoryId} item={item} />)}</ul>
            ) : (
              <ul className="kn-list">{texts.map((text, index) => <li key={`${index}-${text}`} className="kn-text">{text}</li>)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** "What would an agent be given for this question?" - read-only; nothing is stored. */
export function ContextPreview({ projectId }: { projectId: string | undefined }) {
  const { tt, label } = useT();
  const [question, setQuestion] = useState("");
  const [role, setRole] = useState<ContextRole>("developer");
  const [request, setRequest] = useState<{ projectId: string; q: string; role: ContextRole } | null>(null);
  const query = useContextPreview(request);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!projectId || question.trim().length === 0) return;
    setRequest({ projectId, q: question.trim(), role });
  };

  return (
    <section className="kn-panel" aria-labelledby="kn-context-heading">
      <h2 id="kn-context-heading" className="kn-panel__title">{tt("context.title")}</h2>
      <p className="kn-muted">{tt("context.description")}</p>
      {!projectId ? <NeedsProject /> : (
        <form className="kn-form" onSubmit={submit}>
          <Input label={tt("context.question")} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} />
          <Select label={tt("context.role")} value={role} onChange={(event) => setRole(event.target.value as ContextRole)}>
            {CONTEXT_ROLES.map((r) => <option key={r} value={r}>{label("role", r)}</option>)}
          </Select>
          <div className="kn-actions">
            <Button type="submit" variant="primary" disabled={question.trim().length === 0}>{tt("context.preview")}</Button>
          </div>
        </form>
      )}
      {query.isFetching ? <Skeleton label={tt("context.loading")} /> : null}
      {query.error ? <ErrorPanel error={query.error} /> : null}
      {query.data && !query.isFetching ? <ContextResult context={query.data} /> : null}
      {!request && projectId ? <Notice>{tt("context.hint")}</Notice> : null}
    </section>
  );
}
