import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { GlassButton } from "../../ui/GlassButton";
import { useI18n } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import "./sections.css";

const linkKeys: ReadonlyArray<{ id: string; key: MessageKey }> = [
  { id: "capabilities", key: "landing.v2.nav.capabilities" },
  { id: "workforce",    key: "landing.v2.nav.workforce" },
  { id: "workflow",     key: "landing.v2.nav.workflow" },
  { id: "security",     key: "landing.v2.nav.security" },
];

export function Nav() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const sheetId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <nav className="lp2-nav" aria-label={t("landing.v2.nav.ariaLabel")}>
      <Link to="/" className="lp2-brand" aria-label={t("landing.v2.nav.brandAria")}>
        <span className="lp2-brand-dot" aria-hidden />
        <span>AI Workforce</span>
      </Link>

      <ul className="lp2-nav-links" aria-label={t("landing.v2.nav.sectionsAria")}>
        {linkKeys.map((l) => (
          <li key={l.id}>
            <a href={`#${l.id}`}>{t(l.key)}</a>
          </li>
        ))}
      </ul>

      <div className="lp2-nav-cta">
        <Link to="/login" className="lp2-nav-signin-link">
          <GlassButton size="sm" variant="secondary">{t("landing.v2.nav.signIn")}</GlassButton>
        </Link>
        <button
          ref={buttonRef}
          type="button"
          className="lp2-nav-menu-btn"
          aria-expanded={open}
          aria-controls={sheetId}
          aria-label={t(open ? "landing.v2.nav.closeMenu" : "landing.v2.nav.openMenu")}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
        </button>
      </div>

      {open && (
        <>
          <button
            type="button"
            className="lp2-nav-sheet-scrim"
            aria-label={t("landing.v2.nav.dismiss")}
            onClick={closeAndFocus}
          />
          <div
            id={sheetId}
            className="lp2-nav-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("landing.v2.nav.sheetAria")}
          >
            <ul>
              {linkKeys.map((l) => (
                <li key={l.id}>
                  <a href={`#${l.id}`} onClick={closeAndFocus}>{t(l.key)}</a>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </nav>
  );
}
export default Nav;
