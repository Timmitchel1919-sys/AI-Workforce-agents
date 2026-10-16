import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Clock3,
  CornerDownLeft,
  Pin,
  PinOff,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import {
  navigationSections,
  visibleNavigationItems,
  type NavigationSectionId,
} from "../../config/navigation";
import { useI18n } from "../../i18n";
import { useWorkspaceContext } from "../../features/workspaceContext";
import "./CommandPalette.css";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}
type Filter = "all" | NavigationSectionId;
const contextualRoutes: Record<string, string[]> = {
  "/overview": ["/projects", "/tasks", "/approvals"],
  "/projects": ["/tasks", "/workflows", "/software-factory", "/graph"],
  "/agents": ["/agent-teams", "/tasks", "/operations"],
  "/tasks": ["/agents", "/workflows", "/approvals"],
  "/operations": ["/audit-log", "/security-center", "/approvals"],
  "/approvals": ["/audit-log", "/operations"],
};

export default function CommandPalette({
  open,
  onClose,
  returnFocusRef,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const workspace = useWorkspaceContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const currentPathname = workspace.current.pathname;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<"search" | "assistant">("search");
  const [active, setActive] = useState(0);
  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    returnFocusRef?.current?.focus();
  }, [onClose, returnFocusRef]);
  const commands = useMemo(
    () =>
      visibleNavigationItems(accessDetails.role).map((item) => ({
        ...item,
        label: t(item.labelKey),
      })),
    [accessDetails.role, t],
  );
  const contextual = useMemo(
    () =>
      new Set(
        Object.entries(contextualRoutes).find(
          ([route]) =>
            currentPathname === route ||
            currentPathname.startsWith(`${route}/`),
        )?.[1] ?? ["/projects", "/tasks", "/approvals"],
      ),
    [currentPathname],
  );
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const recency = new Map(
      workspace.recentRoutes.map((item, index) => [item.pathname, index]),
    );
    const recentCommand = new Map(
      workspace.recentCommands.map((route, index) => [route, index]),
    );
    return commands
      .filter(
        (command) =>
          (filter === "all" || command.section === filter) &&
          (!normalized ||
            `${command.label} ${command.route} ${t(navigationSections.find((section) => section.id === command.section)?.labelKey ?? "nav.sections.main")}`
              .toLocaleLowerCase()
              .includes(normalized)),
      )
      .sort((a, b) => {
        const context =
          Number(contextual.has(b.route)) - Number(contextual.has(a.route));
        if (context) return context;
        const pinned =
          Number(workspace.pinnedRoutes.includes(b.route)) -
          Number(workspace.pinnedRoutes.includes(a.route));
        if (pinned) return pinned;
        const commandUse =
          (recentCommand.get(a.route) ?? 99) -
          (recentCommand.get(b.route) ?? 99);
        if (commandUse) return commandUse;
        return (recency.get(a.route) ?? 99) - (recency.get(b.route) ?? 99);
      });
  }, [
    commands,
    contextual,
    filter,
    query,
    t,
    workspace.pinnedRoutes,
    workspace.recentCommands,
    workspace.recentRoutes,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAndRestoreFocus, open]);
  if (!open) return null;
  const choose = (route: string) => {
    workspace.recordSearch(query);
    workspace.recordCommand(route);
    onClose();
    navigate(route);
    returnFocusRef?.current?.focus();
  };
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) =>
        Math.min(value + 1, Math.max(0, matches.length - 1)),
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    }
    if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      choose(matches[active].route);
    }
  };

  return (
    <div
      className="command-palette__backdrop"
      onMouseDown={closeAndRestoreFocus}
    >
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="command-palette-title" className="sr-only">
          {t("shell.searchCommands")}
        </h2>
        <div className="command-palette__mode" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "search"}
            onClick={() => setMode("search")}
          >
            <Search size={15} />
            {t("shell.smartSearch")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "assistant"}
            onClick={() => setMode("assistant")}
          >
            <Bot size={15} />
            {t("shell.workspaceAssistant")}
          </button>
        </div>
        {mode === "assistant" ? (
          <section className="command-palette__assistant" role="tabpanel">
            <div>
              <Sparkles size={20} aria-hidden="true" />
              <div>
                <strong>{t("shell.assistantNotConnected")}</strong>
                <p>{t("shell.assistantNotConnectedDescription")}</p>
              </div>
            </div>
            <p className="command-palette__notice">
              {t("shell.assistantBoundary")}
            </p>
          </section>
        ) : (
          <>
            <div className="command-palette__header">
              <Search size={18} aria-hidden="true" />
              <label htmlFor="command-palette-search" className="sr-only">
                {t("shell.searchCommands")}
              </label>
              <input
                id="command-palette-search"
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder={t("shell.searchPlaceholder")}
                autoComplete="off"
                aria-activedescendant={
                  matches[active] ? `command-${active}` : undefined
                }
              />
              <button
                type="button"
                onClick={closeAndRestoreFocus}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            {workspace.recentSearches.length > 0 && !query ? (
              <div className="command-palette__recent">
                <Clock3 size={14} />
                {workspace.recentSearches.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => {
                      setQuery(item);
                      setActive(0);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
            <div
              className="command-palette__filters"
              role="group"
              aria-label={t("shell.searchCategories")}
            >
              <button
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => {
                  setFilter("all");
                  setActive(0);
                }}
              >
                {t("shell.allCategories")}
              </button>
              {navigationSections.map((section) => (
                <button
                  type="button"
                  key={section.id}
                  aria-pressed={filter === section.id}
                  onClick={() => {
                    setFilter(section.id);
                    setActive(0);
                  }}
                >
                  {t(section.labelKey)}
                </button>
              ))}
            </div>
            <div className="command-palette__caption">
              {t("shell.navigationCommands")}
            </div>
            <ul className="command-palette__results">
              {matches.map((command, index) => (
                <li
                  key={command.route}
                  className={index === active ? "is-active" : ""}
                >
                  <button
                    id={`command-${index}`}
                    className="command-palette__destination"
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(command.route)}
                  >
                    <span>
                      <strong>{command.label}</strong>
                      <small>
                        {t(
                          navigationSections.find(
                            (section) => section.id === command.section,
                          )?.labelKey ?? "nav.sections.main",
                        )}{" "}
                        · {command.route}
                      </small>
                    </span>
                    <span className="command-palette__route-meta">
                      {contextual.has(command.route) ? (
                        <em>{t("shell.suggested")}</em>
                      ) : null}
                      {workspace.pinnedRoutes.includes(command.route) ? (
                        <Pin size={14} aria-label={t("shell.pinnedCommand")} />
                      ) : null}
                      {!workspace.pinnedRoutes.includes(command.route) &&
                      workspace.recentRoutes.some(
                        (item) => item.pathname === command.route,
                      ) ? (
                        <Clock3
                          size={14}
                          aria-label={t("shell.recentCommand")}
                        />
                      ) : null}
                      <CornerDownLeft size={15} aria-hidden="true" />
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </button>
                  <button
                    className="command-palette__pin"
                    type="button"
                    aria-label={t(
                      workspace.pinnedRoutes.includes(command.route)
                        ? "shell.unpinCommand"
                        : "shell.pinCommand",
                      { page: command.label },
                    )}
                    onClick={() => workspace.togglePinnedRoute(command.route)}
                  >
                    {workspace.pinnedRoutes.includes(command.route) ? (
                      <PinOff size={15} />
                    ) : (
                      <Pin size={15} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {matches.length === 0 ? (
              <p className="command-palette__empty">{t("shell.noCommands")}</p>
            ) : null}
            <p className="command-palette__notice">
              {t("shell.commandAuthorizationNotice")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
