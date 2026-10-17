// pages/AnalysisPage.tsx — the top-down SMC dashboard.
// 4H bias → 1H setup → entry-TF trigger (plus a scalp style), 1/2/3 linked charts,
// every concept drawn, the checklist behind the decision, a scanner for all pairs,
// stored-signal history, a backtest and the candle-store status — in one place.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "./shared";
import { mtfApi } from "../api/client";
import MtfChart, { fmtPrice } from "../components/MtfChart";
import { ALL_TFS, ENTRY_TFS, LAYERS } from "../types/mtf";
import type {
  LayerKey, MtfBacktest, MtfMode, MtfPanel, MtfResponse, MtfSignalRow, MtfSignalStats, ScannerRow, SetupState, StoreSeries,
} from "../types/mtf";
import { PAIR_DISPLAY } from "../types";

const card: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 15px" };
const head: React.CSSProperties = { color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" };
const sel: React.CSSProperties = { background: "var(--bg2)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: "inherit" };
const UP = "#00d084", DOWN = "#ff4757", WARN = "#ffd700", BLUE = "#0094ff";

const STATE_META: Record<SetupState, { label: string; color: string }> = {
  SIGNAL: { label: "SIGNAL", color: UP },
  SETUP: { label: "SETUP · waiting trigger", color: WARN },
  WATCH: { label: "WATCH · wait for pullback", color: BLUE },
  STAND_ASIDE: { label: "STAND ASIDE", color: "#6f86a8" },
};
const STEP_NAMES: Record<number, string> = { 1: "1 · Direction (bias)", 2: "2 · Map", 3: "3 · Setup", 4: "4 · Trigger & plan" };

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  ob: true, fvg: true, sd: true, poi: true, bos: true, choch: true, swings: true, eq: true, sweep: true, retest: true, trend: true, pd: false, plan: true, volume: false,
};

function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? { ...(typeof init === "object" ? init : {}), ...JSON.parse(s) } as T : init; } catch { return init; }
  });
  const set = (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* storage unavailable */ } };
  return [v, set];
}

