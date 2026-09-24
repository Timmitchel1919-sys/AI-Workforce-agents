import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2 } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { UserAvatar } from "../../components/ui";
import { resizeToAvatar, useMyProfile, useProfilePhoto } from "../../features/profile";
import { useI18n, type MessageKey } from "../../i18n";
import PreferencesCard from "./PreferencesCard";
import "../Settings/SettingsPage.css";
import "./ProfilePage.css";

const ROLE_LABELS: Record<string, MessageKey> = {
  viewer: "access.roleViewer",
  operator: "access.roleOperator",
  admin: "access.roleAdmin",
};

type Notice = { tone: "success" | "error"; text: string } | null;

/**
 * Profile: two separate cards — the operator's profile (photo, display name,
 * read-only identity and role) and their preferences (theme, language).
 * The role is shown as reported by the Control Plane and is never editable.
 */
export default function ProfilePage() {
  const { t } = useI18n();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === "#preferences") {
      document.getElementById("preferences")?.scrollIntoView?.({ block: "start" });
    }
  }, [hash]);

  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={t("profile.title")} description={t("profile.description")} />
      <div className="profile-cards">
        <ProfileCard />
        <PreferencesCard />
      </div>
    </PageContainer>
  );
}

function ProfileCard() {
  const { t } = useI18n();
  const auth = useAuth();
  const client = useQueryClient();
  const { data: profile } = useMyProfile();
  const photo = useProfilePhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const nameHintId = useId();
  const [name, setName] = useState(auth.user?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const displayName = profile?.displayName || auth.user?.displayName || auth.user?.email || "Operator";
  const email = profile?.email ?? auth.user?.email ?? undefined;
  const role = profile?.role ?? auth.accessDetails.role;
  const canEditPhoto = auth.access === "granted";
  const nameChanged = name.trim() !== (auth.user?.displayName ?? "").trim();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    try {
      const dataUrl = await resizeToAvatar(file);
      await photo.mutateAsync(dataUrl);
      setNotice({ tone: "success", text: t("profile.photoSaved") });
    } catch {
      setNotice({ tone: "error", text: t("profile.photoError") });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setNotice(null);
    try {
      await photo.mutateAsync(null);
      setNotice({ tone: "success", text: t("profile.photoRemoved") });
    } catch {
      setNotice({ tone: "error", text: t("profile.photoError") });
    }
  };

  const onSaveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.updateDisplayName) return;
    setSavingName(true);
    setNotice(null);
    try {
      await auth.updateDisplayName(name);
      await client.invalidateQueries({ queryKey: ["workforce", "me", "profile"] });
      setNotice({ tone: "success", text: t("profile.nameSaved") });
    } catch {
      setNotice({ tone: "error", text: t("profile.nameError") });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <section className="settings-section profile-card" aria-labelledby="profile-card-title">
      <header className="settings-section__header">
        <h2 id="profile-card-title" className="settings-section__title">
          {t("profile.cardTitle")}
        </h2>
        <p className="settings-section__description">{t("profile.cardDescription")}</p>
      </header>

      <div className="profile-photo">
        <UserAvatar
          name={displayName}
          src={profile?.avatarDataUrl}
          size={96}
          alt={profile?.avatarDataUrl ? t("profile.avatarAlt", { name: displayName }) : undefined}
          className="profile-photo__avatar"
        />
        <div className="profile-photo__body">
          <span className="settings-field__label">{t("profile.photo")}</span>
          <p className="settings-field__hint">{canEditPhoto ? t("profile.photoHint") : t("profile.photoUnavailable")}</p>
          <div className="profile-photo__actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="profile-photo__input"
              aria-label={t("profile.uploadPhoto")}
              tabIndex={-1}
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            <button
              type="button"
              className="ui-button primary"
              disabled={!canEditPhoto || photo.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={16} aria-hidden />
              {profile?.avatarDataUrl ? t("profile.changePhoto") : t("profile.uploadPhoto")}
            </button>
            {profile?.avatarDataUrl ? (
              <button
                type="button"
                className="ui-button profile-photo__remove"
                disabled={photo.isPending}
                onClick={() => void onRemove()}
              >
                <Trash2 size={16} aria-hidden />
                {t("profile.removePhoto")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <form className="settings-field" onSubmit={(event) => void onSaveName(event)}>
        <label htmlFor={nameId} className="settings-field__label">
          {t("profile.displayName")}
        </label>
        <p id={nameHintId} className="settings-field__hint">
          {t("profile.displayNameHint")}
        </p>
        <div className="profile-name">
          <input
            id={nameId}
            className="ui-input"
            value={name}
            maxLength={80}
            autoComplete="name"
            aria-describedby={nameHintId}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="ui-button" disabled={!auth.updateDisplayName || !nameChanged || savingName}>
            {t("profile.saveName")}
          </button>
        </div>
      </form>

      <dl className="profile-facts">
        <div>
          <dt>{t("profile.email")}</dt>
          <dd>{email ?? t("profile.notSet")}</dd>
        </div>
        <div>
          <dt>{t("profile.role")}</dt>
          <dd>
            {role ? t(ROLE_LABELS[role] ?? "profile.notSet") : t("profile.notSet")}
            <span className="profile-facts__note">{t("profile.roleNote")}</span>
          </dd>
        </div>
      </dl>

      {notice ? (
        <p className={`profile-notice profile-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
