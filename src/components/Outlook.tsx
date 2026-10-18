// components/Outlook.tsx — "what to expect, and roughly when" for BOTH the with-trend read and the counter-trend watch.
import type { MtfDecision, MtfResponse, Outlook } from "../types/mtf";
import { PlanPreview } from "./Feeds";
import { fmtPrice } from "./MtfChart";
import { BLUE, DOWN, MUTED, UP, WARN } from "./ui";

const STATE_COL: Record<string, string> = { SIGNAL: UP, SETUP: WARN, WATCH: BLUE, STAND_ASIDE: MUTED };
const STATE_TXT: Record<string, string> = { SIGNAL: "SIGNAL", SETUP: "SETUP", WATCH: "WATCH", STAND_ASIDE: "STAND ASIDE" };

function clock(sec: number, withDay: boolean) {
  const d = new Date(sec * 1000);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return withDay ? `${d.toLocaleDateString([], { weekday: "short" })} ${t}` : t;
}
function rel(sec: number, now: number) {
  const m = Math.round((sec - now) / 60);
  if (m <= 0) return "now";
  if (m < 90) return `in ${m}m`;
  const h = m / 60;
  return h < 36 ? `in ${h.toFixed(h < 10 ? 1 : 0)}h` : `in ${Math.round(h / 24)}d`;
}
export function whenText(o: Outlook, now = Date.now() / 1000): string {
  if (!o.from) return "–";
  const day = new Date(o.from * 1000).toDateString() !== new Date().toDateString() || (o.to ?? 0) - o.from > 12 * 3600;
  if (!o.to || o.to <= o.from) return `${clock(o.from, day)} (${rel(o.from, now)})`;
  return `${clock(o.from, day)} – ${clock(o.to, day)} (${rel(o.from, now)} → ${rel(o.to, now)})`;
}

function Block({ title, sub, dec, candles, tint }: { title: string; sub: string; dec: MtfDecision | null | undefined; candles?: { time: number; close: number; high: number; low: number }[]; tint: string }) {
  const o = dec?.outlook;
  if (!dec || !o) return null;
  const col = STATE_COL[o.state] ?? MUTED;
  const side = o.side || dec.side || "";
  const sideCol = side === "BUY" ? UP : side === "SELL" ? DOWN : "var(--text-dim)";
  const idle = o.state === "STAND_ASIDE";
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", gap: 8, fontSize: 11, padding: "2px 0", lineHeight: 1.45 }}>
      <span style={{ width: 74, flexShrink: 0, color: "var(--text-dim)" }}>{k}</span><span style={{ flex: 1, minWidth: 0 }}>{v}</span>
    </div>
  );
  return (
    <div style={{ border: `1px solid ${tint}55`, borderLeft: `3px solid ${tint}`, borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: tint }}>{title}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: col }}>{side && !idle ? <span style={{ color: sideCol }}>{side} · </span> : null}{STATE_TXT[o.state]} · {dec.agreement}%</span>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginBottom: 4 }}>{sub}</div>
      {row("Expect", o.scenario)}
      {row(idle ? "Re-check" : "When", <span><b>{whenText(o)}</b>{o.window ? <span style={{ color: "var(--text-dim)" }}> — {o.window}</span> : null}</span>)}
      {o.confirm && row("Needs", o.confirm)}
      {o.invalid != null && row("Cancel if", <span style={{ color: DOWN }}>price closes beyond {fmtPrice(o.invalid)}</span>)}
      {o.target != null && row("Target", <span style={{ color: UP }}>{fmtPrice(o.target)}{dec.plan ? ` · ${dec.plan.rr}R` : ""}</span>)}
      {o.killzone && !idle && row("Session", o.killzone.active ? `${o.killzone.name} kill zone is open now` : `${o.killzone.name} opens ${clock(o.killzone.start, true)}`)}
      {o.risk_note && <div style={{ fontSize: 10.5, color: WARN, marginTop: 4, lineHeight: 1.4 }}>⚠ {o.risk_note}</div>}
      {dec.plan && !idle && candles && candles.length > 3 && <div style={{ marginTop: 6 }}><PlanPreview candles={candles} plan={dec.plan} entryTime={dec.time} /></div>}
    </div>
  );
}

export function OutlookCard({ data, withPreview = true }: { data: MtfResponse; withPreview?: boolean }) {
  const dec = data.decision;
  const entryPanel = data.panels.find(p => p.tf === dec.entry_tf) ?? data.panels[data.panels.length - 1];
  const candles = withPreview ? entryPanel?.candles : undefined;
  const htf = dec.bias_tf.toUpperCase();
  return (
    <div>
      <Block title="WITH THE TREND" sub={`${htf} ${dec.direction} · ${dec.label}`} dec={dec} candles={candles} tint={BLUE} />
      <Block title="COUNTER-TREND WATCH" sub={`fades the ${htf} ${dec.direction} bias · watch-only, not sent as an alert`} dec={data.counter} candles={candles} tint="#ff9f43" />
    </div>
  );
}
