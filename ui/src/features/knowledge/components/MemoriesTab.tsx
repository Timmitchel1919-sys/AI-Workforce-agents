import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Checkbox, Dialog, Input, Select, Textarea } from "../../../components/ui";
import { useCanManage, useKnowledgeCommand, useMemories } from "../hooks/useKnowledge";
import { applyFilterChange, clearFilters, filtersFromParams, hasActiveFilters, splitTags } from "../lib/logic";
import { useT } from "../lib/useT";
import {
  CONFIDENCES, IMPORTANCES, MEMORY_SOURCES, MEMORY_STATUSES, MEMORY_TYPES,
  type Importance, type MemoryFilters, type MemoryType,
} from "../types";
import { Empty, ErrorPanel, Notice, Skeleton } from "./common";
import { ContextPreview } from "./ContextPreview";
import { MemoryRow } from "./MemoryRow";
import type { ProjectOption } from "../../projectScope/projectScope";

const FILTER_SELECTS: { key: Exclude<keyof MemoryFilters, "q" | "since">; group: string; values: readonly string[] }[] = [
  { key: "type", group: "type", values: MEMORY_TYPES },
  { key: "source", group: "source", values: MEMORY_SOURCES },
  { key: "status", group: "status", values: MEMORY_STATUSES },
  { key: "confidence", group: "confidence", values: CONFIDENCES },
  { key: "importance", group: "importance", values: IMPORTANCES },
];

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  projects: readonly ProjectOption[];
  defaultProjectId: string | undefined;
  onDone: (message: { reinforced: boolean; memoryId: string | undefined; status: string | undefined }) => void;
}

