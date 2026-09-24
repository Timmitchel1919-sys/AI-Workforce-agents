import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Dialog, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import {
  AccessClientError,
  useAccessCommand,
  useOperators,
  type AccessCommand,
  type AccountStatus,
  type OperatorAccountView,
  type OperatorRole,
} from "../../features/access";
import { useProjects } from "../../features/executionPlans";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "./UsersAccess.css";

const ROLES: readonly OperatorRole[] = ["viewer", "operator", "admin"];

const ROLE_LABEL: Record<OperatorRole, MessageKey> = {
  viewer: "access.roleViewer",
  operator: "access.roleOperator",
  admin: "access.roleAdmin",
};
const ROLE_HINT: Record<OperatorRole, MessageKey> = {
  viewer: "access.roleViewerHint",
  operator: "access.roleOperatorHint",
  admin: "access.roleAdminHint",
};
const STATUS_LABEL: Record<AccountStatus, MessageKey> = {
  pending: "access.statusPending",
  active: "access.statusActive",
  suspended: "access.statusSuspended",
  rejected: "access.statusRejected",
  revoked: "access.statusRevoked",
};
const FAILURE: Record<AccessClientError["failure"], MessageKey> = {
  forbidden: "access.failForbidden",
  unauthenticated: "access.failForbidden",
  conflict: "access.failConflict",
  invalid: "access.failInvalid",
  unknown: "access.failUnknown",
};

type Pending =
  | { kind: "grant"; command: "approve-access" | "change-operator-role"; account: OperatorAccountView }
  | {
      kind: "confirm";
      command: Exclude<AccessCommand, "approve-access" | "change-operator-role">;
      action: MessageKey;
      account: OperatorAccountView;
    };

/**
 * Settings → Users & Access (AUTHZ-1). Administrators only — the page is
 * hidden for everyone else, and the Control Plane refuses every call without
 * `manage_access` regardless of what this page shows.
 */
