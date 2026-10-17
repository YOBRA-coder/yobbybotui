import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { marketApi } from "../api/client";
import { useApp } from "../App";
import TopBar from "../components/TopBar";
import { Card, Err, Pill, VerdictPill, ago, fmt, pair, pct } from "../components/ui";
import type { ScannerRow } from "../types";

const STATE_TONE: Record<string, "green" | "red" | "gold" | "blue" | undefined> = { SIGNAL: "green", SETUP: "gold", WATCH: "blue", STAND_ASIDE: undefined };

export default function Market() {
  const { setSymbol } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [updated, setUpdated] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const load = useCallback((refresh = false) => {
    marketApi.overview(refresh).then((r) => { setRows(r.rows); setUpdated(r.updated * 1000); setDemo(r.demo); setErr(null); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(); const t = setInterval(() => load(), 30_000); return () => clearInterval(t); }, [load]);
  const open = (s: string) => { setSymbol(s); nav("/"); };
  return (
    <>
      <TopBar updated={updated} onRefresh={() => load(true)} showEntry={false} demo={demo} />
      <div className="page">
        <Card title="Market watch — your watchlist, scanned by the approved strategies">
          <Err msg={err} />
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Pair</th><th>Price</th><th>24h</th><th>State</th><th>Bias</th><th>Agree</th><th>Strategy</th><th>Approval</th><th>What it is waiting for</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className="click" onClick={() => open(r.symbol)}>
                    <td><b>{pair(r.symbol)}</b></td>
                    <td className="mono">{fmt(r.price)}</td>
                    <td className={`mono ${(r.changePct ?? 0) >= 0 ? "up" : "down"}`}>{pct(r.changePct)}</td>
                    <td><Pill tone={r.type === "BUY" ? "green" : r.type === "SELL" ? "red" : STATE_TONE[r.state]}>{r.type !== "HOLD" ? `${r.type} SIGNAL` : r.state.replace("_", " ")}</Pill></td>
                    <td className={r.direction === "bullish" ? "up" : r.direction === "bearish" ? "down" : "muted"}>{r.direction}</td>
                    <td><b>{Math.round(r.agreement)}%</b> <span className="mute2">{r.grade}</span></td>
                    <td>{r.style} <span className="mute2">{r.entry_tf}</span></td>
                    <td>{r.approval?.backtest ? <VerdictPill v={r.approval.backtest} /> : <Pill>–</Pill>}</td>
                    <td style={{ maxWidth: 360, fontSize: 12.5 }} className="muted">{r.blocked ?? r.watch}{r.amd ? <div className="gold" style={{ marginTop: 3 }}>AMD: {r.amd}</div> : null}</td>
                  </tr>
                ))}
                {rows.length === 0 && !err && <tr><td colSpan={9} className="empty">Scanning…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mute2" style={{ fontSize: 11, marginTop: 10 }}>Updated {updated ? ago(updated / 1000) : "–"} · click a row to open it on the dashboard. A setup only becomes a SIGNAL when its strategy, pair and backtest are all approved.</div>
        </Card>
      </div>
    </>
  );
}
