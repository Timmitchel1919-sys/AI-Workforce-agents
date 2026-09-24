import { useContext } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { authContext } from "../../auth/authContext";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useI18n } from "../../i18n";
import "./SettingsPage.css";
import "./UsersAccess.css";

/**
 * Settings hub. Theme and language live on the Profile → Preferences card;
 * administrators also reach Users & Access from here.
 */
export default function SettingsPage() {
  const { t } = useI18n();
  // UX only: the link shows for administrators; the Control Plane enforces it.
  const canManageAccess =
    useContext(authContext)?.accessDetails.capabilities.includes("manage_access") ?? false;

  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={t("settings.title")} description={t("settings.description")} />

      <section className="settings-section" aria-labelledby="settings-preferences">
        <header className="settings-section__header">
          <h2 id="settings-preferences" className="settings-section__title">
            {t("settings.appearance")}
          </h2>
        </header>
        <Link to="/profile#preferences" className="settings-access-link">
          <SlidersHorizontal size={20} aria-hidden />
          <span>
            <strong>{t("settings.preferencesLink")}</strong>
            <br />
            <span className="access-muted">{t("settings.preferencesLinkDescription")}</span>
          </span>
          <ChevronRight size={18} aria-hidden style={{ marginLeft: "auto" }} />
        </Link>
      </section>

      {canManageAccess ? (
        <section className="settings-section" aria-labelledby="settings-access">
          <header className="settings-section__header">
            <h2 id="settings-access" className="settings-section__title">
              {t("access.title")}
            </h2>
          </header>
          <Link to="/settings/access" className="settings-access-link">
            <ShieldCheck size={20} aria-hidden />
            <span>
              <strong>{t("access.settingsLink")}</strong>
              <br />
              <span className="access-muted">{t("access.settingsLinkDescription")}</span>
            </span>
            <ChevronRight size={18} aria-hidden style={{ marginLeft: "auto" }} />
          </Link>
        </section>
      ) : null}
    </PageContainer>
  );
}
