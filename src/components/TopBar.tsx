import { useState } from "react";
import { useApp } from "../App";
import { Icon, ago, fmt, pct, pair } from "./ui";
import { ENTRY_TFS } from "../types";
import { useNavigate } from "react-router-dom";

export default function TopBar({ price, changePct, updated, lag, onRefresh, showEntry = true, demo }: {
  price?: number; changePct?: number | null; updated?: number; lag?: number; onRefresh?: () => void; showEntry?: boolean; demo?: boolean;
}) {
  const { symbol, setSymbol, pairs, settings, entryTf, setEntryTf, alerts, unread, markRead, wsLive } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const list = settings ? Array.from(new Set([...settings.watchlist, ...pairs])) : pairs;
  const secs = updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  return (
    <div className="top">
      <select className="select big" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
        {list.map((p) => <option key={p} value={p}>{p} · {pair(p)}</option>)}
      </select>
      {price != null && <div className="pricebox mono">{fmt(price)} {changePct != null && <span className={changePct >= 0 ? "up" : "down"} style={{ fontSize: 12 }}>{pct(changePct)}</span>}</div>}
      {showEntry && (
        <>
          <span className="muted" style={{ fontSize: 12 }}>Entry TF</span>
          <div className="seg">{ENTRY_TFS.filter((t) => t !== "3m").map((t) => <button key={t} className={t === entryTf ? "on" : ""} onClick={() => setEntryTf(t)}>{t}</button>)}</div>
        </>
      )}
      <span className="spacer" />
      {demo && <span className="pill gold" title="Exchange unreachable — synthetic candles for UI testing">DEMO DATA</span>}
      <span className="status"><span className={`dot ${wsLive ? "" : "warn"}`} />{secs != null ? `Analysis ${secs}s ago` : "Loading…"}{lag != null && lag > 3 ? <span className="down"> · feed lag {Math.round(lag)}m</span> : lag != null ? ` · feed lag ${Math.round(lag)}m` : ""}</span>
      {onRefresh && <button className="icon-btn" title="Refresh now" onClick={onRefresh}><span style={{ width: 18, height: 18 }}>{Icon.refresh}</span></button>}
      <div style={{ position: "relative" }}>
        <button className="icon-btn" title="Alerts" onClick={() => { setOpen((o) => !o); if (!open && unread) markRead(); }}>
          <span style={{ width: 18, height: 18 }}>{Icon.bell}</span>{unread > 0 && <span className="badge-dot">{unread > 9 ? "9+" : unread}</span>}
        </button>
        {open && (
          <div className="drawer">
            <div style={{ padding: "12px 16px", fontWeight: 700, display: "flex" }}>Alerts<span className="spacer" /><button className="btn ghost sm" onClick={() => { setOpen(false); nav("/signals"); }}>All signals</button></div>
            {alerts.length === 0 && <div className="empty">Nothing yet. Alerts appear when an approved signal fires or settles.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="alert-item">
                <div style={{ fontWeight: 600 }}>{a.kind === "WIN" ? "✅ " : a.kind === "LOSS" ? "❌ " : a.kind === "SIGNAL" ? "🔔 " : ""}{a.title}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{a.body}</div>
                <div className="mute2" style={{ fontSize: 11, marginTop: 3 }}>{ago(a.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
