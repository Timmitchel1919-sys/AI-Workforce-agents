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
      label: "knowledgeItems.typeProjectKnowledge",
      icon: BookOpen,
    },
    technical_documentation: {
      label: "knowledgeItems.typeTechnicalDocumentation",
      icon: FileText,
    },
    architecture: { label: "knowledgeItems.typeArchitecture", icon: ScrollText },
    decision: { label: "knowledgeItems.typeDecision", icon: Lightbulb },
    requirement: { label: "knowledgeItems.typeRequirement", icon: ListChecks },
    note: { label: "knowledgeItems.typeNote", icon: Sparkles },
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
      : t("knowledgeItems.systemWide");

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("knowledgeItems.title")}
        description={t("knowledgeItems.description")}
      />

      <form
        className="gov-filters"
        aria-label={t("knowledgeItems.filtersLabel")}
        onSubmit={apply}
      >
        <label className="gov-field">
          <span>{t("knowledgeItems.filterType")}</span>
          <select
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
          >
            <option value="">{t("knowledgeItems.allTypes")}</option>
            {KNOWLEDGE_ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(TYPE[type].label)}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("knowledgeItems.filterProject")}</span>
          <select
            value={draft.projectId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, projectId: e.target.value }))
            }
          >
            <option value="">{t("knowledgeItems.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("knowledgeItems.search")}</span>
          <input
            maxLength={200}
            placeholder={t("knowledgeItems.searchPlaceholder")}
            value={draft.search}
            onChange={(e) =>
              setDraft((d) => ({ ...d, search: e.target.value }))
            }
          />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={clear}>
            {t("knowledgeItems.clear")}
          </button>
          <button type="submit" className="ui-button primary">
            {t("knowledgeItems.apply")}
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
            <Plus size={16} aria-hidden /> {t("knowledgeItems.newItem")}
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
          aria-label={t("knowledgeItems.loading")}
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
              ? "knowledgeItems.forbiddenTitle"
              : "knowledgeItems.unauthenticatedTitle",
          )}
          description={t(
            library.state === "forbidden"
              ? "knowledgeItems.forbiddenDescription"
              : "knowledgeItems.unauthenticatedDescription",
          )}
        />
      ) : library.state === "empty" ? (
        <EmptyState
          title={t("knowledgeItems.emptyTitle")}
          description={t(
            filtered ? "knowledgeItems.emptyFiltered" : "knowledgeItems.emptyNone",
          )}
        />
      ) : library.state !== "ready" ? (
        <ErrorState
          title={t("knowledgeItems.errorTitle")}
          description={t("knowledgeItems.errorDescription")}
          onRetry={library.refetch}
          retryLabel={t("common.retry")}
        />
      ) : (
        <>
          <p className="gov-muted">
            {t("knowledgeItems.showing", {
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
        <li>{t("knowledgeItems.createdBy", { actor: item.createdBy })}</li>
        <li>
          {t("knowledgeItems.updatedAt", {
            date: formatDateTime(item.updatedAt, language) ?? "",
          })}
        </li>
        {item.source ? (
          <li>{t("knowledgeItems.source", { source: item.source })}</li>
        ) : null}
      </ul>
      <div className="gov-actions">
        <button type="button" className="ui-button" onClick={onView}>
          {t("knowledgeItems.view")}
        </button>
        {canWrite ? (
          <button type="button" className="ui-button" onClick={onEdit}>
            <Pencil size={16} aria-hidden /> {t("knowledgeItems.edit")}
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
      description={t("knowledgeItems.detailDescription")}
    >
      <dl className="gov-detail-list">
        <dt>{t("knowledgeItems.type")}</dt>
        <dd>{t(type.label)}</dd>
        <dt>{t("knowledgeItems.filterProject")}</dt>
        <dd>{projectLabel}</dd>
        <dt>{t("knowledgeItems.createdBy", { actor: item.createdBy })}</dt>
        <dd>{formatDateTime(item.createdAt, language) ?? ""}</dd>
        <dt>{t("knowledgeItems.updatedLabel")}</dt>
        <dd>{formatDateTime(item.updatedAt, language) ?? ""}</dd>
        {item.source ? (
          <>
            <dt>{t("knowledgeItems.itemSource")}</dt>
            <dd>{item.source}</dd>
          </>
        ) : null}
        {item.tags.length > 0 ? (
          <>
            <dt>{t("knowledgeItems.itemTags")}</dt>
            <dd>{item.tags.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      <h3>{t("knowledgeItems.bodySection")}</h3>
      <pre className="gov-preview">{item.body}</pre>
      <div className="gov-form__actions">
        <button type="button" className="ui-button" onClick={onClose}>
          {t("knowledgeItems.close")}
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
          ? "knowledgeItems.forbiddenAction"
          : failure === "invalid"
            ? "knowledgeItems.invalid"
            : "knowledgeItems.saveFailed";
      onDone(t(key), "error");
    };

    if (item) {
      update.mutate(
        { id: item.knowledgeId, input: fields },
        { onSuccess: () => onDone(t("knowledgeItems.updated"), "ok"), onError },
      );
    } else {
      create.mutate(
        { ...fields, ...(projectId ? { projectId } : {}) },
        { onSuccess: () => onDone(t("knowledgeItems.created"), "ok"), onError },
      );
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(editing ? "knowledgeItems.editTitle" : "knowledgeItems.createTitle")}
      description={t("knowledgeItems.formDescription")}
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
            <span>{t("knowledgeItems.type")}</span>
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
            <span>{t("knowledgeItems.project")}</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={editing}
            >
              <option value="">{t("knowledgeItems.systemWide")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="gov-field">
          <span>{t("knowledgeItems.itemTitle")}</span>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="gov-field">
          <span>{t("knowledgeItems.itemBody")}</span>
          <textarea
            required
            maxLength={20000}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="gov-muted">{t("knowledgeItems.itemBodyHint")}</span>
        </label>
        <label className="gov-field">
          <span>{t("knowledgeItems.itemTags")}</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
          <span className="gov-muted">{t("knowledgeItems.itemTagsHint")}</span>
        </label>
        <label className="gov-field">
          <span>{t("knowledgeItems.itemSource")}</span>
          <input
            maxLength={300}
            placeholder={t("knowledgeItems.itemSourcePlaceholder")}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("knowledgeItems.cancel")}
          </button>
          <button
            type="submit"
            className="ui-button primary"
            disabled={pending || !valid}
            aria-busy={pending}
          >
            {pending
              ? t("knowledgeItems.working")
              : t(editing ? "knowledgeItems.save" : "knowledgeItems.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
