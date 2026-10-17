// components/SignalPanels.tsx — the cards that make up the signal screens:
// concept toggles, the signal card, sessions, the checklist and the chart-panel factory.
import { useEffect, useMemo, useState } from "react";
import { PAIR_DISPLAY } from "../types";
import MtfChart, { fmtPrice } from "./MtfChart";
import { useMtf } from "../context/MtfContext";
import { ALL_TFS, LAYERS } from "../types/mtf";
import { ActivityFeed, NewsList } from "./Feeds";
import type { LayerKey, MtfDecision, MtfPanel } from "../types/mtf";
import { BLUE, DOWN, MUTED, Pill, Ring, STATE_META, UP, WARN, ago, biasColor, card, cardHead, field } from "./ui";

// ── concept toggles (with how many of each the engine found) ────────────────
export function ConceptBar({ panels }: { panels: MtfPanel[] }) {
  const { layers, setLayers, data } = useMtf();
  const counts = useMemo(() => {
    const c = Object.fromEntries(LAYERS.map(l => [l.key, 0])) as Record<LayerKey, number>;
    panels.forEach(p => {
      c.ob += p.orderBlocks.filter(b => !b.mitigated).length;
      c.fvg += p.fvgs.filter(g => !g.filled).length;
      c.sd += p.sdZones.length; c.poi += p.poi.length;
      c.bos += p.breaks.events.filter(e => e.kind === "BOS").length;
      c.choch += p.breaks.events.filter(e => e.kind === "CHoCH").length;
      c.swings += p.structure.swings.filter(s => s.label).length;
      c.eq += p.eq.length; c.sweep += p.sweeps.length; c.retest += p.retests.length;
      c.trend += p.trendlines.length; c.pd += p.pd ? 1 : 0;
    });
    c.plan = data?.decision.plan ? 1 : 0;
    return c;
  }, [panels, data]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {LAYERS.map(l => (
        <button key={l.key} title={l.hint} onClick={() => setLayers({ ...layers, [l.key]: !layers[l.key] })}
          style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, border: `1px solid ${layers[l.key] ? l.color : "var(--border2)"}`, background: layers[l.key] ? `${l.color}22` : "transparent", color: layers[l.key] ? l.color : "var(--text-mute)" }}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: l.color, marginRight: 5, opacity: layers[l.key] ? 1 : 0.4 }} />
          {l.label}{counts[l.key] ? <span style={{ opacity: 0.8 }}> {counts[l.key]}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ── full-screen side panel: log, news, levels, signals ──────────────────────
type SideTab = "log" | "news" | "levels" | "signals";
function FullViewSide({ panel }: { panel: MtfPanel }) {
  const { data, events, signals, symbol, minAgree } = useMtf();
  const [tab, setTab] = useState<SideTab>("log");
  const dec = data?.decision;
  const price = data?.price ?? panel.candles[panel.candles.length - 1]?.close ?? 0;
  const zones = useMemo(() => {
    const z: { label: string; top: number; bottom: number; color: string }[] = [];
    panel.orderBlocks.filter(b => !b.mitigated).forEach(b => z.push({ label: `${b.kind} order block`, top: b.top, bottom: b.bottom, color: b.kind === "bullish" ? UP : DOWN }));
    panel.fvgs.filter(g => !g.filled).forEach(g => z.push({ label: `${g.kind} FVG${g.fillPct ? ` (${Math.round(g.fillPct)}% filled)` : ""}`, top: g.top, bottom: g.bottom, color: BLUE }));
    panel.sdZones.forEach(d => z.push({ label: `${d.kind}${d.fresh ? " (fresh)" : ""}`, top: d.top, bottom: d.bottom, color: "#b78bff" }));
    panel.eq.forEach(e => z.push({ label: `${e.kind}${e.swept ? " swept" : " liquidity"}`, top: e.price, bottom: e.price, color: "#ff7bd5" }));
    return z.sort((a, b) => Math.abs((a.top + a.bottom) / 2 - price) - Math.abs((b.top + b.bottom) / 2 - price)).slice(0, 14);
  }, [panel, price]);
  const mine = signals.filter(s => s.symbol === symbol).slice(0, 12);
  const tabBtn = (t: SideTab, label: string) => (
    <button key={t} onClick={() => setTab(t)} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "8px 4px", background: "transparent", border: "none", borderBottom: `2px solid ${tab === t ? BLUE : "transparent"}`, color: tab === t ? "var(--text)" : "var(--text-dim)" }}>{label}</button>
  );
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface2)", zIndex: 1 }}>
        {tabBtn("log", "LOG")}{tabBtn("news", "NEWS")}{tabBtn("levels", "LEVELS")}{tabBtn("signals", "SIGNALS")}
      </div>
      <div style={{ padding: 12 }}>
        {tab === "log" && (
          <>
            {dec && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: dec.type === "BUY" ? UP : dec.type === "SELL" ? DOWN : "var(--text)" }}>{dec.type === "HOLD" ? "WAIT" : dec.type} · {dec.agreement}% <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(min {minAgree}%)</span></div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", margin: "3px 0 6px" }}>{dec.watch}</div>
                {dec.checks.map(c => (
                  <div key={c.id} style={{ display: "flex", gap: 6, fontSize: 10.5, padding: "2px 0" }}>
                    <span style={{ width: 12, fontWeight: 800, color: c.ok === null ? "var(--text-mute)" : c.ok ? UP : DOWN }}>{c.ok === null ? "–" : c.ok ? "✓" : "✗"}</span>
                    <span><b>{c.label}</b> <span style={{ color: "var(--text-dim)" }}>{c.detail}</span></span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...cardHead, marginTop: 4 }}>Activity</div>
            <ActivityFeed events={events} limit={25} />
          </>
        )}
        {tab === "news" && <NewsList symbol={symbol} limit={20} />}
        {tab === "levels" && (
          <>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>{panel.tf.toUpperCase()} zones nearest to price {fmtPrice(price)}</div>
            {zones.map((z, i) => {
              const mid = (z.top + z.bottom) / 2, d = ((mid - price) / price) * 100;
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 11 }}>
                  <span><span style={{ color: z.color }}>■</span> {z.label}<div style={{ color: "var(--text-dim)", fontSize: 10 }}>{fmtPrice(z.bottom)}{z.top !== z.bottom ? ` – ${fmtPrice(z.top)}` : ""}</div></span>
                  <span style={{ color: d >= 0 ? UP : DOWN, fontWeight: 700 }}>{d >= 0 ? "+" : ""}{d.toFixed(2)}%</span>
                </div>
              );
            })}
            {!zones.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>No open zones in range.</div>}
          </>
        )}
        {tab === "signals" && (
          <>
            {mine.map(s => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 11 }}>
                <span><b style={{ color: s.side === "BUY" ? UP : DOWN }}>{s.side}</b> {s.entry_tf} · {fmtPrice(s.entry)}<div style={{ color: "var(--text-mute)", fontSize: 10 }}>{ago(s.created_at)}</div></span>
                <b style={{ color: s.status === "WIN" ? UP : s.status === "LOSS" ? DOWN : "var(--text-dim)" }}>{s.status === "OPEN" ? "FIRED" : s.status === "WIN" ? "APPROVED" : s.status}</b>
              </div>
            ))}
            {!mine.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>No signal on this pair yet.</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ── one chart panel wired to the shared state ───────────────────────────────
export function ChartPanel({ panel, title, height, headerRight }: { panel: MtfPanel | undefined; title: string; height: number; headerRight?: React.ReactNode }) {
  const { layers, data, symbol, loading, history, setHistory } = useMtf();
  if (!panel) return <div style={{ ...card, height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>{loading ? "Loading candles…" : "No data"}</div>;
  const dec = data?.decision;
  return (
    <MtfChart key={`${symbol}-${panel.tf}`} panel={panel} layers={layers} plan={dec?.plan ?? null} planTime={dec?.time}
      title={title} subtitle={`${panel.bias} · ${panel.structure.trend}`} height={height} headerRight={headerRight}
      side={<FullViewSide panel={panel} />} onNeedMore={v => { if (v > history) setHistory(Math.min(1500, Math.max(300, v))); }} />
  );
}

// ── the 1 / 2 / 3-chart top-down workspace (Dashboard + Charts share it, and remember the choice) ─
export function Workspace({ compact }: { compact: boolean }) {
  const { entryTf, layout, setLayout, lead, setLead, dir, setDir, viewTf, setViewTf, setWanted, data, symbol } = useMtf();
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 900);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 900); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const single = viewTf || entryTf;
  const tfs = layout === 3 ? [lead, dir, entryTf] : layout === 2 ? [dir, entryTf] : [single];
  useEffect(() => setWanted(tfs), [tfs.join(), setWanted]); // eslint-disable-line react-hooks/exhaustive-deps
  const panel = (tf: string) => data?.panels.find(p => p.tf === tf);
  const nm = (tf: string) => `${PAIR_DISPLAY[symbol] || symbol} · ${tf.toUpperCase()}`;
  const hSmall = narrow ? 300 : compact ? 270 : 380, hBig = narrow ? 340 : compact ? 400 : 480;
  const btn = (on: boolean) => ({ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 6, border: `1px solid ${on ? BLUE : "var(--border2)"}`, background: on ? "#0094ff22" : "transparent", color: on ? BLUE : "var(--text-dim)" } as const);
  const role = (label: string, v: string, set: (x: string) => void) => (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><span style={{ fontSize: 9, color: "var(--text-dim)" }}>{label}</span><TfSelect value={v} options={ALL_TFS} onChange={set} /></span>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ ...card, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {([1, 2, 3] as const).map(k => <button key={k} style={btn(layout === k)} onClick={() => setLayout(k)} title={k === 3 ? "4H lead · 1H direction · entry" : k === 2 ? "1H direction · entry" : "One chart"}>{k} chart{k > 1 ? "s" : ""}</button>)}
          <span style={{ width: 1, height: 16, background: "var(--border2)" }} />
          {layout === 1 && ALL_TFS.map(t => <button key={t} style={btn(t === single)} onClick={() => setViewTf(t)}>{t.toUpperCase()}</button>)}
          {layout !== 1 && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Top-down: {tfs.map(t => t.toUpperCase()).join(" → ")} <span style={{ color: "var(--text-mute)" }}>(entry TF is set in the top bar)</span></span>}
        </div>
        <ConceptBar panels={data?.panels ?? []} />
      </div>
      {layout === 1 && <ChartPanel panel={panel(single)} title={nm(single)} height={narrow ? 360 : compact ? 480 : 600} />}
      {layout === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 10 }}>
          <ChartPanel panel={panel(dir)} title={`${dir.toUpperCase()} · DIRECTION`} height={hBig} headerRight={role("DIR", dir, setDir)} />
          <ChartPanel panel={panel(entryTf)} title={`${entryTf.toUpperCase()} · ENTRY`} height={hBig} />
        </div>
      )}
      {layout === 3 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 10 }}>
            <ChartPanel panel={panel(lead)} title={`${lead.toUpperCase()} · LEAD`} height={hSmall} headerRight={role("LEAD", lead, setLead)} />
            <ChartPanel panel={panel(dir)} title={`${dir.toUpperCase()} · DIRECTION`} height={hSmall} headerRight={role("DIR", dir, setDir)} />
          </div>
          <ChartPanel panel={panel(entryTf)} title={`${entryTf.toUpperCase()} · ENTRY`} height={hBig} />
        </>
      )}
    </div>
  );
}

