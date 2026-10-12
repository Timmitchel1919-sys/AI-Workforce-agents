import { useState, type FormEvent } from "react";
import {
  BookOpen,
  FileText,
  Lightbulb,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Dialog, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/useAuth";
import { useProjects } from "../../features/executionPlans";
import {
  KNOWLEDGE_ITEM_TYPES,
  KnowledgeError,
  useCreateKnowledge,
  useKnowledgeItems,
  useUpdateKnowledge,
  type KnowledgeFilter,
  type KnowledgeItem,
  type KnowledgeItemType,
} from "../../features/knowledge";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "../Approvals/ApprovalsPage.css";

const TYPE: Record<KnowledgeItemType, { label: MessageKey; icon: LucideIcon }> =
  {
    project_knowledge: {
      label: "knowledge.typeProjectKnowledge",
      icon: BookOpen,
    },
    technical_documentation: {
      label: "knowledge.typeTechnicalDocumentation",
      icon: FileText,
    },
    architecture: { label: "knowledge.typeArchitecture", icon: ScrollText },
    decision: { label: "knowledge.typeDecision", icon: Lightbulb },
    requirement: { label: "knowledge.typeRequirement", icon: ListChecks },
    note: { label: "knowledge.typeNote", icon: Sparkles },
  };

const EMPTY_FILTER: KnowledgeFilter = {};
const EMPTY_DRAFT = { type: "", projectId: "", search: "" };

/** Trim a markdown body to a short, single-paragraph preview. */
function preview(body: string): string {
  const flat = body
    .replace(/[#*`_>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat;
}

/**
 * The project knowledge library. Readable by every role; writes are
 * administrator-only. The Control Plane authorizes, validates, scopes by
 * project and audits every change — the browser never touches Firestore.
 */
export default function KnowledgePage() {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const { projects } = useProjects();
  const canWrite = accessDetails.role === "admin";

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [filter, setFilter] = useState<KnowledgeFilter>(EMPTY_FILTER);
  const library = useKnowledgeItems(filter);
  const filtered = Object.values(filter).some(Boolean);

  const [viewing, setViewing] = useState<KnowledgeItem | null>(null);
  const [editing, setEditing] = useState<{ item?: KnowledgeItem } | null>(null);
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilter({
      ...(draft.type ? { type: draft.type as KnowledgeItemType } : {}),
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      ...(draft.search.trim() ? { search: draft.search.trim() } : {}),
    });
  };
  const clear = () => {
    setDraft(EMPTY_DRAFT);
    setFilter(EMPTY_FILTER);
  };
  const projectName = (projectId?: string) =>
    projectId
      ? (projects.find((p) => p.projectId === projectId)?.displayName ??
        projectId)
      : t("knowledge.systemWide");

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("knowledge.title")}
        description={t("knowledge.description")}
      />

      <form
        className="gov-filters"
        aria-label={t("knowledge.filtersLabel")}
        onSubmit={apply}
      >
        <label className="gov-field">
          <span>{t("knowledge.filterType")}</span>
          <select
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
          >
            <option value="">{t("knowledge.allTypes")}</option>
            {KNOWLEDGE_ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(TYPE[type].label)}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("knowledge.filterProject")}</span>
          <select
            value={draft.projectId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, projectId: e.target.value }))
            }
          >
            <option value="">{t("knowledge.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("knowledge.search")}</span>
          <input
            maxLength={200}
            placeholder={t("knowledge.searchPlaceholder")}
            value={draft.search}
            onChange={(e) =>
              setDraft((d) => ({ ...d, search: e.target.value }))
            }
          />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={clear}>
            {t("knowledge.clear")}
          </button>
          <button type="submit" className="ui-button primary">
            {t("knowledge.apply")}
          </button>
        </div>
      </form>

      {canWrite ? (
        <p>
          <button
            type="button"
            className="ui-button primary"
            onClick={() => setEditing({})}
          >
            <Plus size={16} aria-hidden /> {t("knowledge.newItem")}
          </button>
        </p>
      ) : null}

      {notice ? (
        <p
          className={`gov-notice gov-notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {library.state === "loading" ? (
        <div
          className="gov-list"
          role="status"
          aria-label={t("knowledge.loading")}
        >
          <Skeleton height={96} width="100%" />
          <Skeleton height={96} width="100%" />
        </div>
      ) : library.state === "forbidden" ||
        library.state === "unauthenticated" ? (
        <ErrorState
          icon={<Lock size={28} />}
          title={t(
            library.state === "forbidden"
              ? "knowledge.forbiddenTitle"
              : "knowledge.unauthenticatedTitle",
          )}
          description={t(
            library.state === "forbidden"
              ? "knowledge.forbiddenDescription"
              : "knowledge.unauthenticatedDescription",
          )}
        />
      ) : library.state === "empty" ? (
        <EmptyState
          title={t("knowledge.emptyTitle")}
          description={t(
            filtered ? "knowledge.emptyFiltered" : "knowledge.emptyNone",
          )}
        />
      ) : library.state !== "ready" ? (
        <ErrorState
          title={t("knowledge.errorTitle")}
          description={t("knowledge.errorDescription")}
          onRetry={library.refetch}
          retryLabel={t("common.retry")}
        />
      ) : (
        <>
          <p className="gov-muted">
            {t("knowledge.showing", {
              shown: library.items.length,
              total: library.total,
            })}
          </p>
          <ul className="gov-list">
            {library.items.map((item) => (
              <KnowledgeCard
                key={item.knowledgeId}
                item={item}
                projectLabel={projectName(item.projectId)}
                canWrite={canWrite}
                onView={() => setViewing(item)}
                onEdit={() => setEditing({ item })}
              />
            ))}
          </ul>
        </>
      )}

      {viewing ? (
        <ViewerDialog
          item={viewing}
          projectLabel={projectName(viewing.projectId)}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {editing ? (
        <EditorDialog
          item={editing.item}
          projects={projects.map((p) => ({
            id: p.projectId,
            name: p.displayName,
          }))}
          onClose={() => setEditing(null)}
          onDone={(text, tone) => {
            setNotice({ tone, text });
            setEditing(null);
          }}
        />
      ) : null}
    </PageContainer>
  );
}

function KnowledgeCard({
  item,
  projectLabel,
  canWrite,
  onView,
  onEdit,
}: {
  item: KnowledgeItem;
  projectLabel: string;
  canWrite: boolean;
  onView: () => void;
  onEdit: () => void;
}) {
  const { t, language } = useI18n();
  const type = TYPE[item.type] ?? TYPE.note;
  const TypeIcon = type.icon;

  return (
    <li className="gov-card" data-knowledge={item.knowledgeId}>
      <div className="gov-card__head">
        <h3 className="gov-action">{item.title}</h3>
        <span className="gov-pill gov-pill--neutral">
          <TypeIcon size={14} aria-hidden />
          <span>{t(type.label)}</span>
        </span>
        {item.tags.map((tag) => (
          <span key={tag} className="gov-pill gov-pill--neutral">
            {tag}
          </span>
        ))}
      </div>
      <p className="gov-reason">{preview(item.body)}</p>
      <ul className="gov-meta">
        <li>{projectLabel}</li>
        <li>{t("knowledge.createdBy", { actor: item.createdBy })}</li>
        <li>
          {t("knowledge.updatedAt", {
            date: formatDateTime(item.updatedAt, language) ?? "",
          })}
        </li>
        {item.source ? (
          <li>{t("knowledge.source", { source: item.source })}</li>
        ) : null}
      </ul>
      <div className="gov-actions">
        <button type="button" className="ui-button" onClick={onView}>
          {t("knowledge.view")}
        </button>
        {canWrite ? (
          <button type="button" className="ui-button" onClick={onEdit}>
            <Pencil size={16} aria-hidden /> {t("knowledge.edit")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ViewerDialog({
  item,
  projectLabel,
  onClose,
}: {
  item: KnowledgeItem;
  projectLabel: string;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const type = TYPE[item.type] ?? TYPE.note;
  return (
    <Dialog
      open
      onClose={onClose}
      title={item.title}
      description={t("knowledge.detailDescription")}
    >
      <dl className="gov-detail-list">
        <dt>{t("knowledge.type")}</dt>
        <dd>{t(type.label)}</dd>
        <dt>{t("knowledge.filterProject")}</dt>
        <dd>{projectLabel}</dd>
        <dt>{t("knowledge.createdBy", { actor: item.createdBy })}</dt>
        <dd>{formatDateTime(item.createdAt, language) ?? ""}</dd>
        <dt>{t("knowledge.updatedLabel")}</dt>
        <dd>{formatDateTime(item.updatedAt, language) ?? ""}</dd>
        {item.source ? (
          <>
            <dt>{t("knowledge.itemSource")}</dt>
            <dd>{item.source}</dd>
          </>
        ) : null}
        {item.tags.length > 0 ? (
          <>
            <dt>{t("knowledge.itemTags")}</dt>
            <dd>{item.tags.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      <h3>{t("knowledge.bodySection")}</h3>
      <pre className="gov-preview">{item.body}</pre>
      <div className="gov-form__actions">
        <button type="button" className="ui-button" onClick={onClose}>
          {t("knowledge.close")}
        </button>
      </div>
    </Dialog>
  );
}

function EditorDialog({
  item,
  projects,
  onClose,
  onDone,
}: {
  item?: KnowledgeItem;
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onDone: (text: string, tone: "ok" | "error") => void;
}) {
  const { t } = useI18n();
  const create = useCreateKnowledge();
  const update = useUpdateKnowledge();
  const editing = Boolean(item);

  const [type, setType] = useState<KnowledgeItemType>(item?.type ?? "note");
  const [projectId, setProjectId] = useState(item?.projectId ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [tags, setTags] = useState(item?.tags.join(", ") ?? "");
  const [source, setSource] = useState(item?.source ?? "");

  const pending = create.isPending || update.isPending;
  const valid = title.trim().length > 0 && body.trim().length > 0;

  const parseTags = () =>
    tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const submit = () => {
    if (!valid) return;
    const fields = {
      type,
      title: title.trim(),
      body: body.trim(),
      tags: parseTags(),
      ...(source.trim() ? { source: source.trim() } : {}),
    };
    const onError = (error: unknown) => {
      const failure =
        error instanceof KnowledgeError ? error.failure : "unavailable";
      const key: MessageKey =
        failure === "forbidden" || failure === "unauthenticated"
          ? "knowledge.forbiddenAction"
          : failure === "invalid"
            ? "knowledge.invalid"
            : "knowledge.saveFailed";
      onDone(t(key), "error");
    };

    if (item) {
      update.mutate(
        { id: item.knowledgeId, input: fields },
        { onSuccess: () => onDone(t("knowledge.updated"), "ok"), onError },
      );
    } else {
      create.mutate(
        { ...fields, ...(projectId ? { projectId } : {}) },
        { onSuccess: () => onDone(t("knowledge.created"), "ok"), onError },
      );
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(editing ? "knowledge.editTitle" : "knowledge.createTitle")}
      description={t("knowledge.formDescription")}
    >
      <form
        className="gov-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="gov-filters">
          <label className="gov-field">
            <span>{t("knowledge.type")}</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as KnowledgeItemType)}
            >
              {KNOWLEDGE_ITEM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(TYPE[value].label)}
                </option>
              ))}
            </select>
          </label>
          <label className="gov-field">
            <span>{t("knowledge.project")}</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={editing}
            >
              <option value="">{t("knowledge.systemWide")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="gov-field">
          <span>{t("knowledge.itemTitle")}</span>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="gov-field">
          <span>{t("knowledge.itemBody")}</span>
          <textarea
            required
            maxLength={20000}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="gov-muted">{t("knowledge.itemBodyHint")}</span>
        </label>
        <label className="gov-field">
          <span>{t("knowledge.itemTags")}</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
          <span className="gov-muted">{t("knowledge.itemTagsHint")}</span>
        </label>
        <label className="gov-field">
          <span>{t("knowledge.itemSource")}</span>
          <input
            maxLength={300}
            placeholder={t("knowledge.itemSourcePlaceholder")}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("knowledge.cancel")}
          </button>
          <button
            type="submit"
            className="ui-button primary"
            disabled={pending || !valid}
            aria-busy={pending}
          >
            {pending
              ? t("knowledge.working")
              : t(editing ? "knowledge.save" : "knowledge.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
