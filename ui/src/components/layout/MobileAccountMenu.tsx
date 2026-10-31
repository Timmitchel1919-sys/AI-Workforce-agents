import { LogOut, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useMyProfile } from "../../features/profile";
import { useI18n } from "../../i18n";
import { UserAvatar } from "../ui";

export function MobileAccountMenu({ onNavigate }: { onNavigate: () => void }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { data: profile } = useMyProfile();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const accountLabel = user?.displayName || user?.email || "Operator";

  const go = (path: string) => {
    setOpen(false);
    onNavigate();
    navigate(path);
  };

  return (
    <div className="mobile-account">
      {open ? (
        <div className="mobile-account__menu" role="menu" aria-label={t("shell.accountMenu")}>
          <button type="button" role="menuitem" onClick={() => go("/profile")}>
            <UserRound size={17} aria-hidden="true" /> {t("shell.profile")}
          </button>
          <button type="button" role="menuitem" onClick={() => go("/settings#preferences")}>
            <SlidersHorizontal size={17} aria-hidden="true" /> {t("shell.preferences")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="mobile-account__danger"
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={17} aria-hidden="true" /> {t("shell.signOut")}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="mobile-account__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <UserAvatar name={accountLabel} src={profile?.avatarDataUrl} size={38} />
        <span>
          <strong>{accountLabel}</strong>
          <small>{t("shell.accountMenu")}</small>
        </span>
      </button>
    </div>
  );
}
