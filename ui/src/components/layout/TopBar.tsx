import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "../../i18n";
import CommandPalette from "../command/CommandPalette";
import NotificationCenter from "../../features/notifications/NotificationCenter";
import "./TopBar.css";

export default function TopBar() {
  const { t } = useI18n();
  const searchRef = useRef<HTMLButtonElement>(null);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingField =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") ||
          target.isContentEditable ||
          target.closest("[contenteditable='true']"));
      const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      if (isTypingField || modalOpen) return;

      const isShortcut =
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
        (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "/");

      if (!isShortcut) {
        return;
      }

      event.preventDefault();
      setCommandOpen(true);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <header className="topbar app-shell__topbar" aria-label={t("shell.headerActions")}>
      <div className="topbar__content app-shell__topbar-content">
        <div className="topbar__search">
          <Search size={16} className="topbar__search-icon" aria-hidden="true" />
          <button
            id="global-command"
            ref={searchRef}
            className="topbar__search-field"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={commandOpen}
            onClick={() => setCommandOpen(true)}
          >
            <span>{t("shell.searchPlaceholder")}</span>
          </button>
          <span className="topbar__kbd" aria-hidden="true">
            Ctrl K
          </span>
        </div>

        <div className="topbar__right app-shell__topbar-actions" aria-label={t("shell.headerActions")}>
          <NotificationCenter />

        </div>
      </div>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} returnFocusRef={searchRef} />
    </header>
  );
}