const ago = (sec: number) => { const d = Math.max(0, Math.round(Date.now() / 1000 - sec)); return d < 90 ? `${d}s ago` : d < 5400 ? `${Math.round(d / 60)}m ago` : d < 172800 ? `${Math.round(d / 3600)}h ago` : `${Math.round(d / 86400)}d ago`; };

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color, background: `${color}1c`, border: `1px solid ${color}44`, whiteSpace: "nowrap" }}>{children}</span>;
}
const biasColor = (b: string) => (b === "bullish" ? UP : b === "bearish" ? DOWN : "#6f86a8");

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" role="img" aria-label={`agreement ${pct}%`}>
      <circle cx={38} cy={38} r={r} fill="none" stroke="var(--border2)" strokeWidth={7} />
      <circle cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`} transform="rotate(-90 38 38)" />
      <text x={38} y={42} textAnchor="middle" fontSize={15} fontWeight={800} fill="var(--text)">{Math.round(pct)}%</text>
    </svg>
  );
}

function EquityLine({ pts }: { pts: { time: number; r: number }[] }) {
  if (pts.length < 2) return <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Not enough trades for a curve.</div>;
  const w = 300, h = 70;
  const ys = pts.map(p => p.r), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys) || 1;
  const X = (i: number) => (i / (pts.length - 1)) * w;
  const Y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ maxWidth: 420 }}>
      <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--border2)" strokeDasharray="3 3" />
      <polyline fill="none" stroke={ys[ys.length - 1] >= 0 ? UP : DOWN} strokeWidth={1.8} points={pts.map((p, i) => `${X(i)},${Y(p.r)}`).join(" ")} />
    </svg>
  );
}

export default function AnalysisPage({ notify }: PageProps) {
  const [symbol, setSymbol] = useStored<string>("mtf_symbol", "BTCUSDT");
  const [layout, setLayout] = useStored<number>("mtf_layout", 3);
  const [mode, setMode] = useStored<MtfMode>("mtf_mode", "combined");
  const [entryTf, setEntryTf] = useStored<string>("mtf_entry", "15m");
  const [minAgree, setMinAgree] = useStored<number>("mtf_min", 70);
  const [tfA, setTfA] = useStored<string>("mtf_tfa", "4h");
  const [tfB, setTfB] = useStored<string>("mtf_tfb", "1h");
  const [tfSingle, setTfSingle] = useStored<string>("mtf_tf1", "15m");
  const [layers, setLayers] = useStored<Record<LayerKey, boolean>>("mtf_layers_v1", DEFAULT_LAYERS);
  const [auto, setAuto] = useState(true);

  const [data, setData] = useState<MtfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(0);
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [sigs, setSigs] = useState<{ signals: MtfSignalRow[]; stats: MtfSignalStats } | null>(null);
  const [store, setStore] = useState<{ series: StoreSeries[]; total_candles: number } | null>(null);
  const [bt, setBt] = useState<MtfBacktest | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [btStyle, setBtStyle] = useState("intraday");
  const [btBars, setBtBars] = useState(1500);
  const [syncing, setSyncing] = useState(false);
  const knownSig = useRef<number | null>(null);

  // the panels on screen, in order; the LAST one is the entry panel
  const panelTfs = useMemo(
    () => (layout === 1 ? [tfSingle] : layout === 2 ? [tfA, entryTf] : [tfA, tfB, entryTf]),
    [layout, tfA, tfB, tfSingle, entryTf],
  );
  const tfKey = panelTfs.join(",");

  // ── analysis polling: one in-flight request, stale answers are dropped ─────
  const reqId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async (showSpinner: boolean) => {
    const id = ++reqId.current;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    if (showSpinner) setLoading(true);
    try {
      const r = await mtfApi.analysis(symbol, { mode, entryTf, minAgree, tfs: tfKey.split(",") }, ac.signal);
      if (id !== reqId.current) return;
      if (!r.ok) { setError(r.error || "No data"); setData(null); }
      else { setData(r); setError(null); setUpdated(Date.now() / 1000); }
    } catch (e: any) {
      if (id !== reqId.current || e?.name === "AbortError") return;
      setError(e?.message || "Request failed");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [symbol, mode, entryTf, minAgree, tfKey]);

  useEffect(() => { setData(null); }, [symbol]);
  useEffect(() => {
    load(true);
    if (!auto) return;
    const ms = ["1m", "3m", "5m"].includes(entryTf) ? 8000 : 15000;
    const t = setInterval(() => load(false), ms);
    return () => { clearInterval(t); abort.current?.abort(); };
  }, [load, auto, entryTf]);

  // scanner / history / store
  useEffect(() => {
    let live = true;
    const run = async () => {
      try { const o = await mtfApi.overview({ mode, entryTf, minAgree }); if (live) setRows(o.rows); } catch { /* keep last */ }
    };
    run();
    const t = setInterval(run, 30000);
    return () => { live = false; clearInterval(t); };
  }, [mode, entryTf, minAgree]);

  useEffect(() => {
    let live = true;
    const run = async () => {
      try {
        const s = await mtfApi.signals(60);
        if (!live) return;
        const top = s.signals[0]?.id ?? 0;
        if (knownSig.current !== null && top > knownSig.current) {
          const n = s.signals[0];
          notify(`${n.side} ${n.symbol} (${n.style}, ${n.agreement}%) — entry ${fmtPrice(n.entry)}`, "info");
        }
        knownSig.current = Math.max(top, knownSig.current ?? 0);
        setSigs(s);
      } catch { /* keep last */ }
      try { const st = await mtfApi.store(); if (live) setStore(st); } catch { /* ignore */ }
    };
    run();
    const t = setInterval(run, 25000);
    return () => { live = false; clearInterval(t); };
  }, [notify]);

  const dec = data?.decision ?? null;
  const meta = dec ? STATE_META[dec.state] : null;
  const typeColor = dec?.type === "BUY" ? UP : dec?.type === "SELL" ? DOWN : meta?.color ?? "#6f86a8";

  // chip counts across the panels on screen
  const counts = useMemo(() => {
    const c: Record<LayerKey, number> = { ob: 0, fvg: 0, sd: 0, poi: 0, bos: 0, choch: 0, swings: 0, eq: 0, sweep: 0, retest: 0, trend: 0, pd: 0, plan: 0, volume: 0 };
    (data?.panels ?? []).forEach((p: MtfPanel) => {
      c.ob += p.orderBlocks.filter(b => !b.mitigated).length;
      c.fvg += p.fvgs.filter(g => !g.filled).length;
      c.sd += p.sdZones.length;
      c.poi += p.poi.length;
      c.bos += p.breaks.events.filter(e => e.kind === "BOS").length;
      c.choch += p.breaks.events.filter(e => e.kind === "CHoCH").length;
      c.swings += p.structure.swings.filter(s => s.label).length;
      c.eq += p.eq.length;
      c.sweep += p.sweeps.length;
      c.retest += p.retests.length;
      c.trend += p.trendlines.length;
      c.pd += p.pd ? 1 : 0;
    });
    c.plan = dec?.plan ? 1 : 0;
    return c;
  }, [data, dec]);

  const tfSelect = (value: string, onChange: (v: string) => void, opts: readonly string[]) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={sel} aria-label="timeframe">
      {opts.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
    </select>
  );

  const roleOf = (i: number, total: number) => (i === total - 1 ? "ENTRY" : total === 3 && i === 1 ? "SETUP" : "BIAS");
  const renderPanel = (tf: string, i: number) => {
    const p = data?.panels.find(x => x.tf === tf) ?? data?.panels[i];
    const total = panelTfs.length;
    const isEntry = i === total - 1;
    const role = total === 1 ? "VIEW" : roleOf(i, total);
    let head: React.ReactNode;
    if (total === 1) head = tfSelect(tfSingle, v => { setTfSingle(v); if ((ENTRY_TFS as readonly string[]).includes(v)) setEntryTf(v); }, ALL_TFS);
    else if (isEntry) head = tfSelect(entryTf, setEntryTf, ENTRY_TFS);
    else if (i === 0) head = tfSelect(tfA, setTfA, ALL_TFS);
    else head = tfSelect(tfB, setTfB, ALL_TFS);
    if (!p) return <div key={`${tf}${i}`} style={{ ...card, height: 420, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>{loading ? "Loading candles…" : "No data"}</div>;
    return (
      <MtfChart
        key={`${symbol}-${p.tf}-${i}`} panel={p} layers={layers}
        plan={dec?.plan ?? null} planTime={dec?.time}
        title={`${role} · ${p.tf.toUpperCase()}`}
        subtitle={`${p.bias} · ${p.structure.trend}`}
        height={layout === 3 && isEntry ? 440 : 380}
        headerRight={head}
      />
    );
  };

  const grid: React.CSSProperties =
    layout === 1 ? { display: "grid", gridTemplateColumns: "1fr", gap: 12 }
    : { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 12 };

  const runBt = async () => {
    setBtBusy(true);
    try { setBt(await mtfApi.backtest(symbol, { style: btStyle, entryTf: btStyle === "scalp" && !["1m", "3m", "5m"].includes(entryTf) ? "5m" : entryTf, bars: btBars, minAgree, longOnly: false })); }
    catch (e: any) { notify(e.message || "Backtest failed", "error"); }
    setBtBusy(false);
  };
  const doSync = async () => {
    setSyncing(true);
    try { const r = await mtfApi.sync(symbol); notify(`Stored ${Object.values(r.synced).reduce((a, b) => a + b, 0)} candles for ${symbol}`, "success"); setStore(await mtfApi.store()); }
    catch (e: any) { notify(e.message || "Sync failed", "error"); }
    setSyncing(false);
  };

  const pairs = useMemo(() => Object.keys(PAIR_DISPLAY), []);
  const grouped = useMemo(() => {
    const g: Record<number, typeof dec extends null ? never : NonNullable<typeof dec>["checks"]> = {};
    (dec?.checks ?? []).forEach(c => { (g[c.step] = g[c.step] || []).push(c); });
    return g;
  }, [dec]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* banners */}
      {data?.demo && <div style={{ background: "#ffd70018", border: "1px solid #ffd70055", color: WARN, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>DEMO DATA — the backend is running with CRYPTO_DEMO=1 because Binance is unreachable. Never trade off this.</div>}
      {data && data.staleMinutes > 5 && !data.demo && <div style={{ background: "#ff475718", border: "1px solid #ff475755", color: DOWN, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>Data is {Math.round(data.staleMinutes)} min old — the exchange feed is lagging or unreachable; showing the last stored candles.</div>}
      {error && <div style={{ background: "#ff475718", border: "1px solid #ff475755", color: DOWN, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>{error}</div>}

      {/* controls */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label style={{ fontSize: 10, color: "var(--text-dim)" }}>PAIR{" "}
          <select value={symbol} onChange={e => setSymbol(e.target.value)} style={sel}>
            {pairs.map(p => <option key={p} value={p}>{PAIR_DISPLAY[p]}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>CHARTS{" "}
          {[1, 2, 3].map(n => <button key={n} onClick={() => setLayout(n)} style={{ ...sel, cursor: "pointer", marginLeft: 3, background: layout === n ? "#00d08422" : sel.background, color: layout === n ? UP : "var(--text)", borderColor: layout === n ? "#00d08488" : "var(--border2)" }}>{n}</button>)}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>STYLE{" "}
          {(["combined", "intraday", "scalp"] as MtfMode[]).map(m => <button key={m} onClick={() => setMode(m)} style={{ ...sel, cursor: "pointer", marginLeft: 3, background: mode === m ? "#00d08422" : sel.background, color: mode === m ? UP : "var(--text)", borderColor: mode === m ? "#00d08488" : "var(--border2)" }}>{m}</button>)}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>ENTRY TF{" "}
          {ENTRY_TFS.map(t => <button key={t} onClick={() => { setEntryTf(t); if (layout === 1) setTfSingle(t); }} style={{ ...sel, cursor: "pointer", marginLeft: 3, background: entryTf === t ? "#0094ff22" : sel.background, color: entryTf === t ? BLUE : "var(--text)", borderColor: entryTf === t ? "#0094ff88" : "var(--border2)" }}>{t.toUpperCase()}</button>)}
        </span>
        <label style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>MIN AGREEMENT
          <input type="range" min={50} max={95} step={5} value={minAgree} onChange={e => setMinAgree(+e.target.value)} />
          <b style={{ color: "var(--text)" }}>{minAgree}%</b>
        </label>
        <label style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> live
        </label>
        <button style={{ ...sel, cursor: "pointer" }} onClick={() => load(true)}>↻ refresh</button>
        <span style={{ fontSize: 10, color: "var(--text-mute)" }}>{loading ? "loading…" : updated ? `updated ${ago(updated)}` : ""}</span>
      </div>

      {/* concept toggles */}
      <div style={{ ...card, padding: "9px 12px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 9, letterSpacing: 2, color: "var(--text-mute)", fontWeight: 700, marginRight: 4 }}>CONCEPTS</span>
          {LAYERS.map(l => (
            <button key={l.key} title={l.hint} onClick={() => setLayers({ ...layers, [l.key]: !layers[l.key] })}
              style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, border: `1px solid ${layers[l.key] ? l.color : "var(--border2)"}`, background: layers[l.key] ? `${l.color}22` : "transparent", color: layers[l.key] ? l.color : "var(--text-mute)" }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: l.color, marginRight: 5, opacity: layers[l.key] ? 1 : 0.4 }} />
              {l.label}{counts[l.key] ? <span style={{ opacity: 0.8 }}> {counts[l.key]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* charts + decision */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 12, alignItems: "start" }}>
        <div style={{ gridColumn: "span 2", minWidth: 0 }}>
          <div style={grid}>
            {panelTfs.map((tf, i) => (
              <div key={`${i}`} style={{ minWidth: 0, gridColumn: layout === 3 && i === 2 ? "1 / -1" : undefined }}>{renderPanel(tf, i)}</div>
            ))}
          </div>
        </div>

        <div style={{ ...card, minWidth: 0 }}>
          <div style={head}>Decision · {dec ? `${dec.label} ${dec.bias_tf.toUpperCase()} → ${dec.setup_tf.toUpperCase()} → ${dec.entry_tf.toUpperCase()}` : "…"}</div>
          {!dec ? <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{loading ? "Reading the market…" : "No analysis yet."}</div> : (
            <>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <Ring pct={dec.agreement} color={typeColor} />
                <div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: typeColor, lineHeight: 1 }}>{dec.type === "HOLD" ? "WAIT" : dec.type}</div>
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {meta && <Pill color={meta.color}>{meta.label}</Pill>}
                    <Pill color={biasColor(dec.direction)}>{dec.bias_tf.toUpperCase()} {dec.direction}</Pill>
                    <Pill color="#8aa4c8">GRADE {dec.grade}</Pill>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>{dec.watch}</div>
              {dec.plan && (
                <table style={{ width: "100%", marginTop: 10, fontSize: 11, borderCollapse: "collapse" }}>
                  <tbody>
                    {([
                      ["Entry (market)", fmtPrice(dec.plan.entry), BLUE], ["Ideal limit (zone mid)", fmtPrice(dec.plan.ideal_entry), "var(--text-dim)"],
                      ["Stop loss", fmtPrice(dec.plan.sl), DOWN], ["Take profit", fmtPrice(dec.plan.tp), UP],
                      ["Reward : risk", `${dec.plan.rr} : 1`, "var(--text)"], ["Risk", `${dec.plan.risk_pct.toFixed(2)}%`, "var(--text)"],
                      ...(dec.plan.target_liquidity ? [["Next liquidity", `${dec.plan.target_liquidity.label} ${fmtPrice(dec.plan.target_liquidity.price)}${dec.plan.target_liquidity.rr ? ` (${dec.plan.target_liquidity.rr.toFixed(1)}R)` : ""}`, "var(--text-dim)"]] : []),
                    ] as [string, string, string][]).map(([k, v, c]) => (
                      <tr key={k}><td style={{ padding: "3px 0", color: "var(--text-dim)" }}>{k}</td><td style={{ padding: "3px 0", textAlign: "right", fontWeight: 700, color: c }}>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {dec.type === "SELL" && <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-dim)" }}>Spot bots are long-only: a SELL setup is shown for analysis and alerts but a bot will not open it.</div>}

              <div style={{ ...head, marginTop: 14 }}>Bias by style</div>
              {data && Object.values(data.styles).map(s => (
                <div key={s.style} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, padding: "3px 0" }}>
                  <span style={{ color: "var(--text-dim)" }}>{s.label} {s.bias_tf.toUpperCase()}→{s.setup_tf.toUpperCase()}→{s.entry_tf.toUpperCase()}</span>
                  <span style={{ display: "flex", gap: 5 }}><Pill color={biasColor(s.direction)}>{s.direction}</Pill><Pill color={STATE_META[s.state].color}>{s.agreement}% {s.state.replace("_", " ")}</Pill></span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* checklist */}
      {dec && (
        <div style={card}>
          <div style={head}>Checklist — why {dec.type === "HOLD" ? "no trade yet" : dec.type}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 14 }}>
            {[1, 2, 3, 4].filter(s => grouped[s]).map(s => (
              <div key={s}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text)", marginBottom: 5, letterSpacing: 1 }}>{STEP_NAMES[s]}</div>
                {grouped[s].map(c => (
                  <div key={c.id} style={{ display: "flex", gap: 7, fontSize: 11, padding: "3px 0", alignItems: "flex-start" }}>
                    <span style={{ width: 14, fontWeight: 800, color: c.ok === null ? "var(--text-mute)" : c.ok ? UP : DOWN }}>{c.ok === null ? "–" : c.ok ? "✓" : "✗"}</span>
                    <span style={{ flex: 1 }}>
                      <b style={{ color: "var(--text)" }}>{c.label}</b>{c.gate && <span style={{ color: WARN, fontSize: 8, marginLeft: 5, fontWeight: 800 }}>GATE</span>}
                      <span style={{ color: "var(--text-mute)", fontSize: 9, marginLeft: 5 }}>w{c.weight}</span>
                      <div style={{ color: "var(--text-dim)", fontSize: 10 }}>{c.detail}</div>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* scanner */}
      <div style={card}>
        <div style={head}>Market scanner — all pairs, same settings</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr style={{ color: "var(--text-mute)", textAlign: "left", fontSize: 9, letterSpacing: 1 }}>
              <th style={{ padding: "4px 6px" }}>PAIR</th><th>PRICE</th><th>BIAS</th><th>STATE</th><th>AGREE</th><th>WHAT TO EXPECT</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.symbol} onClick={() => setSymbol(r.symbol)} style={{ cursor: "pointer", background: r.symbol === symbol ? "var(--surface)" : undefined, borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px", fontWeight: 700 }}>{PAIR_DISPLAY[r.symbol] || r.symbol}</td>
                  <td>{r.price != null ? fmtPrice(r.price) : "–"}{r.changePct != null && <span style={{ color: r.changePct >= 0 ? UP : DOWN, marginLeft: 5, fontSize: 9 }}>{r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(1)}%</span>}</td>
                  <td><Pill color={biasColor(r.direction)}>{r.direction}</Pill></td>
                  <td><Pill color={r.type === "BUY" ? UP : r.type === "SELL" ? DOWN : STATE_META[r.state].color}>{r.type !== "HOLD" ? r.type : r.state.replace("_", " ")}</Pill></td>
                  <td style={{ fontWeight: 700 }}>{r.agreement}% <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>{r.grade}</span></td>
                  <td style={{ color: "var(--text-dim)", maxWidth: 420, fontSize: 10 }}>{r.watch}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} style={{ padding: 12, color: "var(--text-dim)" }}>Scanning…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 12 }}>
        {/* history */}
        <div style={card}>
          <div style={head}>Signal history (stored)</div>
          {sigs && (
            <div style={{ display: "flex", gap: 14, fontSize: 11, marginBottom: 8, flexWrap: "wrap" }}>
              <span>Total <b>{sigs.stats.total}</b></span><span>Open <b>{sigs.stats.open}</b></span>
              <span style={{ color: UP }}>Wins <b>{sigs.stats.wins}</b></span><span style={{ color: DOWN }}>Losses <b>{sigs.stats.losses}</b></span>
              <span>Win rate <b>{sigs.stats.win_rate ?? "–"}{sigs.stats.win_rate != null ? "%" : ""}</b></span>
              <span>Net <b style={{ color: sigs.stats.net_r >= 0 ? UP : DOWN }}>{sigs.stats.net_r >= 0 ? "+" : ""}{sigs.stats.net_r}R</b></span>
            </div>
          )}
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {(sigs?.signals ?? []).map(s => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, padding: "5px 0", borderTop: "1px solid var(--border)" }}>
                <span><b style={{ color: s.side === "BUY" ? UP : DOWN }}>{s.side}</b> {PAIR_DISPLAY[s.symbol] || s.symbol} <span style={{ color: "var(--text-mute)" }}>{s.style} {s.entry_tf} · {s.zone}</span></span>
                <span style={{ whiteSpace: "nowrap" }}>@{fmtPrice(s.entry)} <Pill color={s.status === "WIN" ? UP : s.status === "LOSS" ? DOWN : s.status === "OPEN" ? BLUE : "#6f86a8"}>{s.status}{s.r_result != null && s.status !== "OPEN" ? ` ${s.r_result > 0 ? "+" : ""}${s.r_result}R` : ""}</Pill> <span style={{ color: "var(--text-mute)" }}>{ago(s.created_at)}</span></span>
              </div>
            ))}
            {sigs && !sigs.signals.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>No signal has fired yet — the scanner checks every pair each minute.</div>}
          </div>
        </div>

        {/* backtest */}
        <div style={card}>
          <div style={head}>Backtest — replay the engine on history</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            <select value={btStyle} onChange={e => setBtStyle(e.target.value)} style={sel}><option value="intraday">intraday 4H→1H→entry</option><option value="scalp">scalp 1H→15M→entry</option></select>
            <select value={btBars} onChange={e => setBtBars(+e.target.value)} style={sel}>{[800, 1500, 3000].map(b => <option key={b} value={b}>{b} entry bars</option>)}</select>
            <button style={{ ...sel, cursor: "pointer", color: UP, borderColor: "#00d08488" }} disabled={btBusy} onClick={runBt}>{btBusy ? "Running…" : `Run on ${PAIR_DISPLAY[symbol] || symbol}`}</button>
          </div>
          {bt && (
            <>
              <div style={{ display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
                <span>Trades <b>{bt.trades}</b></span><span>Win rate <b>{bt.win_rate}%</b></span>
                <span>Net <b style={{ color: bt.net_r >= 0 ? UP : DOWN }}>{bt.net_r}R</b></span><span>Avg <b>{bt.avg_r}R</b></span>
                <span>PF <b>{bt.profit_factor ?? "–"}</b></span><span>Max DD <b>{bt.max_drawdown_r}R</b></span>
              </div>
              <div style={{ margin: "8px 0" }}><EquityLine pts={bt.equity} /></div>
              <div style={{ fontSize: 9.5, color: "var(--text-mute)" }}>{bt.note} Past results do not predict future ones.{bt.demo ? " DEMO DATA." : ""}</div>
            </>
          )}
        </div>

        {/* store */}
        <div style={card}>
          <div style={head}>Candle database</div>
          <div style={{ fontSize: 11, marginBottom: 8 }}>{store ? <><b>{store.total_candles.toLocaleString()}</b> candles stored across <b>{store.series.length}</b> series.</> : "…"} Every candle the app reads is saved, so charts and scans keep working if the exchange drops out.</div>
          <button style={{ ...sel, cursor: "pointer", color: BLUE, borderColor: "#0094ff88" }} disabled={syncing} onClick={doSync}>{syncing ? "Downloading…" : `Back-fill ${PAIR_DISPLAY[symbol] || symbol} (4H 1H 15M 5M)`}</button>
          <div style={{ maxHeight: 150, overflowY: "auto", marginTop: 8, fontSize: 10, color: "var(--text-dim)" }}>
            {(store?.series ?? []).filter(s => s.symbol === symbol).map(s => <div key={s.interval}>{s.interval.toUpperCase()}: {s.count} candles, latest {ago(s.last)}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
