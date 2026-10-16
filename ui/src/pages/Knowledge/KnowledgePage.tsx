import { useState, type ChangeEvent, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useAuth } from "../../auth/useAuth";
import { ProjectPicker } from "../../features/projectScope/ProjectPicker";
import { useActiveProject } from "../../features/projectScope/useActiveProject";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "../Operations/OperationsPage.css";

const KINDS = ["architecture_decision", "documentation", "specification", "research", "procedure", "lesson_learned", "note"] as const;

interface KDoc {
  documentId: string;
  title: string;
  kind: (typeof KINDS)[number];
  tags: string[];
  status: string;
  latestVersion: number;
  updatedAt: string;
  updatedBy: string;
  bytes: number;
}
interface Hit {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
}

/**
 * Knowledge & Memory (UI Layer 13): project-scoped, versioned knowledge in the
 * Control Plane. Reads and keyword search are server-side; writes are audited
 * commands. Content is rendered as text only (never HTML).
 */
export function KnowledgePage() {
  const { t, language } = useI18n();
  const { accessToken, accessDetails } = useAuth();
  const active = useActiveProject();
  const projectId = active.projectId ?? "";
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [editing, setEditing] = useState<{ documentId?: string; title: string; kind: string; tags: string; content: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canAuthor = accessDetails.capabilities.includes("author_knowledge");
  const base = `/api/projects/${encodeURIComponent(projectId)}`;

  const list = useQuery({
    queryKey: ["knowledge", projectId, "list"],
    queryFn: () => apiRequest<{ items: KDoc[] }>(`${base}/knowledge`, { accessToken }),
    enabled: Boolean(projectId),
    retry: false,
  });
  const query = params.get("q") ?? "";
  const search = useQuery({
    queryKey: ["knowledge", projectId, "search", query],
    queryFn: () => apiRequest<{ items: Hit[] }>(`${base}/knowledge-search?q=${encodeURIComponent(query)}`, { accessToken }),
    enabled: Boolean(projectId && query),
    retry: false,
  });

  const open = async (documentId: string) => {
    const d = await apiRequest<{ document: KDoc; content: string | null }>(`${base}/knowledge/${encodeURIComponent(documentId)}`, { accessToken });
    setEditing({ documentId, title: d.document.title, kind: d.document.kind, tags: d.document.tags.join(", "), content: d.content ?? "" });
  };

  const command = async (name: string, body: Record<string, unknown>) => {
    setNotice(null);
    try {
      const r = await apiRequest<{ details: { version?: number } }>(`/api/commands/${name}`, {
        method: "POST",
        accessToken,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, ...body }),
      });
      await client.invalidateQueries({ queryKey: ["knowledge", projectId] });
      return r;
    } catch (e) {
      setNotice(e instanceof ApiError ? (e.reason ?? e.message) : String(e));
      return null;
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const r = await command("save-knowledge-document", {
      ...(editing.documentId ? { documentId: editing.documentId } : {}),
      title: editing.title,
      kind: editing.kind,
      tags: editing.tags.split(",").map((s) => s.trim()).filter(Boolean),
      content: editing.content,
    });
    if (r) {
      setNotice(t("knowledgeCenter.saved", { version: r.details.version ?? "?" }));
      setEditing(null);
    }
  };

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !editing || !/\.(txt|md|markdown)$/i.test(f.name) || f.size > 200 * 1024) return;
    setEditing({ ...editing, title: editing.title || f.name, content: await f.text() });
  };

  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("knowledgeCenter.title")} description={t("knowledgeCenter.description")} />
      <p className="ops-muted">{t("knowledgeCenter.gaps")}</p>
      <div className="ops-filters">
        <ProjectPicker projects={active.projects} value={projectId} onChange={active.select} />
      </div>
      {notice ? <p role="status">{notice}</p> : null}

      <form
        className="ops-card ops-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setParams((p) => {
            const n = new URLSearchParams(p);
            if (q.trim()) n.set("q", q.trim());
            else n.delete("q");
            return n;
          });
        }}
      >
        <label className="ops-field">
          <span>{t("knowledgeCenter.search")}</span>
          <input type="search" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" className="ui-button primary">{t("knowledgeCenter.searchButton")}</button>
        <p className="ops-muted">{t("knowledgeCenter.keywordOnly")}</p>
      </form>

      {query && search.data ? (
        <section className="ops-card" style={{ marginTop: 12 }} aria-live="polite">
          {search.data.items.length === 0 ? <p className="ops-muted">{t("knowledgeCenter.noResults")}</p> : null}
          <ul className="ops-list">
            {search.data.items.map((h) => (
              <li key={h.documentId}>
                <button type="button" className="ui-button ghost" onClick={() => void open(h.documentId)}>{h.title}</button>
                <div className="ops-muted">…{h.snippet}…</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ops-card" style={{ marginTop: 12 }}>
        <div className="ops-filters">
          <h2>{t("knowledgeCenter.documents")}</h2>
          {canAuthor ? (
            <button type="button" className="ui-button ghost" onClick={() => setEditing({ title: "", kind: "note", tags: "", content: "" })}>
              {t("knowledgeCenter.newDoc")}
            </button>
          ) : (
            <span className="ops-muted">{t("knowledgeCenter.readOnly")}</span>
          )}
        </div>
        {list.error ? <p role="alert">{t("knowledgeCenter.loadFailed")}</p> : null}
        {list.data && list.data.items.length === 0 ? <p className="ops-muted">{t("knowledgeCenter.empty")}</p> : null}
        <ul className="ops-list">
          {list.data?.items.map((d) => (
            <li key={d.documentId}>
              <button type="button" className="ui-button ghost" onClick={() => void open(d.documentId)}>{d.title}</button>{" "}
              · {t(`knowledgeCenter.kinds.${d.kind}` as MessageKey)} · {t("knowledgeCenter.version", { version: d.latestVersion })} · {d.status} ·{" "}
              {formatDateTime(d.updatedAt, language)}
              {d.tags.length ? ` · #${d.tags.join(" #")}` : ""}
            </li>
          ))}
        </ul>
      </section>

      {editing ? (
        <form className="ops-card" style={{ marginTop: 12 }} onSubmit={(e) => void save(e)}>
          <div className="ops-filters">
            <label className="ops-field">
              <span>{t("knowledgeCenter.titleLabel")}</span>
              <input value={editing.title} maxLength={200} required disabled={!canAuthor} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label className="ops-field">
              <span>{t("knowledgeCenter.kind")}</span>
              <select value={editing.kind} disabled={!canAuthor} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`knowledgeCenter.kinds.${k}` as MessageKey)}</option>)}
              </select>
            </label>
            <label className="ops-field">
              <span>{t("knowledgeCenter.tags")}</span>
              <input value={editing.tags} disabled={!canAuthor} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} />
            </label>
            {canAuthor ? (
              <label className="ops-field">
                <span>{t("knowledgeCenter.upload")}</span>
                <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={(e) => void loadFile(e)} />
              </label>
            ) : null}
          </div>
          <label className="ops-field">
            <span>{t("knowledgeCenter.content")}</span>
            <textarea rows={14} value={editing.content} readOnly={!canAuthor} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          </label>
          {canAuthor ? (
            <div className="ops-filters">
              <button type="submit" className="ui-button primary">{t("knowledgeCenter.save")}</button>
              {editing.documentId ? (
                <button
                  type="button"
                  className="ui-button ghost"
                  onClick={() => {
                    if (window.confirm(t("knowledgeCenter.archiveConfirm")))
                      void command("archive-knowledge-document", { documentId: editing.documentId }).then((r) => r && setEditing(null));
                  }}
                >
                  {t("knowledgeCenter.archive")}
                </button>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </PageContainer>
  );
}

export default KnowledgePage;
