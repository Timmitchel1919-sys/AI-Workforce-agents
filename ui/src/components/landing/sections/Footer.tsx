import { Link } from "react-router-dom";
import { useI18n } from "../../../i18n";
import "./sections.css";

export function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  return (
    <footer className="lp2-footer">
      <span>© {year} AI Workforce · {t("landing.v2.footer.copy")}</span>
      <span style={{ display: "inline-flex", gap: "1rem" }}>
        <Link to="/login">{t("landing.v2.footer.signIn")}</Link>
        <a href="#security">{t("landing.v2.footer.security")}</a>
      </span>
    </footer>
  );
}
export default Footer;
