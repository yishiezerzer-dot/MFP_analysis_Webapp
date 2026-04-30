import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Three named themes are applied by setting `data-theme` on <html>.
 *
 *   day           – light mode (default, matches the original app look).
 *   night         – dark mode.
 *   night-vision  – low-light theme dominated by red tones, similar to
 *                   astronomy / cockpit night-vision modes.
 *
 * Each theme is a set of CSS custom properties defined in `styles.css`.
 * Tailwind's `ink-*` and `brand-*` color classes are wired to those
 * variables (see `tailwind.config.js`), so swapping `data-theme` instantly
 * re-colors the entire app without needing to touch individual components.
 */
export type ThemeName = "day" | "night" | "night-vision";

export interface ThemeOption {
  id: ThemeName;
  label: string;
  description: string;
}

export const THEMES: readonly ThemeOption[] = [
  { id: "day", label: "Day", description: "Light mode" },
  { id: "night", label: "Night", description: "Dark mode" },
  {
    id: "night-vision",
    label: "Night Vision",
    description: "Low-light dark red",
  },
] as const;

const STORAGE_KEY = "mfp.theme";
const DEFAULT_THEME: ThemeName = "day";

function isThemeName(value: unknown): value is ThemeName {
  return (
    value === "day" || value === "night" || value === "night-vision"
  );
}

function readInitialTheme(): ThemeName {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeName(raw)) return raw;
  } catch {
    // localStorage disabled or unavailable – fall through.
  }
  return DEFAULT_THEME;
}

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  themes: readonly ThemeOption[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(readInitialTheme);

  // Apply the theme to <html data-theme="..."> so CSS variables cascade
  // to every descendant, and flip the native color-scheme hint so
  // browser-rendered UI (scrollbars, form controls) matches.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "day" ? "light" : "dark";
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore persistence errors (private mode, quota, etc.).
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, themes: THEMES }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}

export interface PlotlyThemeColors {
  plot_bgcolor: string;
  paper_bgcolor: string;
  fontColor: string;
  gridColor: string;
  legendBg: string;
  zerolineColor: string;
  /** Ordered trace colorway — use as Plotly layout.colorway */
  colorway: string[];
}

const PLOTLY_THEME_COLORS: Record<ThemeName, PlotlyThemeColors> = {
  day: {
    plot_bgcolor: "#ffffff",
    paper_bgcolor: "#ffffff",
    fontColor: "#0d1322",
    gridColor: "#d6dcea",
    legendBg: "rgba(255,255,255,0.88)",
    zerolineColor: "#b6c4da",
    colorway: ["#3559A8","#0F766E","#B45309","#7C3AED","#BE123C","#0891B2"],
  },
  night: {
    plot_bgcolor: "#001a37",
    paper_bgcolor: "#001a37",
    fontColor: "#d9e6ff",
    gridColor: "#002042",
    legendBg: "rgba(0,26,55,0.88)",
    zerolineColor: "#284974",
    colorway: ["#7290E8","#5EEAD4","#FCD34D","#C4B5FD","#FDA4AF","#67E8F9"],
  },
  "night-vision": {
    plot_bgcolor: "#100505",
    paper_bgcolor: "#100505",
    fontColor: "#ffaaa5",
    gridColor: "#1a0808",
    legendBg: "rgba(16,5,5,0.88)",
    zerolineColor: "#3c1616",
    colorway: ["#FF6B6B","#FFB347","#FFEAA7","#FF9F80","#E8A0BF","#AFF8D8"],
  },
};

export function usePlotlyTheme(): PlotlyThemeColors {
  const { theme } = useTheme();
  return PLOTLY_THEME_COLORS[theme];
}
