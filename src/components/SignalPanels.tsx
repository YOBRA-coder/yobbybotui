// components/SignalPanels.tsx — the cards that make up the signal screens:
// concept toggles, the signal card, sessions, the checklist and the chart-panel factory.
import { useEffect, useMemo, useRef, useState } from "react";
import { PAIR_DISPLAY } from "../types";
import MtfChart, { fmtPrice } from "./MtfChart";
import { useMtf } from "../context/MtfContext";
import { ALL_TFS, LAYERS } from "../types/mtf";
import { useAuth } from "../context/AuthContext";
import { mtfApi } from "../api/client";
import { ActivityFeed, NewsList, PlanPreview } from "./Feeds";
import { OutlookCard } from "./Outlook";
import { SENS_AGREE, SENS_HINT } from "../types/mtf";
import type { LayerKey, MtfDecision, MtfPanel, Sens } from "../types/mtf";
import type { ChartMark } from "./MtfChart";
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
      c.amd += p.amd && (p.amd.asia || p.amd.pdh != null) ? 1 : 0; c.ote += p.ote ? 1 : 0; c.brk += (p.breakers ?? []).length;
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
type SideTab = "log" | "news" | "levels" | "signals" | "vote";
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
    (panel.breakers ?? []).forEach(k => z.push({ label: `${k.kind} breaker`, top: k.top, bottom: k.bottom, color: "#9fb3d1" }));
    if (panel.ote) z.push({ label: `OTE ${panel.ote.dir} 62–79%`, top: panel.ote.top, bottom: panel.ote.bottom, color: "#f5c542" });
    const am = panel.amd;
    if (am) ([["Asia high", am.asia?.high], ["Asia low", am.asia?.low], ["Prev-day high", am.pdh], ["Prev-day low", am.pdl], ["Prev-week high", am.pwh], ["Prev-week low", am.pwl], ["Day open", am.day_open]] as [string, number | null | undefined][])
      .forEach(([l, v]) => { if (v != null) z.push({ label: l, top: v, bottom: v, color: "#e0b050" }); });
    panel.eq.forEach(e => z.push({ label: `${e.kind}${e.swept ? " swept" : " liquidity"}`, top: e.price, bottom: e.price, color: "#ff7bd5" }));
    return z.sort((a, b) => Math.abs((a.top + a.bottom) / 2 - price) - Math.abs((b.top + b.bottom) / 2 - price)).slice(0, 14);
  }, [panel, price]);
  const mine = signals.filter(s => s.symbol === symbol).slice(0, 12);
  const tabBtn = (t: SideTab, label: string) => (
    <button key={t} onClick={() => setTab(t)} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, padding: "8px 2px", background: "transparent", border: "none", borderBottom: `2px solid ${tab === t ? BLUE : "transparent"}`, color: tab === t ? "var(--text)" : "var(--text-dim)" }}>{label}</button>
  );
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface2)", zIndex: 1 }}>
        {tabBtn("log", "LOG")}{tabBtn("news", "NEWS")}{tabBtn("levels", "LEVELS")}{tabBtn("signals", "SIGNALS")}{tabBtn("vote", "VOTE")}
      </div>
      <div style={{ padding: 12 }}>
        {tab === "log" && (
          <>
            {data && <div style={{ marginBottom: 12 }}><div style={cardHead}>What to expect · and when</div><OutlookCard data={data} withPreview={false} /></div>}
            {dec?.plan && (
              <div style={{ marginBottom: 12 }}>
                <div style={cardHead}>Trade preview · {dec.plan.side}{dec.type === "HOLD" ? " (setup, not a signal yet)" : ""}</div>
                <PlanPreview candles={panel.candles} plan={dec.plan} entryTime={dec.time} />
              </div>
            )}
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
        {tab === "vote" && <VoteCard embedded />}
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
  const { layers, data, symbol, loading, history, setHistory, signals, news, entryTf, setExtra } = useMtf();
  const id = useRef("cp" + Math.random().toString(36).slice(2)).current;
  const [full, setFull] = useState(false);
  const [ov, setOv] = useState<string | null>(null);   // full view only: look at another timeframe WITHOUT changing the entry timeframe
  useEffect(() => { setExtra(id, full && ov ? ov : null); return () => setExtra(id, null); }, [full, ov]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!full) setOv(null); }, [full]);
  const marks: ChartMark[] = useMemo(() => signals.filter(x => x.symbol === symbol).map(x => ({
    time: x.bar_time ?? x.created_at, price: x.entry, side: x.side, status: x.status, r: x.r_result,
  })), [signals, symbol]);
  if (!panel) return <div style={{ ...card, height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>{loading ? "Loading candles…" : "No data"}</div>;
  const dec = data?.decision;
  const shown = (full && ov && data?.panels.find(p => p.tf === ov)) || panel;
  const waiting = full && ov && shown.tf !== ov;
  const tfBtn = (t: string) => ({ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 6, border: `1px solid ${t === (ov ?? panel.tf) ? BLUE : "var(--border2)"}`, background: t === (ov ?? panel.tf) ? "#0094ff22" : "transparent", color: t === (ov ?? panel.tf) ? BLUE : "var(--text-dim)" } as const);
  const tools = (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: 1.5 }}>TIMEFRAME</span>
        {ALL_TFS.map(t => <button key={t} style={tfBtn(t)} onClick={() => setOv(t === panel.tf ? null : t)}>{t.toUpperCase()}</button>)}
        <span style={{ fontSize: 9.5, color: "var(--text-mute)" }}>{waiting ? "loading…" : `view only — your entry timeframe stays ${entryTf.toUpperCase()}`}</span>
      </div>
      <ConceptBar panels={[shown]} />
    </>
  );
  return (
    <MtfChart key={symbol} panel={shown} layers={layers} plan={dec?.plan ?? null} planTime={dec?.time}
      title={full && ov ? `${PAIR_DISPLAY[symbol] || symbol} · ${shown.tf.toUpperCase()} (view only)` : title}
      subtitle={`${shown.bias} · ${shown.structure.trend}`} height={height} headerRight={headerRight}
      marks={marks} news={news} fullTools={tools} onExpandChange={setFull}
      side={<FullViewSide panel={shown} />} onNeedMore={v => { if (v > history) setHistory(Math.min(1500, Math.max(300, v))); }} />
  );
}

