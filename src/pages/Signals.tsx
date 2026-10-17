import { useCallback, useEffect, useState } from "react";
import { signalsApi } from "../api/client";
import { useApp } from "../App";
import TopBar from "../components/TopBar";
import { Card, Err, Modal, Pill, VerdictPill, ago, fmt, pair, rfmt, when } from "../components/ui";
import type { SignalRow, SignalStats } from "../types";

const STATUS_TONE: Record<string, "green" | "red" | "gold" | "blue" | undefined> = { WIN: "green", LOSS: "red", OPEN: "gold", BE: "blue", EXPIRED: undefined };
const FILTERS = ["ALL", "OPEN", "WIN", "LOSS", "BE"] as const;

export default function Signals() {
  const { reloadAlerts } = useApp();
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<SignalRow | null>(null);
  const load = useCallback(() => {
    signalsApi.list(200).then((r) => { setRows(r.signals); setStats(r.stats); setErr(null); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(); const t = setInterval(() => { load(); reloadAlerts(); }, 20_000); return () => clearInterval(t); }, [load, reloadAlerts]);
  const shown = rows.filter((r) => filter === "ALL" || r.status === filter);
  return (
    <>
      <TopBar showEntry={false} onRefresh={load} />
      <div className="page">
        <div className="stat-grid">
          <div className="stat"><small>Signals fired</small><b>{stats?.total ?? "–"}</b></div>
          <div className="stat"><small>Open now</small><b className="gold">{stats?.open ?? "–"}</b></div>
          <div className="stat"><small>Win rate (wins ÷ wins+losses)</small><b>{stats?.win_rate != null ? `${stats.win_rate}%` : "–"}</b></div>
          <div className="stat"><small>Wins · Losses · Break-even</small><b><span className="up">{stats?.wins ?? 0}</span> · <span className="down">{stats?.losses ?? 0}</span> · <span className="muted">{stats?.be ?? 0}</span></b></div>
          <div className="stat"><small>Net result</small><b className={(stats?.net_r ?? 0) >= 0 ? "up" : "down"}>{rfmt(stats?.net_r)}</b></div>
        </div>
        <Card title="Signals" right={<div className="seg">{FILTERS.map((f) => <button key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div>}>
          <Err msg={err} />
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Fired</th><th>Pair</th><th>Side</th><th>Setup</th><th>Entry</th><th>Stop</th><th>Target</th><th>Grade</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className="click" onClick={() => setSel(s)}>
                    <td className="muted" title={when(s.created_at)}>{ago(s.created_at)}</td>
                    <td><b>{pair(s.symbol)}</b></td>
                    <td><Pill tone={s.side === "BUY" ? "green" : "red"}>{s.side}</Pill></td>
                    <td>{s.style} <span className="mute2">{s.entry_tf}</span></td>
                    <td className="mono">{fmt(s.entry)}</td><td className="mono down">{fmt(s.sl)}</td><td className="mono up">{fmt(s.tp)}</td>
                    <td>{s.grade} <span className="mute2">{Math.round(s.agreement)}%</span></td>
                    <td><Pill tone={STATUS_TONE[s.status]}>{s.status === "BE" ? "BREAK-EVEN" : s.status}</Pill></td>
                    <td className={`mono ${(s.r_result ?? 0) > 0 ? "up" : (s.r_result ?? 0) < 0 ? "down" : "muted"}`}>{s.r_result != null ? rfmt(s.r_result) : "…"}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={10} className="empty">{rows.length ? "No signals match this filter." : "No signal has fired yet. The scanner only fires approved setups, so quiet is normal — check the Market page to see what each pair is waiting for."}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {sel && <SignalModal s={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function SignalModal({ s, onClose }: { s: SignalRow; onClose: () => void }) {
  const d = s.detail ?? {};
  return (
    <Modal onClose={onClose}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{s.side} {pair(s.symbol)}</h2><Pill tone={s.side === "BUY" ? "green" : "red"}>{s.style} · {s.entry_tf}</Pill>
        <Pill tone={STATUS_TONE[s.status]}>{s.status}</Pill><span className="spacer" /><button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>{s.reason} · {when(s.created_at)}</div>
      <div className="kv">
        <div><span>Entry</span><b className="mono">{fmt(s.entry)}</b></div><div><span>Stop</span><b className="mono down">{fmt(s.sl)}</b></div>
        <div><span>Target ({s.rr}R)</span><b className="mono up">{fmt(s.tp)}</b></div><div><span>Grade</span><b>{s.grade} · {Math.round(s.agreement)}%</b></div>
        <div><span>Zone</span><b>{s.zone}</b></div>
        <div><span>Break-even rule</span><b>{d.breakeven_at ? `stop → entry at ${fmt(d.breakeven_at)}` : "off"}</b></div>
      </div>
      {s.exit_price != null && <div style={{ marginTop: 10 }}>Closed at <b className="mono">{fmt(s.exit_price)}</b> → <b className={(s.r_result ?? 0) >= 0 ? "up" : "down"}>{rfmt(s.r_result)}</b></div>}
      {d.amd && <div className="blocked" style={{ borderColor: "rgba(192,132,252,.4)", color: "var(--purple)", background: "rgba(192,132,252,.08)" }}>AMD: {d.amd}</div>}
      {d.confirmations && <div className="muted" style={{ marginTop: 10 }}>Confirmed by: <b>{d.confirmations}</b></div>}
      {d.backtest && <div className="row" style={{ marginTop: 10 }}><span className="muted">Backtest at signal time</span><VerdictPill v={d.backtest} />{d.backtest.why?.[0] && <span className="mute2" style={{ fontSize: 12 }}>{d.backtest.why[0]}</span>}</div>}
      {d.ladder && d.ladder.length > 0 && <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Liquidity ahead: {d.ladder.map((l) => `${l.label} ${fmt(l.price)} (${l.rr}R)`).join(" → ")}</div>}
      <h3 style={{ margin: "18px 0 6px", fontSize: 11, letterSpacing: 1.4, color: "var(--text-dim)" }}>WHY IT FIRED</h3>
      {(d.checks ?? []).map((c) => (
        <div key={c.id} className="check"><span className={`ic ${c.ok === true ? "ok" : c.ok === false ? "no" : "na"}`}>{c.ok === true ? "✓" : c.ok === false ? "✕" : "–"}</span><div><b style={{ fontWeight: 600 }}>{c.label}</b>{c.gate && <span className="gate-tag">GATE</span>}<small>{c.detail}</small></div><span /></div>
      ))}
    </Modal>
  );
}
