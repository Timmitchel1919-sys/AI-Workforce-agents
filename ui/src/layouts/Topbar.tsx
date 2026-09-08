import { useAuth } from "../auth/useAuth";
import { titleCase } from "../lib/formatters";
import { useTheme, type ThemePreference } from "../theme";
import {
  Badge,
  Button,
  IconButton,
  LogOut,
  Moon,
  MonitorSmartphone,
  Sun,
} from "../components/ui";

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const THEME_ICON = {
  system: MonitorSmartphone,
  light: Sun,
  dark: Moon,
} as const;

export function Topbar() {
  const { user, role, signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const ThemeIcon = THEME_ICON[preference];

  return (
    <header className="topbar">
      <div className="topbar__title">Control Center</div>
      <div className="topbar__account">
        <IconButton
          icon={ThemeIcon}
          label={`Theme: ${preference} (click to change)`}
          size="sm"
          onClick={() => setPreference(NEXT_THEME[preference])}
        />
        {role ? <Badge tone="neutral">{titleCase(role)}</Badge> : null}
        <span className="topbar__email">{user?.email ?? "—"}</span>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={LogOut}
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