// ── strategy vote ────────────────────────────────────────────────────────────
export function VoteCard({ embedded = false }: { embedded?: boolean }) {
  const { data, consensus, setConsensus, weighting, setWeighting } = useMtf();
  const v = data?.vote;
  const col = !v ? MUTED : v.direction === "bullish" ? UP : v.direction === "bearish" ? DOWN : WARN;
  const box = embedded ? {} : card;
  return (
    <div style={box}>
      {!embedded && <div style={cardHead}>Strategy vote · SMC + 6 classics</div>}
      {!v && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Waiting for candles…</div>}
      {v && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <b style={{ color: col, fontSize: 15 }}>{v.direction === "mixed" ? "MIXED" : v.direction === "bullish" ? "BUY LEAN" : "SELL LEAN"} {v.score > 0 ? "+" : ""}{Math.round(v.score)}</b>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{v.buy} buy · {v.sell} sell · {v.neutral} neutral</span>
          </div>
          <div style={{ position: "relative", height: 8, background: "var(--border2)", borderRadius: 4, margin: "8px 0 10px" }} aria-label={`vote score ${v.score}`}>
            <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--text-mute)" }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 4, background: col, left: v.score >= 0 ? "50%" : `${50 + v.score / 2}%`, width: `${Math.abs(v.score) / 2}%` }} />
          </div>
          {v.votes.map(r => {
            const best = v.best?.id === r.id;
            const c = r.vote > 0 ? UP : r.vote < 0 ? DOWN : MUTED;
            return (
              <div key={r.id} style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid var(--border)", fontSize: 11, alignItems: "flex-start" }}>
                <span style={{ width: 16, color: c, fontWeight: 800 }}>{r.vote > 0 ? "▲" : r.vote < 0 ? "▼" : "–"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{r.name}</b> <span style={{ color: "var(--text-mute)", fontSize: 9.5 }}>{r.tf.toUpperCase()}</span>{best && <span style={{ color: WARN, marginLeft: 6, fontSize: 9, fontWeight: 800 }}>★ BEST</span>}
                  <div style={{ color: "var(--text-dim)", fontSize: 10 }}>{r.detail}</div>
                  {r.edge && r.edge.n > 0 && <div style={{ color: "var(--text-mute)", fontSize: 9.5 }}>recent: {r.edge.n} signals · {r.edge.win_rate}% won · {r.edge.avg_ret! > 0 ? "+" : ""}{r.edge.avg_ret}% each{r.edge.ok ? "" : " (too few to trust)"}</div>}
                </span>
              </div>
            );
          })}
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
            <label style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={weighting === "best"} onChange={e => setWeighting(e.target.checked ? "best" : "equal")} />
              Use the best strategy {v.best ? <span style={{ color: "var(--text-dim)" }}>(now: {v.best.name}, counts 3×)</span> : <span style={{ color: "var(--text-mute)" }}>(none has a positive record right now)</span>}
            </label>
            <label style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={consensus} onChange={e => setConsensus(e.target.checked)} />
              Hold back SMC signals the vote disagrees with
            </label>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-mute)", marginTop: 8, lineHeight: 1.5 }}>{v.note}</div>
        </>
      )}
    </div>
  );
}

