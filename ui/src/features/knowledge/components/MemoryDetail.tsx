import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button, Dialog, Input, Select, Textarea } from "../../../components/ui";
import { useCanManage, useKnowledgeCommand, useMemory } from "../hooks/useKnowledge";
import { deleteBlockReason, projectSearch, splitTags } from "../lib/logic";
import { useT } from "../lib/useT";
import { IMPORTANCES, type CommandInput, type Importance, type MemoryDetail as MemoryDetailData, type MemoryLink } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { DefList, ErrorPanel, FreshnessTag, Notice, Skeleton, StatusTag, Tag, Unavailable } from "./common";

type Dialogs = null | "edit" | "supersede" | "archive" | "revoke" | "delete";

function LinkedMemory({ link, search }: { link: MemoryLink | null; search: string }) {
  if (!link) return <Unavailable />;
  return (
    <span className="kn-inline">
      <Link className="kn-link" to={`/knowledge/memories/${encodeURIComponent(link.memoryId)}${search}`}>{link.title}</Link>
      <StatusTag status={link.status} />
    </span>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="kn-panel" aria-labelledby={id}>
      <h3 id={id} className="kn-panel__title">{title}</h3>
      {children}
    </section>
  );
}

function EditDialog({ data, onClose, run, pending, error }: { data: MemoryDetailData; onClose: () => void; run: (input: CommandInput) => void; pending: boolean; error: unknown }) {
  const { tt, label } = useT();
  const m = data.memory;
  const [title, setTitle] = useState(m.title);
  const [content, setContent] = useState(m.content);
  const [tags, setTags] = useState(m.tags.join(", "));
  const [importance, setImportance] = useState<Importance>(m.importance);
  const [reason, setReason] = useState("");
  const valid = title.trim().length > 0 && content.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    run({
      command: "knowledge_update_memory",
      body: {
        memoryId: m.memoryId, title: title.trim(), content: content.trim(), tags: splitTags(tags), importance,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
    });
  };
  return (
    <Dialog open onClose={onClose} title={tt("actions.editTitle")}>
      <form className="kn-form" onSubmit={submit}>
        <Input label={tt("create.titleField")} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <Textarea label={tt("create.content")} value={content} rows={6} onChange={(event) => setContent(event.target.value)} />
        <Input label={tt("create.tags")} description={tt("create.tagsHint")} value={tags} onChange={(event) => setTags(event.target.value)} />
        <Select label={tt("filters.importance")} value={importance} onChange={(event) => setImportance(event.target.value as Importance)}>
          {IMPORTANCES.map((v) => <option key={v} value={v}>{label("importance", v)}</option>)}
        </Select>
        <Input label={tt("actions.reason")} value={reason} onChange={(event) => setReason(event.target.value)} />
        {error ? <ErrorPanel error={error} /> : null}
        <div className="kn-actions">
          <Button type="submit" variant="primary" loading={pending} disabled={!valid}>{tt("actions.save")}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SupersedeDialog({ data, onClose, run, pending, error }: { data: MemoryDetailData; onClose: () => void; run: (input: CommandInput) => void; pending: boolean; error: unknown }) {
  const { tt, label } = useT();
  const m = data.memory;
  const [title, setTitle] = useState(m.title);
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState<Importance>(m.importance);
  const valid = title.trim().length > 0 && content.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    run({ command: "knowledge_supersede_memory", body: { memoryId: m.memoryId, title: title.trim(), content: content.trim(), importance } });
  };
  return (
    <Dialog open onClose={onClose} title={tt("actions.supersedeTitle")} description={tt("actions.supersedeHelp")}>
      <form className="kn-form" onSubmit={submit}>
        <Input label={tt("actions.replacementTitle")} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <Textarea label={tt("actions.replacementText")} value={content} rows={6} onChange={(event) => setContent(event.target.value)} />
        <Select label={tt("filters.importance")} value={importance} onChange={(event) => setImportance(event.target.value as Importance)}>
          {IMPORTANCES.map((v) => <option key={v} value={v}>{label("importance", v)}</option>)}
        </Select>
        {error ? <ErrorPanel error={error} /> : null}
        <div className="kn-actions">
          <Button type="submit" variant="primary" loading={pending} disabled={!valid}>{tt("actions.supersedeConfirm")}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Actions({ data, search }: { data: MemoryDetailData; search: string }) {
  const { tt } = useT();
  const navigate = useNavigate();
  const m = data.memory;
  const command = useKnowledgeCommand();
  const [dialog, setDialog] = useState<Dialogs>(null);

  const open = (next: Dialogs) => { command.reset(); setDialog(next); };
  const close = () => { setDialog(null); command.reset(); };
  const run = (input: CommandInput, after?: (details: Record<string, unknown>) => void) =>
    command.mutate(input, { onSuccess: (result) => { setDialog(null); after?.(result.details); } });
  const direct = (name: CommandInput["command"]) => run({ command: name, body: { memoryId: m.memoryId } });
  const withReason = (name: CommandInput["command"], reason: string) =>
    run({ command: name, body: { memoryId: m.memoryId, ...(reason ? { reason } : {}) } });

  const live = m.status === "ACTIVE" || m.status === "DRAFT";
  const blocked = deleteBlockReason(m);

  return (
    <section className="kn-panel" aria-labelledby="kn-actions-heading">
      <h3 id="kn-actions-heading" className="kn-panel__title">{tt("actions.title")}</h3>
      <div className="kn-actions">
        {live ? <Button type="button" variant="secondary" onClick={() => open("edit")}>{tt("actions.edit")}</Button> : null}
        {m.status === "DRAFT" ? <Button type="button" variant="primary" loading={command.isPending} onClick={() => direct("knowledge_confirm_memory")}>{tt("actions.confirm")}</Button> : null}
        {live ? <Button type="button" variant="secondary" onClick={() => open("archive")}>{tt("actions.archive")}</Button> : null}
        {m.status === "ARCHIVED" ? <Button type="button" variant="secondary" loading={command.isPending} onClick={() => direct("knowledge_restore_memory")}>{tt("actions.restore")}</Button> : null}
        {m.status === "ACTIVE" ? <Button type="button" variant="secondary" onClick={() => open("supersede")}>{tt("actions.supersede")}</Button> : null}
        {live ? <Button type="button" variant="danger" onClick={() => open("revoke")}>{tt("actions.revoke")}</Button> : null}
        {blocked === null ? <Button type="button" variant="danger" onClick={() => open("delete")}>{tt("actions.delete")}</Button> : null}
      </div>
      {blocked === "protected" ? <Notice title={tt("actions.noDeleteTitle")}>{tt("actions.noDeleteProtected")}</Notice> : null}
      {blocked === "status" ? <Notice title={tt("actions.noDeleteTitle")}>{tt("actions.noDeleteStatus")}</Notice> : null}
      {command.error && dialog === null ? <ErrorPanel error={command.error} focus /> : null}

      {dialog === "edit" ? <EditDialog data={data} onClose={close} run={(input) => run(input)} pending={command.isPending} error={command.error} /> : null}
      {dialog === "supersede" ? (
        <SupersedeDialog
          data={data}
          onClose={close}
          pending={command.isPending}
          error={command.error}
          run={(input) => run(input, (details) => {
            const next = typeof details.memoryId === "string" ? details.memoryId : undefined;
            if (next) void navigate(`/knowledge/memories/${encodeURIComponent(next)}${search}`);
          })}
        />
      ) : null}
      {dialog === "archive" ? (
        <ConfirmDialog open title={tt("actions.archiveTitle")} description={tt("actions.archiveHelp")} confirmLabel={tt("actions.archive")}
          noteLabel={tt("actions.reason")} pending={command.isPending} error={command.error} onCancel={close}
          onConfirm={(reason) => withReason("knowledge_archive_memory", reason)} />
      ) : null}
      {dialog === "revoke" ? (
        <ConfirmDialog open danger title={tt("actions.revokeTitle")} description={tt("actions.revokeHelp")} confirmLabel={tt("actions.revoke")}
          noteLabel={tt("actions.reason")} pending={command.isPending} error={command.error} onCancel={close}
          onConfirm={(reason) => withReason("knowledge_revoke_memory", reason)} />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog open danger title={tt("actions.deleteTitle")} description={tt("actions.deleteHelp")} confirmLabel={tt("actions.delete")}
          pending={command.isPending} error={command.error} onCancel={close}
          onConfirm={() => run({ command: "knowledge_delete_memory", body: { memoryId: m.memoryId } }, () => void navigate(`/knowledge/memories${search}`))} />
      ) : null}
    </section>
  );
}

export function MemoryDetailView({ memoryId }: { memoryId: string }) {
  const { tt, label, formatTime } = useT();
  const canManage = useCanManage();
  const location = useLocation();
  const search = location.search;
  const { data, error, isLoading, refetch } = useMemory(memoryId);

  const back = (
    <Link to={`/knowledge/memories${search}`} className="kn-link kn-back"><ArrowLeft size={14} aria-hidden /> {tt("detail.back")}</Link>
  );
  if (error && !data) {
    return <div className="kn-stack">{back}<ErrorPanel error={error} onRetry={() => void refetch()} focus /></div>;
  }
  if (isLoading || !data) return <Skeleton label={tt("detail.loading")} />;

  const m = data.memory;
  return (
    <div className="kn-stack">
      {back}
      <article className="kn-panel" aria-labelledby="kn-detail-title">
        <h2 id="kn-detail-title" className="kn-panel__title">{m.title}</h2>
        <div className="kn-row__meta">
          <Tag>{label("type", m.type)}</Tag>
          <StatusTag status={m.status} />
          <FreshnessTag freshness={m.freshness} />
          <Tag>{label("confidence", m.confidence)}</Tag>
          <Tag>{label("importance", m.importance)}</Tag>
        </div>
        <pre className="kn-content" tabIndex={0} aria-label={tt("detail.content")}>{m.content}</pre>
        <DefList items={[
          { label: tt("detail.project"), value: m.projectId ?? tt("detail.noProject") },
          { label: tt("detail.created"), value: formatTime(m.createdAt) },
          { label: tt("detail.updated"), value: formatTime(m.updatedAt) },
          { label: tt("detail.version"), value: m.version },
          { label: tt("detail.retention"), value: m.retention === "TEMPORARY" && m.expiresAt ? tt("detail.expires", { when: formatTime(m.expiresAt) }) : label("retention", m.retention) },
          { label: tt("detail.tags"), value: m.tags.length > 0 ? m.tags.join(", ") : <Unavailable /> },
          { label: tt("detail.statusReason"), value: m.statusReason ?? <Unavailable /> },
          { label: tt("detail.reinforced"), value: m.reinforced },
          { label: tt("detail.agent"), value: m.agentId ?? <Unavailable /> },
        ]} />
      </article>

      <Section id="kn-prov" title={tt("detail.provenance")}>
        <p className="kn-text" data-testid="provenance-answer">{data.provenance.answer}</p>
        <DefList items={[
          { label: tt("detail.source"), value: label("source", data.provenance.source) },
          { label: tt("detail.sourceRef"), value: data.provenance.sourceRef ?? <Unavailable /> },
          { label: tt("detail.createdBy"), value: data.provenance.createdBy },
          { label: tt("detail.created"), value: formatTime(data.provenance.createdAt) },
        ]} />
      </Section>

      <Section id="kn-chain" title={tt("detail.supersession")}>
        <DefList items={[
          { label: tt("detail.supersedes"), value: <LinkedMemory link={data.supersedes} search={search} /> },
          { label: tt("detail.supersededBy"), value: <LinkedMemory link={data.supersededBy} search={search} /> },
        ]} />
      </Section>

      <Section id="kn-refs" title={tt("detail.references")}>
        {m.references.length === 0 ? <p className="kn-muted">{tt("detail.noReferences")}</p> : (
          <ul className="kn-list">
            {m.references.map((ref, index) => (
              <li key={`${index}-${ref.ref}`}><Tag>{ref.kind}</Tag> <code className="kn-inline-code">{ref.ref}</code>{ref.note ? ` - ${ref.note}` : ""}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="kn-related" title={tt("detail.related")}>
        {data.related.length === 0 ? <p className="kn-muted">{tt("detail.noRelated")}</p> : (
          <ul className="kn-list">
            {data.related.map((rel, index) => (
              <li key={`${index}-${rel.node}`}>
                <Tag>{label("relation", rel.relation)}</Tag>{" "}
                <span aria-hidden>{rel.direction === "out" ? "→" : "←"}</span>
                <span className="kn-visually-hidden">{tt(rel.direction === "out" ? "detail.outgoing" : "detail.incoming")}</span>{" "}
                {rel.memoryId
                  ? <Link className="kn-link" to={`/knowledge/memories/${encodeURIComponent(rel.memoryId)}${search}`}>{rel.label}</Link>
                  : <span>{rel.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="kn-versions" title={tt("detail.versions")}>
        <div className="kn-table-wrap">
          <table className="kn-table">
            <caption className="kn-visually-hidden">{tt("detail.versions")}</caption>
            <thead><tr><th scope="col">{tt("detail.version")}</th><th scope="col">{tt("detail.when")}</th><th scope="col">{tt("detail.by")}</th><th scope="col">{tt("detail.change")}</th><th scope="col">{tt("detail.status")}</th></tr></thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={`${v.version}-${v.at}`}>
                  <td>{v.version}</td><td>{formatTime(v.at)}</td><td>{v.by}</td><td>{v.change}</td><td><StatusTag status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="kn-usage" title={tt("detail.usage")}>
        {data.usage.length === 0 ? <p className="kn-muted">{tt("detail.noUsage")}</p> : (
          <div className="kn-table-wrap">
            <table className="kn-table">
              <caption className="kn-visually-hidden">{tt("detail.usage")}</caption>
              <thead><tr><th scope="col">{tt("detail.task")}</th><th scope="col">{tt("detail.agent")}</th><th scope="col">{tt("detail.reason")}</th><th scope="col">{tt("detail.result")}</th><th scope="col">{tt("detail.when")}</th></tr></thead>
              <tbody>
                {data.usage.map((u) => (
                  <tr key={`${u.taskId}-${u.at}`}>
                    <td>{u.taskId}</td><td>{u.agentId}</td><td>{u.reason}</td>
                    <td><Tag tone={u.result === "TASK_SUCCEEDED" ? "success" : u.result === "TASK_FAILED" ? "danger" : "neutral"}>{label("usageResult", u.result)}</Tag></td>
                    <td>{formatTime(u.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="kn-conflicts" title={tt("detail.conflicts")}>
        {data.conflicts.length === 0 ? <p className="kn-muted">{tt("detail.noConflicts")}</p> : (
          <ul className="kn-list">
            {data.conflicts.map((c) => (
              <li key={c.conflictId}>
                <strong>{c.facet}</strong>: {c.titles[0]} ({c.values[0]}) / {c.titles[1]} ({c.values[1]}) -{" "}
                <Link className="kn-link" to={`/knowledge/conflicts${projectSearch(search)}`}>{tt("detail.resolve")}</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canManage ? <Actions data={data} search={search} /> : <p className="kn-muted">{tt("common.readOnly")}</p>}
    </div>
  );
}
