import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { titleCase } from "../lib/formatters";
import { Badge, ChevronDown, Dropdown } from "../components/ui";

function initials(name: string | null, email: string | null): string {
  const source = name ?? email ?? "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function UserMenu() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const name = user?.displayName ?? user?.email ?? "Operator";

  return (
    <Dropdown
      label="Account menu"
      header={
        <div className="user-menu__header">
          <div className="user-menu__header-name">{name}</div>
          {user?.email ? (
            <div className="user-menu__header-email">{user.email}</div>
          ) : null}
          {role ? (
            <div style={{ marginTop: "var(--space-2xs)" }}>
              <Badge tone="neutral">{titleCase(role)}</Badge>
            </div>
          ) : null}
        </div>
      }
      items={[
        {
          id: "settings",
          label: "Settings",
          onSelect: () => navigate("/settings"),
        },
        "separator",
        {
          id: "signout",
          label: "Sign out",
          danger: true,
          onSelect: () => {
            void signOut();
          },
        },
      ]}
      trigger={(props) => (
        <button
          type="button"
          className="user-menu__trigger"
          aria-label="Account menu"
          {...props}
        >
          <span className="avatar" aria-hidden="true">
            {initials(user?.displayName ?? null, user?.email ?? null)}
          </span>
          <span className="user-menu__name">{name}</span>
          <ChevronDown width={14} height={14} aria-hidden="true" />
        </button>
      )}
    />
  );
}
