import { useCallback, useEffect, useState } from "react";
import { backtestApi } from "../api/client";
import { useApp } from "../App";
import TopBar from "../components/TopBar";
import Equity from "../components/Equity";
import { Card, Err, Pill, Seg, VerdictPill, fmt, pair, rfmt, when } from "../components/ui";
import type { Backtest as BT, Stats, VerdictRow } from "../types";

const STYLES = ["intraday", "scalp"] as const;
const ENTRY: Record<string, readonly string[]> = { intraday: ["5m", "15m", "30m"], scalp: ["1m", "3m", "5m"] };

export default function Backtest() {
  const { symbol, settings, isAdmin } = useApp();
  const [style, setStyle] = useState<(typeof STYLES)[number]>("intraday");
  const [tf, setTf] = useState("15m");
  const [days, setDays] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<BT | null>(null);
  const [rows, setRows] = useState<VerdictRow[]>([]);
  const [queue, setQueue] = useState<{ queued: string[][]; running: string[][] }>({ queued: [], running: [] });
  const [rules, setRules] = useState<{ min_trades: number; min_pf: number } | null>(null);

  const loadV = useCallback(() => backtestApi.verdicts().then((r) => { setRows(r.rows); setQueue(r.queue); setRules(r.rules); }).catch(() => {}), []);
  useEffect(() => { loadV(); const t = setInterval(loadV, 15_000); return () => clearInterval(t); }, [loadV]);
  useEffect(() => { if (!ENTRY[style].includes(tf)) setTf(ENTRY[style][style === "scalp" ? 2 : 1]); }, [style, tf]);

  const run = async (save: boolean) => {
    setBusy(true); setErr(null);
    try { setRes(await backtestApi.run(symbol, style, tf, days, save)); if (save) loadV(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };
  const a = res?.assumptions;
  return (
    <>
      <TopBar showEntry={false} />
      <div className="page">
        <Card title={`Backtest · ${pair(symbol)}`} right={<span className="mute2" style={{ textTransform: "none", letterSpacing: 0 }}>same engine, levels, AMD and approved strategies as the live scanner</span>}>
          <div className="row">
            <Seg value={style} options={STYLES} onChange={setStyle} />
            <Seg value={tf} options={ENTRY[style]} onChange={setTf} />
            <label className="row muted" style={{ gap: 6 }}>Days <select className="select" value={days} onChange={(e) => setDays(+e.target.value)}>{[20, 30, 45, 60, 90].map((d) => <option key={d}>{d}</option>)}</select></label>
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => run(false)}>{busy ? "Running…" : "Run backtest"}</button>
            {isAdmin && <button className="btn ghost" disabled={busy} onClick={() => run(true)} title="Run and store the result as this pair's approval verdict">Run &amp; save verdict</button>}
          </div>
          <Err msg={err} />
          {res && (
            <div style={{ marginTop: 18 }}>
              <div className="row" style={{ marginBottom: 12 }}>
                <Pill tone={res.verdict === "APPROVED" ? "green" : res.verdict === "REJECTED" ? "red" : "gold"}>{res.verdict}</Pill>
                <span className="muted" style={{ fontSize: 13 }}>{res.why.join(" · ")}</span>
                {res.demo && <Pill tone="gold">DEMO DATA</Pill>}
              </div>
              <div className="stat-grid">
                <div className="stat"><small>Trades</small><b>{res.trades}</b></div>
                <div className="stat"><small>Win rate</small><b>{res.win_rate}%</b></div>
                <div className="stat"><small>Net result</small><b className={res.net_r >= 0 ? "up" : "down"}>{rfmt(res.net_r)}</b></div>
                <div className="stat"><small>Profit factor</small><b>{res.profit_factor ?? "–"}</b></div>
                <div className="stat"><small>Avg per trade</small><b>{rfmt(res.avg_r)}</b></div>
                <div className="stat"><small>Max drawdown</small><b className="down">{res.max_drawdown_r}R</b></div>
                <div className="stat"><small>Worst losing streak</small><b>{res.worst_losing_streak}</b></div>
                <div className="stat"><small>Break-evens</small><b>{res.scratches}</b></div>
              </div>
              <div style={{ margin: "16px 0" }}><Equity points={res.equity} /></div>
              <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
                <Breakdown title="By side" data={res.by_side} /><Breakdown title="By grade" data={res.by_grade} /><Breakdown title="By zone" data={res.by_zone} />
                {res.recent && <div><h3 style={{ fontSize: 11, letterSpacing: 1.4, color: "var(--text-dim)", margin: "0 0 8px" }}>NEWEST THIRD (SANITY CHECK)</h3><Mini s={res.recent} /></div>}
              </div>
              {a && <div className="mute2" style={{ fontSize: 11.5, marginTop: 14 }}>Assumptions: fee {a.fee_pct_per_side}%/side · slippage {a.slippage_pct}% · entry {a.entry} · break-even at {a.breakeven_r || "off"}R · SL checked before TP in the same bar · {a.levels_amd_confirms ? "key levels + AMD + approved strategies on" : "plain engine"}. A backtest is evidence, not a promise.</div>}
              <details style={{ marginTop: 14 }}>
                <summary className="muted" style={{ cursor: "pointer" }}>Trade log ({res.trade_log.length})</summary>
                <div className="scroll-x"><table className="tbl"><thead><tr><th>Entered</th><th>Side</th><th>Entry</th><th>Exit</th><th>Result</th><th>R</th><th>Grade</th><th>Zone</th></tr></thead>
                  <tbody>{[...res.trade_log].reverse().map((t, i) => (
                    <tr key={i}><td className="muted">{when(t.entry_time)}</td><td>{t.side}</td><td className="mono">{fmt(t.entry)}</td><td className="mono">{fmt(t.exit)}</td>
                      <td><Pill tone={t.result === "WIN" ? "green" : t.result === "LOSS" ? "red" : "blue"}>{t.result}</Pill></td><td className={`mono ${t.r >= 0 ? "up" : "down"}`}>{rfmt(t.r)}</td><td>{t.grade}</td><td className="muted">{t.zone}</td></tr>))}</tbody></table></div>
              </details>
            </div>
          )}
        </Card>

        <Card title="Approval matrix — what the scanner is allowed to signal"
          right={<span className="mute2" style={{ textTransform: "none", letterSpacing: 0 }}>{queue.running.length ? `running ${queue.running[0].join(" ")}… ` : ""}{queue.queued.length ? `${queue.queued.length} queued` : "all up to date"}</span>}>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            A pair is approved when its backtest has at least {rules?.min_trades ?? settings?.bt_min_trades} trades with profit factor ≥ {rules?.min_pf ?? settings?.bt_min_pf}, a positive net result and a non-losing newest third. Pairs with too few trades borrow the strategy&apos;s pooled result across the watchlist. Backtests refresh every 12 hours.
          </div>
          <div className="scroll-x"><table className="tbl"><thead><tr><th>Pair</th><th>Strategy</th><th>Entry</th><th>Verdict</th><th>Own trades</th><th>Net</th><th>PF</th><th>Reason</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.symbol}${r.style}${r.entry_tf}`}><td><b>{pair(r.symbol)}</b></td><td>{r.style}</td><td>{r.entry_tf}</td><td><VerdictPill v={r} /></td>
                <td>{r.trades ?? "–"}</td><td className={(r.net_r ?? 0) >= 0 ? "up" : "down"}>{r.net_r != null ? rfmt(r.net_r) : "–"}</td><td>{r.profit_factor ?? "–"}</td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 420 }}>{(r.why ?? []).join("; ")}</td></tr>))}
              {rows.length === 0 && <tr><td colSpan={8} className="empty">Backtests start automatically when the server boots.</td></tr>}</tbody></table></div>
          {isAdmin && <div style={{ marginTop: 12 }}><button className="btn ghost sm" onClick={() => backtestApi.runAll().then(loadV)}>Re-run all now</button></div>}
        </Card>
      </div>
    </>
  );
}

function Mini({ s }: { s: Stats }) {
  return <div className="row" style={{ gap: 14 }}><span>{s.trades} trades</span><span>{s.win_rate}% win</span><b className={s.net_r >= 0 ? "up" : "down"}>{rfmt(s.net_r)}</b><span className="muted">PF {s.profit_factor ?? "–"}</span></div>;
}
function Breakdown({ title, data }: { title: string; data: Record<string, Stats> }) {
  const ks = Object.keys(data);
  return (
    <div>
      <h3 style={{ fontSize: 11, letterSpacing: 1.4, color: "var(--text-dim)", margin: "0 0 8px" }}>{title.toUpperCase()}</h3>
      {ks.length === 0 && <div className="mute2">–</div>}
      {ks.map((k) => <div key={k} className="lvl-row"><span>{k}</span><span className="mono">{data[k].trades}t · {data[k].win_rate}% · <b className={data[k].net_r >= 0 ? "up" : "down"}>{rfmt(data[k].net_r)}</b></span></div>)}
    </div>
  );
}