// ── engine bar: sensitivity, style, and which entry timeframe is ready ───────
const SENS_LIST: Sens[] = ["strict", "balanced", "fast"];
export function EngineBar() {
  const { sens, setSens, minAgree, setMinAgree, mode, setMode, entryTf, setEntryTf, entryScan, engine, refreshEngine, refresh, useProfile, setUseProfile, symbol } = useMtf();
  const {auth} = useAuth();
  const prof = engine?.profiles?.[symbol];
  const guardVal = engine?.risk_guard == null ? "auto" : String(engine.risk_guard);
  const setGuard = async (v: string) => {
    if (!auth.token) return;
    try { await mtfApi.saveEngine(auth.token, { risk_guard: v === "auto" ? null : +v }); await refreshEngine(); refresh(); } catch { /* keep */ }
  };
  const seg = (on: boolean, c = BLUE) => ({ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "3px 10px", border: `1px solid ${on ? c : "var(--border2)"}`, background: on ? `${c}22` : "transparent", color: on ? c : "var(--text-dim)" } as const);
  const best = entryScan?.best;
  const bestRow = entryScan?.rows.find(r => r.tf === best);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ display: "inline-flex" }} title="How picky the engine is">
        {SENS_LIST.map((k, i) => (
          <button key={k} title={SENS_HINT[k]} aria-pressed={sens === k} onClick={() => setSens(k)}
            style={{ ...seg(sens === k), borderRadius: i === 0 ? "6px 0 0 6px" : i === 2 ? "0 6px 6px 0" : 0, marginLeft: i ? -1 : 0 }}>{k[0].toUpperCase() + k.slice(1)}</button>
        ))}
      </span>
      <select value={minAgree} onChange={e => setMinAgree(+e.target.value)} style={field} aria-label="minimum agreement" title="Minimum agreement % to fire a signal">
        {Array.from(new Set([50, 55, 60, 65, 70, 75, 80, 85, 90, SENS_AGREE[sens], minAgree])).sort((a, b) => a - b).map(v => <option key={v} value={v}>≥ {v}% agree</option>)}
      </select>
      <select value={guardVal} onChange={e => setGuard(e.target.value)} style={field} aria-label="entry risk guard" disabled={!auth.token}
        title="Safe entry: hold a signal back when the entry looks risky (chasing price, oversized candle, little room, exhausted RSI…). Auto = follows the sensitivity preset.">
        <option value="auto">Safe entry: auto</option><option value="0">Safe entry: off</option><option value="1">Safe entry: block high risk</option><option value="2">Safe entry: block medium+</option>
      </select>
      {prof && (
        <button onClick={() => setUseProfile(!useProfile)} aria-pressed={useProfile} style={{ ...seg(useProfile, "#ffb86b"), borderRadius: 14 }}
          title={`Tuned for ${symbol} by the backtest optimizer${prof.sens ? ` · ${prof.sens}` : ""}${prof.min_agree ? ` · ≥${prof.min_agree}% agree` : ""}${prof.rr_intraday ? ` · ${prof.rr_intraday}R` : ""}. ${useProfile ? "Click to use the general settings instead." : "Click to use the tuned settings."}`}>
          🎯 {useProfile ? "tuned" : "tuned off"}
        </button>
      )}
      <select value={mode} onChange={e => setMode(e.target.value as "intraday" | "scalp" | "combined")} style={field} aria-label="style">
        <option value="combined">Intraday + scalp</option><option value="intraday">Intraday 4H→1H</option><option value="scalp">Scalp 1H→15M</option>
      </select>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }} title="Which entry timeframe has a signal or setup right now">
        <span style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: 1.5 }}>READY</span>
        {(entryScan?.rows ?? []).map(r => {
          const c = r.state === "SIGNAL" ? (r.type === "SELL" ? DOWN : UP) : r.state === "SETUP" ? WARN : r.state === "WATCH" ? BLUE : MUTED;
          return <button key={r.tf} onClick={() => setEntryTf(r.tf)} title={`${r.tf.toUpperCase()}: ${r.state.replace("_", " ")} · ${r.agreement}% · ${r.watch}`} style={{ ...seg(r.tf === entryTf, c), borderRadius: 14, padding: "2px 8px", borderColor: c }}>{r.tf.toUpperCase()} {r.state === "SIGNAL" ? r.type : r.state === "SETUP" ? "setup" : r.state === "WATCH" ? "watch" : "·"}</button>;
        })}
        {best && best !== entryTf && <button onClick={() => setEntryTf(best)} style={{ ...seg(true, UP), borderRadius: 14 }} title={bestRow?.watch}>⚡ switch to {best.toUpperCase()}</button>}
      </span>
    </div>
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
        <EngineBar />
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
  const { data, loading, minAgree: minAgreeG, updated, useProfile } = useMtf();
  const minAgree = useProfile && data?.profile?.min_agree ? data.profile.min_agree : minAgreeG;
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
      {dec.entry_risk && (() => {
        const er = dec.entry_risk, rc = er.level === "LOW" ? UP : er.level === "MEDIUM" ? WARN : DOWN;
        return (
          <div style={{ marginTop: 8, border: `1px solid ${rc}55`, borderRadius: 8, padding: "6px 9px", fontSize: 11, lineHeight: 1.45 }}>
            <span style={{ fontWeight: 800, color: rc, fontSize: 10, letterSpacing: 0.6 }}>ENTRY RISK · {er.level}</span>
            <span style={{ color: "var(--text-mute)", fontSize: 10 }}> (score {er.score})</span>
            <div style={{ color: "var(--text-dim)" }}>{er.reasons.length ? er.reasons.join(" · ") : "Clean entry: close to the zone, normal candle, room to the next level."}</div>
            {er.level !== "LOW" && er.limit_entry != null && <div style={{ color: BLUE }}>Safer: wait for a limit fill near {fmtPrice(er.limit_entry)}{er.limit_rr ? ` (${er.limit_rr}R)` : ""}</div>}
            {data?.profile && useProfile && <div style={{ color: "#ffb86b", fontSize: 10, marginTop: 2 }}>🎯 Using the settings tuned for {data.symbol}</div>}
          </div>
        );
      })()}
      {!compact && data && <OutlookCard data={data} />}
      {!compact && data && (() => {
        const am = data.panels.find(p => p.tf === dec.setup_tf)?.amd;
        if (!am || !am.text) return null;
        const c = am.expected === "bullish" ? UP : am.expected === "bearish" ? DOWN : "var(--text-mute)";
        return (
          <div style={{ marginTop: 8, border: `1px solid ${c === "var(--text-mute)" ? "var(--border2)" : c + "55"}`, borderRadius: 8, padding: "6px 9px", fontSize: 11, lineHeight: 1.45 }}>
            <span style={{ fontWeight: 800, color: c, fontSize: 10, letterSpacing: 0.6 }}>AMD · {am.phase ?? am.clock_phase}</span>
            <div style={{ color: "var(--text-dim)" }}>{am.text}</div>
          </div>
        );
      })()}
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
