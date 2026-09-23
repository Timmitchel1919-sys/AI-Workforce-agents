import { LOGO_MARK_SRC, scrollToSection } from "../landingActions";
import { useI18n } from "../../../i18n";
import type { MessageKey } from "../../../i18n";

const footerLinks: Array<{ id: string; labelKey: MessageKey }> = [
  { id: "system", labelKey: "landing.nav.system" },
  { id: "security", labelKey: "landing.nav.security" },
  { id: "architecture", labelKey: "landing.nav.architecture" },
];

export function LandingFooter() {
  const { t } = useI18n();
  return (
    <footer className="lp-footer">
      <div className="lp-footer__brand">
        <img src={LOGO_MARK_SRC} alt="" width={24} height={24} />
        <div>
          <p className="lp-footer__name">AI Workforce</p>
          <p className="lp-footer__tagline">{t("landing.footer.tagline")}</p>
        </div>
      </div>
      <nav aria-label={t("landing.footer.label")}>
        <ul className="lp-footer__links">
          {footerLinks.map((link) => (
            <li key={link.id}>
              <a href={`#${link.id}`} onClick={(e) => scrollToSection(e, link.id)}>
                {t(link.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}

export default LandingFooter;
