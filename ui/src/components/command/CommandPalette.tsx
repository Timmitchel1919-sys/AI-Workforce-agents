import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Pin, PinOff, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { visibleNavigationItems } from "../../config/navigation";
import { useI18n } from "../../i18n";
import { useWorkspaceContext } from "../../features/workspaceContext";
import "./CommandPalette.css";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export default function CommandPalette({ open, onClose, returnFocusRef }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const { recentRoutes, pinnedRoutes, togglePinnedRoute } = useWorkspaceContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    returnFocusRef?.current?.focus();
  }, [onClose, returnFocusRef]);

  const commands = useMemo(
    () => visibleNavigationItems(accessDetails.role).map((item) => ({ ...item, label: t(item.labelKey) })),
    [accessDetails.role, t],
  );
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? commands.filter((command) => command.label.toLocaleLowerCase().includes(normalized))
      : commands;
    const recency = new Map(recentRoutes.map((item, index) => [item.pathname, index]));
    return [...filtered].sort((a, b) => {
      const pinned = Number(pinnedRoutes.includes(b.route)) - Number(pinnedRoutes.includes(a.route));
      if (pinned) return pinned;
      return (recency.get(a.route) ?? Number.MAX_SAFE_INTEGER) - (recency.get(b.route) ?? Number.MAX_SAFE_INTEGER);
    });
  }, [commands, pinnedRoutes, query, recentRoutes]);

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
    onClose();
    navigate(route);
    returnFocusRef?.current?.focus();
  };

  return (
    <div className="command-palette__backdrop" onMouseDown={closeAndRestoreFocus}>
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette__header">
          <Search size={18} aria-hidden="true" />
          <label id="command-palette-title" htmlFor="command-palette-search" className="sr-only">
            {t("shell.searchCommands")}
          </label>
          <input
            id="command-palette-search"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("shell.searchPlaceholder")}
            autoComplete="off"
          />
          <button type="button" onClick={closeAndRestoreFocus} aria-label={t("common.close")}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="command-palette__caption">{t("shell.navigationCommands")}</div>
        <ul className="command-palette__results">
          {matches.map((command) => (
            <li key={command.route}>
              <button className="command-palette__destination" type="button" onClick={() => choose(command.route)}>
                <span>{command.label}</span>
                <span className="command-palette__route-meta">
                  {pinnedRoutes.includes(command.route) ? <Pin size={14} aria-label={t("shell.pinnedCommand")} /> : null}
                  {!pinnedRoutes.includes(command.route) && recentRoutes.some((item) => item.pathname === command.route)
                    ? <Clock3 size={14} aria-label={t("shell.recentCommand")} /> : null}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
              </button>
              <button
                className="command-palette__pin"
                type="button"
                aria-label={t(pinnedRoutes.includes(command.route) ? "shell.unpinCommand" : "shell.pinCommand", { page: command.label })}
                onClick={() => togglePinnedRoute(command.route)}
              >
                {pinnedRoutes.includes(command.route) ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
        {matches.length === 0 ? <p className="command-palette__empty">{t("shell.noCommands")}</p> : null}
        <p className="command-palette__notice">{t("shell.commandAuthorizationNotice")}</p>
      </div>
    </div>
  );
}
