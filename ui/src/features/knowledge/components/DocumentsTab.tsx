import { useState, type FormEvent } from "react";
import { Button, Input, Select, Textarea } from "../../../components/ui";
import { useCanManage, useDocuments, useKnowledgeCommand } from "../hooks/useKnowledge";
import { useT } from "../lib/useT";
import type { IngestReport } from "../types";
import type { ProjectOption } from "../../projectScope/projectScope";
import { Empty, ErrorPanel, Notice, Skeleton, Tag } from "./common";

export function IngestReportView({ report }: { report: IngestReport }) {
  const { tt, label } = useT();
  const tone = report.status === "ingested" ? "success" : report.status === "skipped" ? "warning" : "info";
  return (
    <section className="kn-sub" aria-labelledby="kn-ingest-report" data-testid="ingest-report">
      <h3 id="kn-ingest-report" className="kn-sub__title">{tt("documents.reportTitle", { ref: report.ref })}</h3>
      <div className="kn-row__meta">
        <Tag tone={tone}>{label("ingestStatus", report.status)}</Tag>
        <Tag>{tt("documents.reportChunks", { count: report.chunks })}</Tag>
        <Tag tone={report.redacted > 0 ? "warning" : "neutral"}>{tt("documents.reportRedacted", { count: report.redacted })}</Tag>
        <Tag>{tt("documents.reportStale", { count: report.staleMarked.length })}</Tag>
      </div>
      {report.reason ? <Notice tone="warning" title={tt("documents.reportSkipped")}>{report.reason}</Notice> : null}
      <ul className="kn-list">
        <li>{tt("documents.reportCreated", { count: report.created.length })}</li>
        <li>{tt("documents.reportReinforced", { count: report.reinforced.length })}</li>
        <li>{tt("documents.reportArchived", { count: report.archived.length })}</li>
      </ul>
      {report.steps.length > 0 ? (
        <ol className="kn-list" aria-label={tt("documents.reportSteps")}>
          {report.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
        </ol>
      ) : null}
    </section>
  );
}

function IngestForm({ projects, defaultProjectId }: { projects: readonly ProjectOption[]; defaultProjectId: string | undefined }) {
  const { tt } = useT();
  const command = useKnowledgeCommand();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.projectId ?? "");
  const [ref, setRef] = useState("");
  const [text, setText] = useState("");
  const effective = projectId || defaultProjectId || "";
  const valid = effective.length > 0 && ref.trim().length > 0 && text.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    command.mutate({ command: "knowledge_ingest_document", body: { projectId: effective, ref: ref.trim(), text } });
  };
  return (
    <section className="kn-panel" aria-labelledby="kn-ingest-heading">
      <h2 id="kn-ingest-heading" className="kn-panel__title">{tt("documents.ingestTitle")}</h2>
      <p className="kn-muted">{tt("documents.ingestHelp")}</p>
      <form className="kn-form" onSubmit={submit}>
        <Select label={tt("filters.project")} value={effective} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
        </Select>
        <Input label={tt("documents.ref")} description={tt("documents.refHint")} value={ref} onChange={(event) => setRef(event.target.value)} />
        <Textarea label={tt("documents.text")} value={text} rows={8} onChange={(event) => setText(event.target.value)} />
        <div className="kn-actions">
          <Button type="submit" variant="primary" loading={command.isPending} disabled={!valid}>{tt("documents.ingest")}</Button>
        </div>
      </form>
      {command.error ? <ErrorPanel error={command.error} /> : null}
      {command.data ? <IngestReportView report={command.data.details as unknown as IngestReport} /> : null}
    </section>
  );
}

export function DocumentsTab({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt, formatTime } = useT();
  const canManage = useCanManage();
  const query = useDocuments(projectId);
  return (
    <div className="kn-stack">
      <section className="kn-panel" aria-labelledby="kn-docs-heading">
        <h2 id="kn-docs-heading" className="kn-panel__title">{tt("documents.title")}</h2>
        {query.error ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {query.data && query.data.length === 0 ? <Empty title={tt("documents.emptyTitle")} body={tt("documents.emptyBody")} /> : null}
        {query.data && query.data.length > 0 ? (
          <div className="kn-table-wrap">
            <table className="kn-table">
              <caption className="kn-visually-hidden">{tt("documents.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{tt("documents.ref")}</th><th scope="col">{tt("filters.project")}</th><th scope="col">{tt("documents.chunks")}</th>
                  <th scope="col">{tt("documents.state")}</th><th scope="col">{tt("detail.tags")}</th><th scope="col">{tt("documents.ingestedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((doc) => (
                  <tr key={`${doc.projectId}:${doc.ref}`}>
                    <td className="kn-cell-wrap">{doc.ref}</td><td>{doc.projectId}</td><td>{doc.chunks}</td>
                    <td>
                      <Tag tone={doc.active ? "success" : "neutral"}>{doc.active ? tt("documents.active") : tt("documents.inactive")}</Tag>{" "}
                      {doc.potentiallyStale ? <Tag tone="warning">{tt("documents.stale")}</Tag> : null}
                    </td>
                    <td>{doc.tags.join(", ")}</td><td>{formatTime(doc.ingestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {canManage ? <IngestForm projects={projects} defaultProjectId={projectId} /> : <p className="kn-muted">{tt("common.readOnly")}</p>}
    </div>
  );
}