// ── sessions (UTC windows; London/NY open + overlap are the kill zones) ─────
const SESSIONS = [
  { name: "Asia", s: 0, e: 8, kz: false },
  { name: "London", s: 7, e: 16, kz: true },
  { name: "New York", s: 12.5, e: 21, kz: true },
];
const hm = (h: number) => { const d = new Date(); d.setUTCHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); };
export function activeSession(now = new Date()): string | null {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const hit = [...SESSIONS].reverse().find(x => h >= x.s && h < x.e);
  return hit ? hit.name : null;
}
export function SessionsCard() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const fmt = (x: number) => { const m = Math.round(x * 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  return (
    <div style={card}>
      <div style={cardHead}>Sessions</div>
      {SESSIONS.map(s => {
        const open = h >= s.s && h < s.e;
        const until = open ? s.e - h : (s.s - h + 24) % 24;
        return (
          <div key={s.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{s.name} {s.kz && <Pill color={WARN}>KILL ZONE</Pill>}</div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{hm(s.s)}–{hm(s.e)} your time</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: open ? UP : DOWN }}>{open ? "OPEN" : "CLOSED"}</div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{open ? "closes" : "opens"} in {fmt(until)}</div>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginTop: 6 }}>Crypto trades 24/7; signals score higher inside London / New York.</div>
    </div>
  );
}

// ── the signal card ──────────────────────────────────────────────────────────
function stepState(dec: MtfDecision, ids: string[]): "pass" | "fail" | "na" {
  const cs = dec.checks.filter(c => ids.includes(c.id) && c.ok !== null);
  if (!cs.length) return "na";
  return cs.every(c => c.ok) ? "pass" : "fail";
}
export function SignalCard({ compact = false }: { compact?: boolean }) {
  const { data, loading, minAgree, updated } = useMtf();
  const dec = data?.decision;
  if (!dec) return <div style={card}><div style={cardHead}>Signal</div><div style={{ color: "var(--text-dim)", fontSize: 12 }}>{loading ? "Reading the market…" : "No analysis yet."}</div></div>;
  const meta = STATE_META[dec.state];
  const col = dec.type === "BUY" ? UP : dec.type === "SELL" ? DOWN : meta.color;
  const steps: [string, string[]][] = [
    [`${dec.bias_tf.toUpperCase()} direction`, ["bias"]], [`${dec.setup_tf.toUpperCase()} setup`, ["align", "zone"]],
    [`${dec.entry_tf.toUpperCase()} trigger`, ["trigger"]], ["Trade plan", ["plan"]],
  ];
  let currentSet = false;
  const session = activeSession();
  const lastClosed = data ? new Date(((dec.time ?? 0) * 1000)) : null;
  const t = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "–");
  return (
    <div style={card}>
      <div style={{ ...cardHead, display: "flex", justifyContent: "space-between" }}>
        <span>Signal · {dec.label}</span>
        <span>{session ? <Pill color={BLUE}>{session}</Pill> : <Pill color={MUTED}>Off-hours</Pill>}</span>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Ring pct={dec.agreement} color={col} />
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: col, lineHeight: 1 }}>{dec.type === "HOLD" ? "WAIT" : dec.type}</div>
          <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill color={meta.color}>{meta.label}</Pill><Pill color="#8aa4c8">GRADE {dec.grade}</Pill>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5 }}>{dec.watch}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, margin: "12px 0" }}>
        {steps.map(([label, ids]) => {
          const st = stepState(dec, ids);
          const current = st === "fail" && !currentSet; if (current) currentSet = true;
          const c = st === "pass" ? UP : current ? WARN : "var(--text-mute)";
          return (
            <div key={label} style={{ border: `1px solid ${st === "pass" ? "#00d08455" : current ? "#ffd70088" : "var(--border2)"}`, background: st === "pass" ? "#00d08414" : "transparent", borderRadius: 8, padding: "6px 4px", textAlign: "center", fontSize: 9, fontWeight: 700, color: c, lineHeight: 1.3 }}>
              {st === "pass" ? "✓" : current ? "●" : "○"}<br />{label}
            </div>
          );
        })}
      </div>
      <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={{ color: "var(--text-dim)", padding: "3px 0" }}>{dec.bias_tf.toUpperCase()} bias</td><td style={{ textAlign: "right", fontWeight: 700, color: biasColor(dec.direction) }}>{dec.direction === "neutral" ? "Neutral" : dec.direction === "bullish" ? "Bullish" : "Bearish"}</td></tr>
          {data && Object.values(data.styles).map(s => (
            <tr key={s.style}><td style={{ color: "var(--text-dim)", padding: "3px 0" }}>{s.label} agreement</td><td style={{ textAlign: "right", fontWeight: 700 }}>{s.agreement}% <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(min {minAgree}%)</span></td></tr>
          ))}
          <tr><td style={{ color: "var(--text-dim)", padding: "3px 0" }}>Price</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtPrice(data!.price)}</td></tr>
        </tbody>
      </table>
      {dec.plan && !compact && (
        <table style={{ width: "100%", marginTop: 8, fontSize: 11.5, borderCollapse: "collapse", borderTop: "1px solid var(--border)" }}>
          <tbody>
            {([["Entry", fmtPrice(dec.plan.entry), BLUE], ["Stop loss", fmtPrice(dec.plan.sl), DOWN], ["Take profit", fmtPrice(dec.plan.tp), UP],
              ["Reward : risk", `${dec.plan.rr} : 1`, "var(--text)"], ["Risk to stop", `${dec.plan.risk_pct.toFixed(2)}%`, "var(--text)"],
              ["Limit entry idea", fmtPrice(dec.plan.ideal_entry), "var(--text-dim)"]] as [string, string, string][]).map(([k, v, c]) => (
              <tr key={k}><td style={{ padding: "3px 0", color: "var(--text-dim)" }}>{k}</td><td style={{ textAlign: "right", fontWeight: 700, color: c }}>{v}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {dec.type === "SELL" && <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-dim)" }}>SELL = bearish setup: short it on a futures account, or simply avoid buying.</div>}
      <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginTop: 10 }}>
        Checked {t(new Date(updated * 1000))} · last closed {dec.entry_tf} candle {t(lastClosed)}{data?.demo ? " · DEMO DATA" : ""}
      </div>
    </div>
  );
}

// ── checklist ────────────────────────────────────────────────────────────────
const STEP_NAMES: Record<number, string> = { 1: "1 · Direction", 2: "2 · Map", 3: "3 · Setup", 4: "4 · Trigger & plan" };
export function Checklist() {
  const { data } = useMtf();
  const dec = data?.decision;
  if (!dec) return null;
  const groups: Record<number, typeof dec.checks> = {};
  dec.checks.forEach(c => { (groups[c.step] = groups[c.step] || []).push(c); });
  return (
    <div style={card}>
      <div style={cardHead}>Checklist — why {dec.type === "HOLD" ? "no signal yet" : dec.type}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 14 }}>
        {[1, 2, 3, 4].filter(s => groups[s]).map(s => (
          <div key={s}>
            <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 5, letterSpacing: 1 }}>{STEP_NAMES[s]}</div>
            {groups[s].map(c => (
              <div key={c.id} style={{ display: "flex", gap: 7, fontSize: 11, padding: "3px 0", alignItems: "flex-start" }}>
                <span style={{ width: 14, fontWeight: 800, color: c.ok === null ? "var(--text-mute)" : c.ok ? UP : DOWN }}>{c.ok === null ? "–" : c.ok ? "✓" : "✗"}</span>
                <span style={{ flex: 1 }}>
                  <b>{c.label}</b>{c.gate && <span style={{ color: WARN, fontSize: 8, marginLeft: 5, fontWeight: 800 }}>MUST</span>}
                  <div style={{ color: "var(--text-dim)", fontSize: 10 }}>{c.detail}</div>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TfSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={field} aria-label="timeframe">
      {options.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
    </select>
  );
}
