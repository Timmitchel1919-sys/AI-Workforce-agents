import { useShell } from "./shellContext";
import { Breadcrumbs } from "./Breadcrumbs";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { GlobalSearchTrigger } from "./GlobalSearchTrigger";
import { useTheme, type ThemePreference } from "../theme";
import {
  IconButton,
  Menu,
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

/**
 * Application-level controls only — nothing page-specific. Breadcrumbs give
 * page context; search / workspace / theme / account are global.
 */
export function Topbar() {
  const { openMobileNav } = useShell();
  const { preference, setPreference } = useTheme();
  const ThemeIcon = THEME_ICON[preference];

  return (
    <header className="topbar">
      <div className="topbar__left">
        <IconButton
          className="topbar__menu-btn"
          icon={Menu}
          label="Open navigation"
          size="sm"
          onClick={openMobileNav}
        />
        <Breadcrumbs />
      </div>

      <span className="topbar__spacer" />

      <div className="topbar__right">
        <GlobalSearchTrigger />
        <WorkspaceSwitcher />
        <IconButton
          icon={ThemeIcon}
          label={`Theme: ${preference} — click to change`}
          size="sm"
          onClick={() => setPreference(NEXT_THEME[preference])}
        />
        <UserMenu />
      </div>
    </header>
  );
}