export default function UsersAccessPage() {
  const { t } = useI18n();
  const { status, operators, refetch } = useOperators();
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const groups: { title: MessageKey; empty: MessageKey; items: OperatorAccountView[] }[] = [
    {
      title: "access.pendingSection",
      empty: "access.emptyPending",
      items: operators.filter((o) => o.status === "pending"),
    },
    {
      title: "access.activeSection",
      empty: "access.emptyActive",
      items: operators.filter((o) => o.status === "active"),
    },
    {
      title: "access.inactiveSection",
      empty: "access.emptyInactive",
      items: operators.filter((o) => ["suspended", "revoked", "rejected"].includes(o.status)),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("nav.settings")}
        title={t("access.title")}
        description={t("access.description")}
        backTo="/settings"
        backLabel={t("nav.settings")}
      />

      {notice ? (
        <p className={`access-notice access-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      {status === "loading" ? (
        <div className="access-groups" role="status" aria-label={t("access.loading")}>
          <Skeleton height={72} width="100%" />
          <Skeleton height={72} width="100%" />
        </div>
      ) : null}
      {status === "forbidden" ? (
        <ErrorState icon={<Lock size={28} />} title={t("access.forbiddenTitle")} description={t("access.forbiddenDescription")} />
      ) : null}
      {status === "error" ? (
        <ErrorState
          title={t("access.errorTitle")}
          description={t("access.errorDescription")}
          onRetry={() => void refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {status === "ready" ? (
        <div className="access-groups">
          {groups.map((group) => (
            <section key={group.title} className="access-group" aria-labelledby={`access-${group.title}`}>
              <h2 id={`access-${group.title}`}>
                {t(group.title)} <span className="access-count">{group.items.length}</span>
              </h2>
              {group.items.length === 0 ? (
                <EmptyState title={t(group.empty)} />
              ) : (
                <ul className="access-list">
                  {group.items.map((account) => (
                    <AccountRow key={account.operatorId} account={account} onAction={setPending} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}

      {pending?.kind === "grant" ? (
        <GrantDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={(text, tone) => {
            setNotice({ tone, text });
            if (tone === "ok") setPending(null);
          }}
        />
      ) : null}
      {pending?.kind === "confirm" ? (
        <ConfirmDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={(text, tone) => {
            setNotice({ tone, text });
            if (tone === "ok") setPending(null);
          }}
        />
      ) : null}
    </PageContainer>
  );
}

function displayName(account: OperatorAccountView, fallback: string): string {
  return account.displayName ?? account.email ?? fallback;
}

function AccountRow({
  account,
  onAction,
}: {
  account: OperatorAccountView;
  onAction: (pending: Pending) => void;
}) {
  const { t, language } = useI18n();
  const confirm = (
    command: Exclude<AccessCommand, "approve-access" | "change-operator-role">,
    action: MessageKey,
  ) => onAction({ kind: "confirm", command, action, account });

  return (
    <li className="access-row">
      <div className="access-row__identity">
        <strong>{account.displayName ?? t("access.unnamed")}</strong>
        {account.email ? <span className="access-muted">{account.email}</span> : null}
        <span className="access-muted">
          {t(account.emailVerified ? "access.emailVerified" : "access.emailNotVerified")} ·{" "}
          {t("access.requested", { date: formatDateTime(account.requestedAt, language) ?? "" })}
        </span>
      </div>
      <div className="access-row__meta">
        <span className={`access-status access-status--${account.status}`}>{t(STATUS_LABEL[account.status])}</span>
        {account.role ? <span className="access-role">{t(ROLE_LABEL[account.role])}</span> : null}
        {account.isSelf ? <span className="access-role">{t("access.you")}</span> : null}
      </div>
      <div className="access-row__actions">
        {account.isSelf ? (
          <span className="access-muted">{t("access.selfNote")}</span>
        ) : (
          <>
            {account.status === "pending" || account.status === "rejected" ? (
              <button type="button" className="ui-button primary" onClick={() => onAction({ kind: "grant", command: "approve-access", account })}>
                <ShieldCheck size={16} aria-hidden /> {t("access.approve")}
              </button>
            ) : null}
            {account.status === "pending" ? (
              <button type="button" className="ui-button" onClick={() => confirm("reject-access", "access.reject")}>
                {t("access.reject")}
              </button>
            ) : null}
            {account.status === "active" ? (
              <>
                <button type="button" className="ui-button" onClick={() => onAction({ kind: "grant", command: "change-operator-role", account })}>
                  {t("access.changeRole")}
                </button>
                <button type="button" className="ui-button" onClick={() => confirm("suspend-access", "access.suspend")}>
                  {t("access.suspend")}
                </button>
              </>
            ) : null}
            {account.status === "suspended" ? (
              <button type="button" className="ui-button" onClick={() => confirm("reactivate-access", "access.reactivate")}>
                {t("access.reactivate")}
              </button>
            ) : null}
            {account.status === "active" || account.status === "suspended" ? (
              <button type="button" className="ui-button danger" onClick={() => confirm("revoke-access", "access.revoke")}>
                {t("access.revoke")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

function GrantDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: Extract<Pending, { kind: "grant" }>;
  onClose: () => void;
  onDone: (text: string, tone: "ok" | "error") => void;
}) {
  const { t } = useI18n();
  const { projects } = useProjects();
  const mutation = useAccessCommand();
  const { account, command } = pending;
  const [role, setRole] = useState<OperatorRole>(account.role ?? "viewer");
  const [allProjects, setAllProjects] = useState(account.allowedProjects === "*" || account.status !== "active");
  const [selected, setSelected] = useState<readonly string[]>(
    account.allowedProjects === "*" ? [] : account.allowedProjects,
  );
  const scopeValid = allProjects || selected.length > 0;

  const submit = () => {
    mutation.mutate(
      {
        command,
        body: {
          operatorId: account.operatorId,
          role,
          allowedProjects: allProjects ? "*" : selected,
        },
      },
      {
        onSuccess: () => onDone(t("access.actionDone"), "ok"),
        onError: (error) =>
          onDone(
            t("access.actionFailed", {
              reason: t(FAILURE[error instanceof AccessClientError ? error.failure : "unknown"]),
            }),
            "error",
          ),
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(command === "approve-access" ? "access.approveTitle" : "access.changeRoleTitle")}
      description={displayName(account, t("access.unnamed"))}
    >
      <form
        className="access-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (scopeValid) submit();
        }}
      >
        {!account.emailVerified ? <p className="access-warning">{t("access.unverifiedWarning")}</p> : null}
        <fieldset>
          <legend>{t("access.role")}</legend>
          {ROLES.map((r) => (
            <label key={r} className="access-choice">
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
              <span>
                <strong>{t(ROLE_LABEL[r])}</strong>
                <span className="access-muted">{t(ROLE_HINT[r])}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t("access.scope")}</legend>
          <label className="access-choice">
            <input type="checkbox" checked={allProjects} onChange={(e) => setAllProjects(e.target.checked)} />
            <span>{t("access.allProjects")}</span>
          </label>
          {!allProjects ? (
            projects.length === 0 ? (
              <p className="access-muted">{t("access.noProjects")}</p>
            ) : (
              projects.map((project) => (
                <label key={project.projectId} className="access-choice access-choice--nested">
                  <input
                    type="checkbox"
                    checked={selected.includes(project.projectId)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, project.projectId]
                          : current.filter((id) => id !== project.projectId),
                      )
                    }
                  />
                  <span>{project.displayName}</span>
                </label>
              ))
            )
          ) : null}
        </fieldset>
        <p className="access-muted">{t("access.permissionsNote")}</p>
        <div className="access-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("access.cancel")}
          </button>
          <button type="submit" className="ui-button primary" disabled={!scopeValid || mutation.isPending} aria-busy={mutation.isPending}>
            {t(command === "approve-access" ? "access.approve" : "access.changeRole")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: Extract<Pending, { kind: "confirm" }>;
  onClose: () => void;
  onDone: (text: string, tone: "ok" | "error") => void;
}) {
  const { t } = useI18n();
  const mutation = useAccessCommand();
  const [reason, setReason] = useState("");
  const name = displayName(pending.account, t("access.unnamed"));
  const withReason = pending.command !== "reactivate-access";

  return (
    <Dialog open onClose={onClose} title={t("access.confirmTitle", { action: t(pending.action) })} description={t("access.confirmBody", { name })}>
      <form
        className="access-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            {
              command: pending.command,
              body: { operatorId: pending.account.operatorId, ...(withReason && reason.trim() ? { reason: reason.trim() } : {}) },
            },
            {
              onSuccess: () => onDone(t("access.actionDone"), "ok"),
              onError: (error) =>
                onDone(
                  t("access.actionFailed", {
                    reason: t(FAILURE[error instanceof AccessClientError ? error.failure : "unknown"]),
                  }),
                  "error",
                ),
            },
          );
        }}
      >
        {withReason ? (
          <label className="access-field">
            <span>{t("access.reason")}</span>
            <textarea maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        ) : null}
        <div className="access-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("access.cancel")}
          </button>
          <button type="submit" className="ui-button danger" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {t("access.confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
