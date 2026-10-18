// pages/BacktestPage.tsx — replay the engine on stored history: simple by default, full controls under "Advanced".
import { useEffect, useMemo, useState } from "react";
import { mtfApi } from "../api/client";
import { useMtf } from "../context/MtfContext";
import { PAIRS, PAIR_DISPLAY } from "../types";
import { ENTRY_TFS, SENS_AGREE } from "../types/mtf";
import type { EngineProfile, MtfBacktest, Sens, StoreSeries } from "../types/mtf";
import Optimizer from "../components/Optimizer";
import { BLUE, DOWN, EquityDD, GroupBars, Histogram, UP, WARN, ago, card, cardHead, field } from "../components/ui";

type Notify = (m: string, t?: "success" | "error" | "info") => void;
const GRADES = ["D", "C", "B", "A", "A+"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function num(v: string, d: number) { const f = parseFloat(v); return Number.isFinite(f) ? f : d; }

function toCsv(bt: MtfBacktest): string {
  const head = "side,entry_time_utc,exit_time_utc,entry,sl,tp,exit,result,r,agreement,grade,zone,bars_held";
  const rows = bt.trade_log.map(t => [t.side, new Date(t.entry_time * 1000).toISOString(), new Date(t.exit_time * 1000).toISOString(), t.entry, t.sl, t.tp, t.exit, t.result, t.r, t.agreement, t.grade, `"${t.zone}"`, t.bars_held ?? ""].join(","));
  return [head, ...rows].join("\n");
}

export default function BacktestPage({ notify }: { notify: Notify }) {
  const { symbol, entryTf, minAgree, sens: ctxSens, consensus: ctxConsensus } = useMtf();
  const [adv, setAdv] = useState(false);
  const [style, setStyle] = useState("intraday");
  const [tf, setTf] = useState(entryTf);
  const [bars, setBars] = useState(1500);
  const [sens, setSens] = useState<Sens>(ctxSens);
  const [agree, setAgree] = useState(minAgree);
  const [rr, setRr] = useState("");
  const [slb, setSlb] = useState("");
  const [fee, setFee] = useState("0.1");
  const [slip, setSlip] = useState("0.02");
  const [grade, setGrade] = useState("D");
  const [be, setBe] = useState("0");
  const [hold, setHold] = useState("300");
  const [kz, setKz] = useState(false);
  const [sweep, setSweep] = useState(false);
  const [cons, setCons] = useState(ctxConsensus);
  const [guard, setGuard] = useState("");           // safe-entry level for this run ("" = follow the sensitivity preset)
  const [longOnly, setLongOnly] = useState(false);
  const [capital, setCapital] = useState("10000");
  const [risk, setRisk] = useState("1");
  const [compound, setCompound] = useState(true);
  const [bt, setBt] = useState<MtfBacktest | null>(null);
  const [busy, setBusy] = useState(false);
  const [cmp, setCmp] = useState<{ sens: Sens; bt: MtfBacktest }[] | null>(null);
  const [show, setShow] = useState(40);
  const [store, setStore] = useState<{ series: StoreSeries[]; total_candles: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [depth, setDepth] = useState(5000);
  const [scope, setScope] = useState<"pair" | "all">("pair");
  const [tfSet, setTfSet] = useState<"core" | "all">("core");
  const [progress, setProgress] = useState("");
  useEffect(() => { mtfApi.store().then(setStore).catch(() => undefined); }, []);
  useEffect(() => { setBt(null); setCmp(null); }, [symbol]);

  const opts = (s: Sens) => {
    const tfx = style === "scalp" && !["1m", "3m", "5m"].includes(tf) ? "5m" : tf;
    return {
      style, entryTf: tfx, bars, minAgree: s === sens ? agree : SENS_AGREE[s], longOnly, sens: s,
      ...(adv ? { rr: num(rr, 0), slBuffer: slb === "" ? -1 : num(slb, 0.25), feePct: num(fee, 0.1), slippagePct: num(slip, 0), minGrade: grade, breakevenAtR: num(be, 0),
        maxHold: num(hold, 300), killzoneOnly: kz, gateSweep: sweep, consensus: cons } : {}),
      ...(guard !== "" ? { riskGuard: +guard } : {}),
    };
  };
  const run = async () => {
    setBusy(true); setCmp(null);
    try { setBt(await mtfApi.backtest(symbol, opts(sens))); setShow(40); }
    catch (e: any) { notify(e?.message || "Backtest failed", "error"); } finally { setBusy(false); }
  };
  const compare = async () => {
    setBusy(true);
    try {
      const out: { sens: Sens; bt: MtfBacktest }[] = [];
      for (const s of ["strict", "balanced", "fast"] as Sens[]) out.push({ sens: s, bt: await mtfApi.backtest(symbol, opts(s)) });
      setCmp(out);
    } catch (e: any) { notify(e?.message || "Backtest failed", "error"); } finally { setBusy(false); }
  };
  const sync = async () => {
    setSyncing(true);
    const syms = scope === "all" ? PAIRS : [symbol];
    const tfs = tfSet === "core" ? ["4h", "1h", "15m", "5m"] : ["1d", "4h", "1h", "30m", "15m", "5m", "3m", "1m"];
    const jobs = syms.flatMap(sy => tfs.map(t => [sy, t] as const));
    let done = 0, saved = 0, failed = 0;
    try {
      for (const [sy, t] of jobs) {
        setProgress(`Downloading ${sy} ${t.toUpperCase()} (${done + 1}/${jobs.length})…`);
        try { const r = await mtfApi.sync(sy, t, depth); saved += Object.values(r.synced).reduce((a, b) => a + b, 0); } catch { failed++; }
        done++;
      }
      notify(`Stored ${saved.toLocaleString()} candles${failed ? ` (${failed} downloads failed)` : ""}`, failed ? "info" : "success");
      setStore(await mtfApi.store());
    } finally { setSyncing(false); setProgress(""); }
  };
  const download = () => {
    if (!bt) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(bt)], { type: "text/csv" }));
    a.download = `backtest_${bt.symbol}_${bt.style}_${bt.entry_tf}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  // what the R results mean in money, for a chosen risk per trade
  const sim = useMemo(() => {
    if (!bt) return null;
    const cap0 = Math.max(1, num(capital, 10000)), rp = Math.max(0, num(risk, 1)) / 100;
    let eq = cap0, peak = cap0, dd = 0;
    for (const t of bt.trade_log) {
      eq += compound ? eq * rp * t.r : cap0 * rp * t.r;
      peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak);
    }
    return { end: eq, ret: (eq / cap0 - 1) * 100, dd: dd * 100, n: bt.trade_log.length };
  }, [bt, capital, risk, compound]);

  const L = (t: string, child: React.ReactNode) => <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 9.5, color: "var(--text-mute)", letterSpacing: 0.5 }}>{t}{child}</label>;
  const btn = (c: string) => ({ ...field, cursor: "pointer", color: c, borderColor: `${c}88`, fontWeight: 700 } as const);
  const st = bt?.stats;
  const m = (k: string, v: string, c?: string) => <div key={k}><div style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: 1.2 }}>{k}</div><div style={{ fontSize: 15, fontWeight: 800, color: c }}>{v}</div></div>;
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ ...cardHead, display: "flex", justifyContent: "space-between" }}>
          <span>Backtest · {PAIR_DISPLAY[symbol] || symbol}</span>
          <button style={{ ...field, cursor: "pointer", fontSize: 10, color: adv ? BLUE : "var(--text-dim)" }} aria-pressed={adv} onClick={() => setAdv(!adv)}>{adv ? "▾ Advanced" : "▸ Advanced"}</button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {L("Style", <select value={style} onChange={e => setStyle(e.target.value)} style={field}><option value="intraday">Intraday · 4H → 1H → entry</option><option value="scalp">Scalp · 1H → 15M → entry</option></select>)}
          {L("Entry timeframe", <select value={tf} onChange={e => setTf(e.target.value)} style={field}>{ENTRY_TFS.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}</select>)}
          {L("History", <select value={bars} onChange={e => setBars(+e.target.value)} style={field}>{[800, 1500, 3000, 6000, 10000, 20000].map(b => <option key={b} value={b}>{b.toLocaleString()} entry bars</option>)}</select>)}
          {L("Sensitivity", <select value={sens} onChange={e => { setSens(e.target.value as Sens); setAgree(SENS_AGREE[e.target.value as Sens]); }} style={field}><option value="strict">Strict</option><option value="balanced">Balanced</option><option value="fast">Fast</option></select>)}
          <button style={btn(UP)} disabled={busy} onClick={run}>{busy ? "Running…" : "Run backtest"}</button>
          <button style={btn(BLUE)} disabled={busy} onClick={compare} title="Run Strict, Balanced and Fast with these settings and compare">Compare sensitivities</button>
        </div>
        {adv && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
            {L("Safe entry", <select style={field} value={guard} onChange={e => setGuard(e.target.value)}><option value="">Auto (sensitivity)</option><option value="0">Off</option><option value="1">Block high risk</option><option value="2">Block medium+</option></select>)}
            {L("Min agreement %", <input style={field} inputMode="numeric" value={agree} onChange={e => setAgree(num(e.target.value, 70))} />)}
            {L("Target (R) — blank = default", <input style={field} inputMode="decimal" placeholder="2.0 / 1.5" value={rr} onChange={e => setRr(e.target.value)} />)}
            {L("Stop buffer (× ATR)", <input style={field} inputMode="decimal" placeholder="0.25" value={slb} onChange={e => setSlb(e.target.value)} />)}
            {L("Fee per side (%)", <input style={field} inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} />)}
            {L("Slippage per side (%)", <input style={field} inputMode="decimal" value={slip} onChange={e => setSlip(e.target.value)} />)}
            {L("Minimum grade", <select style={field} value={grade} onChange={e => setGrade(e.target.value)}>{GRADES.map(g => <option key={g}>{g}</option>)}</select>)}
            {L("Stop to breakeven after (R)", <input style={field} inputMode="decimal" value={be} onChange={e => setBe(e.target.value)} />)}
            {L("Max bars in a trade", <input style={field} inputMode="numeric" value={hold} onChange={e => setHold(e.target.value)} />)}
            {L("Account size", <input style={field} inputMode="decimal" value={capital} onChange={e => setCapital(e.target.value)} />)}
            {L("Risk per trade (%)", <input style={field} inputMode="decimal" value={risk} onChange={e => setRisk(e.target.value)} />)}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, justifyContent: "flex-end" }}>
              <label><input type="checkbox" checked={kz} onChange={e => setKz(e.target.checked)} /> Kill zones only</label>
              <label><input type="checkbox" checked={sweep} onChange={e => setSweep(e.target.checked)} /> Require liquidity sweep</label>
              <label><input type="checkbox" checked={cons} onChange={e => setCons(e.target.checked)} /> Strategy vote must agree</label>
              <label><input type="checkbox" checked={longOnly} onChange={e => setLongOnly(e.target.checked)} /> Long only (spot)</label>
              <label><input type="checkbox" checked={compound} onChange={e => setCompound(e.target.checked)} /> Compound the account</label>
            </div>
          </div>
        )}
        {!bt && !cmp && <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 12 }}>Replays the same engine bar by bar on stored candles — higher timeframes only ever use bars that had already closed, the stop is checked before the target on a bar that touches both, and fees are charged on both sides.</div>}
      </div>

      <Optimizer style={style} entryTf={tf} notify={notify} onPreview={(p: EngineProfile) => {
        setAdv(true);
        if (p.sens) setSens(p.sens);
        if (p.min_agree) setAgree(p.min_agree);
        const r = style === "scalp" ? p.rr_scalp : p.rr_intraday;
        setRr(r ? String(r) : "");
        setSlb(p.sl_buffer != null ? String(p.sl_buffer) : "");
        setGuard(p.risk_guard != null ? String(p.risk_guard) : "");
        notify("Form filled with those settings — press Run backtest to see the full report", "info");
      }} />

      {cmp && (
        <div style={card}>
          <div style={cardHead}>Strict vs Balanced vs Fast · same settings otherwise</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: 520 }}>
              <thead><tr style={{ color: "var(--text-mute)", fontSize: 9, letterSpacing: 1.2, textAlign: "right" }}>{["", "TRADES", "WIN %", "NET R", "AVG R", "PF", "MAX DD", ""].map((h, i) => <th key={i} style={{ padding: "4px 8px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {cmp.map(({ sens: k, bt: b }) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "7px 8px", fontWeight: 800 }}>{k[0].toUpperCase() + k.slice(1)}</td>
                    <td style={{ textAlign: "right", padding: "7px 8px" }}>{b.trades}</td><td style={{ textAlign: "right", padding: "7px 8px" }}>{b.win_rate}%</td>
                    <td style={{ textAlign: "right", padding: "7px 8px", color: b.net_r >= 0 ? UP : DOWN, fontWeight: 700 }}>{b.net_r}R</td>
                    <td style={{ textAlign: "right", padding: "7px 8px" }}>{b.avg_r}R</td><td style={{ textAlign: "right", padding: "7px 8px" }}>{b.profit_factor ?? "–"}</td>
                    <td style={{ textAlign: "right", padding: "7px 8px" }}>{b.max_drawdown_r}R</td>
                    <td style={{ textAlign: "right", padding: "7px 8px" }}><button style={{ ...field, cursor: "pointer", fontSize: 10 }} onClick={() => { setBt(b); setCmp(null); }}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 8 }}>Fewer trades with a higher average R is what "quality" looks like; more trades with a lower average is "speed". Small samples (under ~30 trades) are mostly luck.</div>
        </div>
      )}

      {bt && st && (
        <>
          <div style={card}>
            <div style={cardHead}>Results · {bt.trades} trades on {bt.bars.toLocaleString()} {bt.entry_tf.toUpperCase()} bars{bt.from ? ` (${ago(bt.from)} → ${ago(bt.to!)})` : ""}</div>
            {bt.trades < 30 && <div style={{ background: "#ffd70014", border: "1px solid #ffd70055", color: WARN, borderRadius: 8, padding: "6px 10px", fontSize: 10.5, marginBottom: 10 }}>Only {bt.trades} trades — too few to say anything reliable. Use more history or the Fast preset.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 12 }}>
              {m("TRADES", String(bt.trades))}{m("WIN RATE", `${bt.win_rate}%`)}{m("NET", `${bt.net_r > 0 ? "+" : ""}${bt.net_r}R`, bt.net_r >= 0 ? UP : DOWN)}
              {m("EXPECTANCY", `${st.expectancy_r > 0 ? "+" : ""}${st.expectancy_r}R`, st.expectancy_r >= 0 ? UP : DOWN)}{m("PROFIT FACTOR", String(bt.profit_factor ?? "–"))}
              {m("MAX DRAWDOWN", `${bt.max_drawdown_r}R`, DOWN)}{m("AVG WIN", `+${st.avg_win_r}R`, UP)}{m("AVG LOSS", `${st.avg_loss_r}R`, DOWN)}
              {m("BEST / WORST", `${st.best_r} / ${st.worst_r}R`)}{m("STREAKS W / L", `${st.max_win_streak} / ${st.max_loss_streak}`)}{m("AVG HOLD", `${st.avg_bars_held} bars`)}{m("R-SHARPE", String(st.sharpe_r ?? "–"))}
            </div>
            {sim && (
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 11.5 }}>
                With {num(capital, 10000).toLocaleString()} and {num(risk, 1)}% risked per trade{compound ? " (compounding)" : ""}: ends at <b style={{ color: sim.ret >= 0 ? UP : DOWN }}>{sim.end.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({sim.ret > 0 ? "+" : ""}{sim.ret.toFixed(1)}%)</b>, worst drop <b style={{ color: DOWN }}>{sim.dd.toFixed(1)}%</b>
                <span style={{ color: "var(--text-mute)" }}> · over the last {sim.n} trades listed</span>
              </div>
            )}
            <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 8 }}>{bt.note} Past results do not predict future ones.{bt.demo ? " DEMO DATA." : ""}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 14 }}>
            <div style={card}><div style={cardHead}>Equity &amp; drawdown (R)</div><EquityDD eq={bt.equity} dd={st.drawdown} /></div>
            <div style={card}><div style={cardHead}>Distribution of results</div><Histogram bins={st.dist} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 14 }}>
            <div style={card}><GroupBars title="By side" data={st.by_side} /><div style={{ height: 10 }} /><GroupBars title="By grade" data={st.by_grade} order={["A+", "A", "B", "C", "D"]} /></div>
            <div style={card}><GroupBars title="By weekday (UTC)" data={st.by_weekday} order={WD} /><div style={{ height: 10 }} /><GroupBars title="By month" data={st.by_month} /></div>
            <div style={card}><GroupBars title="By hour (UTC)" data={st.by_hour} order={hours} /></div>
          </div>
          <div style={card}>
            <div style={{ ...cardHead, display: "flex", justifyContent: "space-between" }}><span>Trades (newest first)</span><button style={{ ...field, cursor: "pointer", fontSize: 10 }} onClick={download}>⬇ CSV</button></div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 640 }}>
                <thead><tr style={{ color: "var(--text-mute)", fontSize: 9, letterSpacing: 1.2, textAlign: "left" }}>{["SIDE", "ENTERED", "ENTRY", "STOP", "TARGET", "EXIT", "RESULT", "AGREE", "ZONE", "HELD"].map(h => <th key={h} style={{ padding: "4px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {[...bt.trade_log].reverse().slice(0, show).map((t, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "5px 8px", color: t.side === "BUY" ? UP : DOWN, fontWeight: 800 }}>{t.side}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{new Date(t.entry_time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                      <td style={{ padding: "5px 8px" }}>{t.entry.toPrecision(6)}</td><td style={{ padding: "5px 8px", color: DOWN }}>{t.sl.toPrecision(6)}</td><td style={{ padding: "5px 8px", color: UP }}>{t.tp.toPrecision(6)}</td><td style={{ padding: "5px 8px" }}>{t.exit.toPrecision(6)}</td>
                      <td style={{ padding: "5px 8px", fontWeight: 800, color: t.r >= 0 ? UP : DOWN }}>{t.result} {t.r > 0 ? "+" : ""}{t.r}R</td>
                      <td style={{ padding: "5px 8px" }}>{t.agreement}% {t.grade}</td><td style={{ padding: "5px 8px", color: "var(--text-dim)" }}>{t.zone}</td><td style={{ padding: "5px 8px", color: "var(--text-dim)" }}>{t.bars_held ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {show < bt.trade_log.length && <button style={{ ...field, cursor: "pointer", marginTop: 8 }} onClick={() => setShow(show + 60)}>Show more ({bt.trade_log.length - show} left)</button>}
          </div>
        </>
      )}

      <div style={card}>
        <div style={cardHead}>Candle database</div>
        <div style={{ fontSize: 11.5, marginBottom: 10 }}>{store ? <><b>{store.total_candles.toLocaleString()}</b> candles stored across <b>{store.series.length}</b> series.</> : "…"} Every candle the app reads is saved, so charts, scans and backtests keep working if the exchange drops out.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select value={depth} onChange={e => setDepth(+e.target.value)} style={field} aria-label="depth">{[1500, 5000, 20000, 50000].map(d => <option key={d} value={d}>{d.toLocaleString()} candles each</option>)}</select>
          <select value={tfSet} onChange={e => setTfSet(e.target.value as "core" | "all")} style={field} aria-label="timeframes"><option value="core">4H 1H 15M 5M</option><option value="all">All timeframes (1D … 1M)</option></select>
          <select value={scope} onChange={e => setScope(e.target.value as "pair" | "all")} style={field} aria-label="scope"><option value="pair">{PAIR_DISPLAY[symbol] || symbol} only</option><option value="all">All pairs</option></select>
          <button style={btn(BLUE)} disabled={syncing} onClick={sync}>{syncing ? "Downloading…" : "Download & save candles"}</button>
        </div>
        {progress && <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginBottom: 6 }}>{progress}</div>}
        <div style={{ fontSize: 10, color: "var(--text-mute)", marginBottom: 8 }}>Up to 100,000 candles are kept per pair and timeframe. 1m history is large — start with 5,000.</div>
        <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 10.5, color: "var(--text-dim)" }}>
          {(store?.series ?? []).filter(s => s.symbol === symbol).map(s => <div key={s.interval}>{s.interval.toUpperCase()}: {s.count.toLocaleString()} candles, latest {ago(s.last)}</div>)}
        </div>
      </div>
    </div>
  );
}
