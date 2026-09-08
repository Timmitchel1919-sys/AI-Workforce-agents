import { LogOut } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { titleCase } from "../lib/formatters";

export function Topbar() {
  const { user, role, signOut } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar__title">Control Center</div>
      <div className="topbar__account">
        {role ? (
          <span className="badge" data-role={role}>
            {titleCase(role)}
          </span>
        ) : null}
        <span className="topbar__email">{user?.email ?? "—"}</span>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void signOut();
          }}
        >
          <LogOut className="btn__icon" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </header>
  );
}
