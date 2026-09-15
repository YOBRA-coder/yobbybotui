// context/ThemeContext.tsx — Auto/Dark/Light theme mode.
//
// "settings like auto, dark, light modes" — there was no theme system of
// any kind before; every color in the app was a hardcoded hex value. This
// provides a real, working toggle: it persists the choice, resolves "auto"
// against the OS/browser's prefers-color-scheme, and applies the result as
// a `data-theme` attribute on <html>. The actual color values live in CSS
// custom properties (see the injected stylesheet in App.tsx and
// pages/styles.ts), which is what lets a single toggle re-color every
// place that reads var(--bg)/var(--surface)/etc. without needing every
// component to re-render.
//
// Scope note (see the delivery summary, not just this comment): this
// re-themes the shared app shell (sidebar, top bar, mobile nav) and every
// page built from the shared `S` style tokens in pages/styles.ts. Pages
// with heavily hardcoded per-component hex — TradingPage, ProChart,
// DashboardPage — are NOT yet wired to these variables; that's a much
// larger mechanical pass across those files, out of scope for this change.
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type ThemeMode = "auto" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

interface ThemeContextType {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({} as ThemeContextType);
const STORAGE_KEY = "nexusai_theme";

function systemPrefersLight(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === "auto") return systemPrefersLight() ? "light" : "dark";
  return mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (saved === "auto" || saved === "dark" || saved === "light") return saved;
    } catch { /* localStorage unavailable — fall through to default */ }
    return "auto";
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(mode));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  useEffect(() => {
    setResolved(resolve(mode));
    if (mode !== "auto" || typeof window === "undefined" || !window.matchMedia) return;
    // Live-follow OS theme changes while in "auto" mode.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolved(resolve("auto"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* non-fatal */ }
  };

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
