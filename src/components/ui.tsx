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

/** Equity curve in R with the drawdown under it. */
export function EquityDD({ eq, dd }: { eq: { time: number; r: number }[]; dd: { time: number; dd: number }[] }) {
  if (eq.length < 2) return <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Not enough closed trades for a curve yet.</div>;
  const W = 600, H = 150, HD = 50;
  const ys = eq.map(p => p.r), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys) || 1;
  const X = (i: number, n: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const ddMin = Math.min(-0.01, ...dd.map(d => d.dd));
  const YD = (v: number) => 4 + (v / ddMin) * (HD - 8);
  const pts = eq.map((p, i) => `${X(i, eq.length)},${Y(p.r)}`);
  const last = ys[ys.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label="equity curve" style={{ display: "block", background: "var(--bg2)", borderRadius: 8 }}>
        <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke="var(--border2)" strokeDasharray="3 3" />
        <polygon points={`0,${Y(0)} ${pts.join(" ")} ${W},${Y(0)}`} fill={last >= 0 ? UP : DOWN} fillOpacity={0.14} />
        <polyline points={pts.join(" ")} fill="none" stroke={last >= 0 ? UP : DOWN} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <svg viewBox={`0 0 ${W} ${HD}`} preserveAspectRatio="none" width="100%" height={HD} role="img" aria-label="drawdown" style={{ display: "block", background: "var(--bg2)", borderRadius: 8, marginTop: 4 }}>
        <polygon points={`0,4 ${dd.map((d, i) => `${X(i, dd.length)},${YD(d.dd)}`).join(" ")} ${W},4`} fill={DOWN} fillOpacity={0.3} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--text-mute)", marginTop: 3 }}><span>equity (R) — top · drawdown — bottom</span><span>{last > 0 ? "+" : ""}{last}R · worst drawdown {ddMin.toFixed(1)}R</span></div>
    </div>
  );
}

export function Histogram({ bins }: { bins: { from: number; to: number; n: number }[] }) {
  const mx = Math.max(1, ...bins.map(b => b.n));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }} role="img" aria-label="distribution of trade results in R">
        {bins.map((b, i) => <div key={i} title={`${b.from}R to ${b.to}R: ${b.n} trades`} style={{ flex: 1, height: `${(b.n / mx) * 100}%`, minHeight: b.n ? 2 : 0, background: (b.from + b.to) / 2 >= 0 ? UP : DOWN, opacity: 0.85, borderRadius: "2px 2px 0 0" }} />)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--text-mute)", marginTop: 3 }}><span>{bins[0]?.from}R</span><span>result per trade</span><span>{bins[bins.length - 1]?.to}R</span></div>
    </div>
  );
}

/** Net R per group, as bars (side, grade, hour, weekday, month…). */
export function GroupBars({ title, data, order }: { title: string; data: Record<string, { trades: number; win_rate: number; net_r: number }>; order?: string[] }) {
  const keys = order ? order.filter(k => data[k]) : Object.keys(data).sort();
  if (!keys.length) return null;
  const mx = Math.max(0.01, ...keys.map(k => Math.abs(data[k].net_r)));
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--text-mute)", margin: "2px 0 6px", textTransform: "uppercase" }}>{title}</div>
      {keys.map(k => {
        const g = data[k];
        return (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "52px 1fr 118px", gap: 8, alignItems: "center", fontSize: 10.5, padding: "2px 0" }}>
            <span style={{ color: "var(--text-dim)" }}>{k}</span>
            <span style={{ background: "var(--border2)", height: 6, borderRadius: 3, position: "relative", display: "block" }}>
              <span style={{ position: "absolute", top: 0, bottom: 0, left: g.net_r >= 0 ? "50%" : `${50 - (Math.abs(g.net_r) / mx) * 50}%`, width: `${(Math.abs(g.net_r) / mx) * 50}%`, background: g.net_r >= 0 ? UP : DOWN, borderRadius: 3 }} />
            </span>
            <span style={{ textAlign: "right", color: g.net_r >= 0 ? UP : DOWN }}>{g.net_r > 0 ? "+" : ""}{g.net_r}R <span style={{ color: "var(--text-mute)" }}>· {g.trades}t · {g.win_rate}%</span></span>
          </div>
        );
      })}
    </div>
  );
}
