import {
  createContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ResolvedTheme,
  ThemeContextValue,
  ThemeMode,
} from "./theme.types";

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = "ai-workforce-theme";

function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (
    storedTheme === "light" ||
    storedTheme === "dark" ||
    storedTheme === "system"
  ) {
    return storedTheme;
  }

  return "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredTheme()),
  );

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);

    const updateTheme = () => {
      setResolvedTheme(resolveTheme(theme));
    };

    updateTheme();

    const mediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)",
    );

    if (theme === "system") {
      mediaQuery.addEventListener("change", updateTheme);
    }

    return () => {
      mediaQuery.removeEventListener("change", updateTheme);
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: setThemeState,
    }),
    [theme, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}