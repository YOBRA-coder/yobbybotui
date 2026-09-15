// pages/styles.ts — Shared style tokens
//
// These use CSS custom properties (var(--surface), var(--border), etc.,
// defined in App.tsx's injected stylesheet) rather than hardcoded hex, so
// every page built from these tokens re-themes automatically when
// ThemeContext changes data-theme on <html> — no re-render needed, the
// browser just re-resolves the var(). Accent/status colors (green/red/
// yellow) stay constant across themes on purpose.
import type { CSSProperties } from "react";

export const authBg: CSSProperties = {
  minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center",
  justifyContent: "center", position: "relative", overflow: "hidden",
  fontFamily: "'IBM Plex Mono', monospace",
  backgroundImage: "linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)",
  backgroundSize: "44px 44px",
};

export const S: Record<string, CSSProperties> = {
  authGlow: { position: "absolute", width: 500, height: 500, background: "radial-gradient(circle,#00d08420 0%,transparent 65%)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" },
  authCard: { background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 14, padding: "38px 34px", width: 400, maxWidth: "92vw", position: "relative", zIndex: 1, boxShadow: "0 24px 80px #00000090" },
  authSub: { color: "var(--text-mute)", textAlign: "center", marginBottom: 28, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" },
  fg: { marginBottom: 12 },
  lbl: { display: "block", color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 2, marginBottom: 5, textTransform: "uppercase" },
  inp: { width: "100%", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 7, padding: "9px 12px", color: "var(--text)", fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", transition: "border-color .15s, box-shadow .15s" },
  btn: { width: "100%", background: "#00d084", color: "#000", border: "none", borderRadius: 7, padding: "11px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: 1 },
  btnO: { background: "transparent", border: "1px solid var(--border2)", borderRadius: 7, padding: "9px 16px", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 },
  danger: { width: "100%", background: "#ff4757", color: "#000", border: "none", borderRadius: 7, padding: "11px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: 1 },
  err: { background: "#ff475718", border: "1px solid #ff475744", borderRadius: 7, padding: "9px 12px", color: "#ff4757", fontSize: 11, marginBottom: 12 },
  card: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "15px 17px" },
  ch: { color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 13, paddingBottom: 9, borderBottom: "1px solid var(--border)" },
  pill: { display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 20, padding: "3px 8px", fontSize: 9, fontWeight: 700 },

};
