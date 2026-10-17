// pages/BacktestPage.tsx — replay the engine on stored history, and manage the candle database.
import { useEffect, useState } from "react";
import { mtfApi } from "../api/client";
import { useMtf } from "../context/MtfContext";
import { PAIRS, PAIR_DISPLAY } from "../types";
import type { MtfBacktest, StoreSeries } from "../types/mtf";
import { BLUE, DOWN, EquityLine, UP, ago, card, cardHead, field } from "../components/ui";

export default function BacktestPage({ notify }: { notify: (m: string, t?: "success" | "error" | "info") => void }) {
  const { symbol, entryTf, minAgree } = useMtf();
  const [style, setStyle] = useState("intraday");
  const [bars, setBars] = useState(1500);
  const [bt, setBt] = useState<MtfBacktest | null>(null);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<{ series: StoreSeries[]; total_candles: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [depth, setDepth] = useState(5000);
  const [scope, setScope] = useState<"pair" | "all">("pair");
  const [tfSet, setTfSet] = useState<"core" | "all">("core");
  const [progress, setProgress] = useState("");
  useEffect(() => { mtfApi.store().then(setStore).catch(() => undefined); }, []);
  useEffect(() => setBt(null), [symbol]);
  const run = async () => {
    setBusy(true);
    try {
      const tf = style === "scalp" && !["1m", "3m", "5m"].includes(entryTf) ? "5m" : entryTf;
      setBt(await mtfApi.backtest(symbol, { style, entryTf: tf, bars, minAgree, longOnly: false }));
    } catch (e: any) { notify(e?.message || "Backtest failed", "error"); } finally { setBusy(false); }
  };
  const sync = async () => {
    setSyncing(true);
    const syms = scope === "all" ? PAIRS : [symbol];
    const tfs = tfSet === "core" ? ["4h", "1h", "15m", "5m"] : ["1d", "4h", "1h", "30m", "15m", "5m", "3m", "1m"];
    const jobs = syms.flatMap(sy => tfs.map(tf => [sy, tf] as const));
    let done = 0, saved = 0, failed = 0;
    try {
      for (const [sy, tf] of jobs) {
        setProgress(`Downloading ${sy} ${tf.toUpperCase()} (${done + 1}/${jobs.length})…`);
        try { const r = await mtfApi.sync(sy, tf, depth); saved += Object.values(r.synced).reduce((a, b) => a + b, 0); } catch { failed++; }
        done++;
      }
      notify(`Stored ${saved.toLocaleString()} candles${failed ? ` (${failed} downloads failed)` : ""}`, failed ? "info" : "success");
      setStore(await mtfApi.store());
    } finally { setSyncing(false); setProgress(""); }
  };
  const btn = (c: string) => ({ ...field, cursor: "pointer", color: c, borderColor: `${c}88`, fontWeight: 700 } as const);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 14, alignItems: "start" }}>
      <div style={card}>
        <div style={cardHead}>Backtest · {PAIR_DISPLAY[symbol] || symbol}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select value={style} onChange={e => setStyle(e.target.value)} style={field}><option value="intraday">Intraday · 4H → 1H → entry</option><option value="scalp">Scalp · 1H → 15M → entry</option></select>
          <select value={bars} onChange={e => setBars(+e.target.value)} style={field}>{[800, 1500, 3000, 6000, 10000, 20000].map(b => <option key={b} value={b}>{b.toLocaleString()} entry bars</option>)}</select>
          <button style={btn(UP)} disabled={busy} onClick={run}>{busy ? "Running…" : "Run backtest"}</button>
        </div>
        {bt ? (
          <>
            <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
              <span>Trades <b>{bt.trades}</b></span><span>Win rate <b>{bt.win_rate}%</b></span>
              <span>Net <b style={{ color: bt.net_r >= 0 ? UP : DOWN }}>{bt.net_r}R</b></span><span>Avg <b>{bt.avg_r}R</b></span>
              <span>PF <b>{bt.profit_factor ?? "–"}</b></span><span>Max DD <b>{bt.max_drawdown_r}R</b></span>
            </div>
            <div style={{ margin: "10px 0" }}><EquityLine pts={bt.equity} /></div>
            <div style={{ fontSize: 10, color: "var(--text-mute)" }}>{bt.note} Fees included; stop is checked before target on the same bar. Past results do not predict future ones.{bt.demo ? " DEMO DATA." : ""}</div>
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
              {bt.trade_log.slice(-40).reverse().map((t, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                  <span><b style={{ color: t.side === "BUY" ? UP : DOWN }}>{t.side}</b> {ago(t.entry_time)} · {t.agreement}% {t.grade}</span>
                  <b style={{ color: t.r >= 0 ? UP : DOWN }}>{t.result} {t.r > 0 ? "+" : ""}{t.r}R</b>
                </div>
              ))}
            </div>
          </>
        ) : <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Replays the same engine bar by bar on stored candles — higher timeframes only ever use bars that had already closed.</div>}
      </div>
      <div style={card}>
        <div style={cardHead}>Candle database</div>
        <div style={{ fontSize: 11.5, marginBottom: 10 }}>{store ? <><b>{store.total_candles.toLocaleString()}</b> candles stored across <b>{store.series.length}</b> series.</> : "…"} Every candle the app reads is saved, so charts and scans keep working if the exchange drops out.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select value={depth} onChange={e => setDepth(+e.target.value)} style={field} aria-label="depth">{[1500, 5000, 20000, 50000].map(d => <option key={d} value={d}>{d.toLocaleString()} candles each</option>)}</select>
          <select value={tfSet} onChange={e => setTfSet(e.target.value as "core" | "all")} style={field} aria-label="timeframes"><option value="core">4H 1H 15M 5M</option><option value="all">All timeframes (1D … 1M)</option></select>
          <select value={scope} onChange={e => setScope(e.target.value as "pair" | "all")} style={field} aria-label="scope"><option value="pair">{PAIR_DISPLAY[symbol] || symbol} only</option><option value="all">All pairs</option></select>
        </div>
        <button style={btn(BLUE)} disabled={syncing} onClick={sync}>{syncing ? "Downloading…" : "Download & save candles"}</button>
        {progress && <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 6 }}>{progress}</div>}
        <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 6 }}>Up to 100,000 candles are kept per pair and timeframe. 1m history is large — start with 5,000.</div>
        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 10, fontSize: 10.5, color: "var(--text-dim)" }}>
          {(store?.series ?? []).filter(s => s.symbol === symbol).map(s => <div key={s.interval}>{s.interval.toUpperCase()}: {s.count} candles, latest {ago(s.last)}</div>)}
        </div>
      </div>
    </div>
  );
}
