import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { navLinks } from "../landingContent";
import { useI18n } from "../../../i18n";
import { CONTROL_CENTER_ROUTE, LOGO_MARK_SRC, scrollToSection } from "../landingActions";

export function LandingNavbar() {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className={`lp-nav${scrolled ? " is-scrolled" : ""}`}>
      <nav className="lp-nav__bar lp-glass" aria-label={t("landing.navLabel")}>
        <a href="#top" className="lp-nav__brand" onClick={(e) => scrollToSection(e, "top")}>
          <img src={LOGO_MARK_SRC} alt="" className="lp-nav__logo" width={28} height={28} />
          <span>AI Workforce</span>
        </a>

        <ul className="lp-nav__links">
          {navLinks.map((link) => (
            <li key={link.id}>
              <a href={`#${link.id}`} onClick={(e) => scrollToSection(e, link.id)}>
                {t(link.labelKey)}
              </a>
            </li>
          ))}
        </ul>

        <Link to={CONTROL_CENTER_ROUTE} className="lp-nav__cta">
          {t("landing.enterOs")}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>

        <button
          type="button"
          className="lp-nav__menu-button"
          aria-expanded={menuOpen}
          aria-controls="lp-mobile-menu"
          aria-label={menuOpen ? t("landing.closeMenu") : t("landing.openMenu")}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>
      </nav>

      {menuOpen ? (
        <div id="lp-mobile-menu" className="lp-nav__mobile lp-glass">
          <ul>
            {navLinks.map((link) => (
              <li key={link.id}>
                <a
                  href={`#${link.id}`}
                  onClick={(e) => {
                    setMenuOpen(false);
                    scrollToSection(e, link.id);
                  }}
                >
                  {t(link.labelKey)}
                </a>
              </li>
            ))}
          </ul>
          <Link to={CONTROL_CENTER_ROUTE} className="lp-button lp-button--primary">
            {t("landing.enterOs")}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </header>
  );
}

export default LandingNavbar;
