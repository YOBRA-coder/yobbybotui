// components/ui.tsx — small shared pieces for the signal screens.
import type { SetupState } from "../types/mtf";

export const UP = "#00d084", DOWN = "#ff4757", WARN = "#ffd700", BLUE = "#0094ff", MUTED = "#6f86a8";
export const card: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" };
export const cardHead: React.CSSProperties = { color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" };
export const field: React.CSSProperties = { background: "var(--bg2)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 6, padding: "5px 9px", fontSize: 11, fontFamily: "inherit" };

export const STATE_META: Record<SetupState, { label: string; color: string }> = {
  SIGNAL: { label: "SIGNAL", color: UP },
  SETUP: { label: "SETUP · waiting for trigger", color: WARN },
  WATCH: { label: "WATCH · wait for pullback", color: BLUE },
  STAND_ASIDE: { label: "STAND ASIDE", color: MUTED },
};
export const biasColor = (b: string) => (b === "bullish" ? UP : b === "bearish" ? DOWN : MUTED);

export function ago(sec: number): string {
  const d = Math.max(0, Math.round(Date.now() / 1000 - sec));
  return d < 90 ? `${d}s ago` : d < 5400 ? `${Math.round(d / 60)}m ago` : d < 172800 ? `${Math.round(d / 3600)}h ago` : `${Math.round(d / 86400)}d ago`;
}

export function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color, background: `${color}1c`, border: `1px solid ${color}44`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function Ring({ pct, color, size = 76 }: { pct: number; color: string; size?: number }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" role="img" aria-label={`agreement ${pct}%`}>
      <circle cx={38} cy={38} r={r} fill="none" stroke="var(--border2)" strokeWidth={7} />
      <circle cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`} transform="rotate(-90 38 38)" />
      <text x={38} y={42} textAnchor="middle" fontSize={15} fontWeight={800} fill="var(--text)">{Math.round(pct)}%</text>
    </svg>
  );
}

export function EquityLine({ pts }: { pts: { r: number }[] }) {
  if (pts.length < 2) return <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Not enough closed trades for a curve yet.</div>;
  const w = 300, h = 70;
  const ys = pts.map(p => p.r), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys) || 1;
  const X = (i: number) => (i / (pts.length - 1)) * w;
  const Y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ maxWidth: 460 }}>
      <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--border2)" strokeDasharray="3 3" />
      <polyline fill="none" stroke={ys[ys.length - 1] >= 0 ? UP : DOWN} strokeWidth={1.8} points={pts.map((p, i) => `${X(i)},${Y(p.r)}`).join(" ")} />
    </svg>
  );
}