export function CreateMemoryDialog({ open, onClose, projects, defaultProjectId, onDone }: CreateDialogProps) {
  const { tt, label } = useT();
  const command = useKnowledgeCommand();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.projectId ?? "");
  const [type, setType] = useState<MemoryType>("PROJECT");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState<Importance>("NORMAL");
  const [tags, setTags] = useState("");
  const [draft, setDraft] = useState(false);

  const effectiveProject = projectId || defaultProjectId || "";
  const valid = effectiveProject.length > 0 && title.trim().length > 0 && content.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    command.mutate(
      {
        command: "knowledge_create_memory",
        body: { projectId: effectiveProject, type, title: title.trim(), content: content.trim(), importance, tags: splitTags(tags), draft },
      },
      {
        onSuccess: (result) => {
          const details = result.details as { memoryId?: string; status?: string; outcome?: string };
          setTitle(""); setContent(""); setTags(""); setDraft(false);
          command.reset();
          onDone({ reinforced: details.outcome === "REINFORCED", memoryId: details.memoryId, status: details.status });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={tt("create.title")} description={tt("create.description")}>
      <form className="kn-form" onSubmit={submit}>
        <Select label={tt("filters.project")} value={effectiveProject} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
        </Select>
        <Select label={tt("filters.type")} value={type} onChange={(event) => setType(event.target.value as MemoryType)}>
          {MEMORY_TYPES.map((v) => <option key={v} value={v}>{label("type", v)}</option>)}
        </Select>
        <Input label={tt("create.titleField")} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <Textarea label={tt("create.content")} value={content} rows={5} onChange={(event) => setContent(event.target.value)} />
        <Select label={tt("filters.importance")} value={importance} onChange={(event) => setImportance(event.target.value as Importance)}>
          {IMPORTANCES.map((v) => <option key={v} value={v}>{label("importance", v)}</option>)}
        </Select>
        <Input label={tt("create.tags")} description={tt("create.tagsHint")} value={tags} onChange={(event) => setTags(event.target.value)} />
        <Checkbox label={tt("create.draft")} description={tt("create.draftHint")} checked={draft} onChange={(event) => setDraft(event.target.checked)} />
        {command.error ? <ErrorPanel error={command.error} /> : null}
        <div className="kn-actions">
          <Button type="submit" variant="primary" loading={command.isPending} disabled={!valid}>{tt("create.submit")}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FilterBar({ projectId }: { projectId: string | undefined }) {
  const { tt, label } = useT();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const [draftQuery, setDraftQuery] = useState(filters.q);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setParams((prev) => applyFilterChange(prev, "q", draftQuery.trim()));
  };
  const change = (key: keyof MemoryFilters, value: string) => setParams((prev) => applyFilterChange(prev, key, value));

  return (
    <div className="kn-stack">
      <form role="search" className="kn-searchbar" onSubmit={submit}>
        <Input
          label={tt("filters.searchLabel")}
          type="search"
          placeholder={tt("filters.searchPlaceholder")}
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
        />
        <Button type="submit" variant="primary">{tt("filters.search")}</Button>
      </form>
      <div className="kn-filters">
        <p className="kn-muted">{tt("filters.projectScoped", { project: projectId ?? tt("scope.all") })}</p>
        {FILTER_SELECTS.map(({ key, group, values }) => (
          <Select key={key} label={tt(`filters.${key}`)} value={filters[key]} onChange={(event) => change(key, event.target.value)}>
            <option value="">{tt("filters.any")}</option>
            {values.map((v) => <option key={v} value={v}>{label(group, v)}</option>)}
          </Select>
        ))}
        <Input label={tt("filters.since")} type="date" value={filters.since} onChange={(event) => change("since", event.target.value)} />
        {(hasActiveFilters(filters) || filters.q) ? (
          <Button type="button" variant="ghost" onClick={() => { setDraftQuery(""); setParams((prev) => clearFilters(prev)); }}>
            {tt("filters.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function MemoriesTab({ projectId, projects, search }: { projectId: string | undefined; projects: readonly ProjectOption[]; search: string }) {
  const { tt } = useT();
  const canManage = useCanManage();
  const [params] = useSearchParams();
  const filters = filtersFromParams(params);
  const query = useMemories(projectId, filters);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<{ reinforced: boolean; memoryId: string | undefined; status: string | undefined } | null>(null);
  const data = query.data;
  const searching = filters.q.trim().length > 0;
  // Row links carry the project scope and the current filters so Back returns to the same search.
  const rowSearch = (() => {
    const p = new URLSearchParams(params);
    new URLSearchParams(search).forEach((value, key) => p.set(key, value));
    return `?${p.toString()}`;
  })();

  return (
    <div className="kn-stack">
      <section className="kn-panel" aria-labelledby="kn-mem-heading">
        <div className="kn-header-row">
          <h2 id="kn-mem-heading" className="kn-panel__title">{tt("memories.title")}</h2>
          {canManage ? <Button type="button" variant="primary" onClick={() => { setBanner(null); setCreating(true); }}>{tt("create.open")}</Button> : null}
        </div>
        <FilterBar projectId={projectId} />
        {banner ? (
          banner.reinforced
            ? <Notice tone="warning" title={tt("create.reinforcedTitle")}>{tt("create.reinforced")}</Notice>
            : <Notice tone="success" title={tt("create.createdTitle")}>{tt("create.created", { status: banner.status ?? "" })}</Notice>
        ) : null}
        {query.error ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isLoading ? <Skeleton label={tt("memories.loading")} /> : null}
        {data ? (
          <p className="kn-muted" data-testid="memories-mode" data-mode={data.mode}>
            {searching ? tt("memories.searchResults", { count: data.memories.length }) : tt("memories.listCount", { shown: data.memories.length, total: data.total })}
          </p>
        ) : null}
        {data && data.memories.length === 0 ? (
          <Empty title={searching ? tt("memories.noResults") : tt("memories.emptyTitle")} body={searching ? tt("memories.noResultsBody") : tt("memories.emptyBody")} />
        ) : null}
        {data && data.memories.length > 0 ? (
          <ul className="kn-rows" aria-label={tt("memories.title")}>
            {data.memories.map((memory) => <MemoryRow key={memory.memoryId} memory={memory} search={rowSearch} />)}
          </ul>
        ) : null}
      </section>
      <ContextPreview projectId={projectId} />
      {canManage ? (
        <CreateMemoryDialog
          open={creating}
          onClose={() => setCreating(false)}
          projects={projects}
          defaultProjectId={projectId}
          onDone={setBanner}
        />
      ) : null}
    </div>
  );
}
