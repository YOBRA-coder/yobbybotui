// components/Optimizer.tsx — "find the best settings for this pair" (backtest search with an untouched test period).
import { useState } from "react";
import { mtfApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useMtf } from "../context/MtfContext";
import { PAIR_DISPLAY } from "../types";
import type { EngineProfile, OptCandidate, OptMetrics, OptResult } from "../types/mtf";
import { BLUE, DOWN, UP, WARN, card, cardHead, field } from "./ui";

export const profileText = (p: Record<string, string | number | boolean | undefined>, style: string) =>
  [p.sens && String(p.sens), p.min_agree && `≥${p.min_agree}% agree`, (p[`rr_${style}`] ?? p.rr_intraday ?? p.rr_scalp) && `${p[`rr_${style}`] ?? p.rr_intraday ?? p.rr_scalp}R target`,
    p.sl_buffer != null && `stop buffer ${p.sl_buffer}`, p.risk_guard != null && `safe-entry ${["off", "block high", "block medium+"][Number(p.risk_guard)] ?? p.risk_guard}`].filter(Boolean).join(" · ");

const M = ({ m }: { m: OptMetrics }) => (
  <span style={{ color: m.trades ? (m.avg_r > 0 ? UP : DOWN) : "var(--text-mute)" }}>
    {m.trades} trades · {m.win_rate}% win · {m.avg_r > 0 ? "+" : ""}{m.avg_r}R avg · {m.net_r > 0 ? "+" : ""}{m.net_r}R
  </span>
);

export default function Optimizer({ style, entryTf, onPreview, notify }: {
  style: string; entryTf: string; onPreview: (p: EngineProfile) => void; notify: (m: string, t?: "success" | "error" | "info") => void;
}) {
  const { symbol, refreshEngine, refresh, engine } = useMtf();
  const { auth } = useAuth();
  const [bars, setBars] = useState(3000);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<OptResult | null>(null);
  const [err, setErr] = useState("");
  const tuned = engine?.profiles?.[symbol];

  const run = async () => {
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await mtfApi.optimize(symbol, { style, entryTf, bars })); }
    catch (e: any) { setErr(e?.message || "Optimizer failed"); }
    finally { setBusy(false); }
  };
  const apply = async (p: EngineProfile | null) => {
    if (!auth.token) { notify("Log in to save settings", "error"); return; }
    try {
      await mtfApi.saveProfile(auth.token, symbol, p);
      await refreshEngine(); refresh();
      notify(p ? `${PAIR_DISPLAY[symbol] || symbol} now uses the tuned settings everywhere (charts, scanner, alerts)` : "Tuned settings removed", "success");
    } catch (e: any) { notify(e?.message || "Could not save", "error"); }
  };
  const vc = res?.verdict === "robust" ? UP : res?.verdict === "tentative" ? WARN : DOWN;
  const row = (label: string, c: { params: Record<string, string | number | boolean>; train: OptMetrics; val: OptMetrics }, best?: boolean, cand?: OptCandidate) => (
    <div key={label + JSON.stringify(c.params)} style={{ borderTop: "1px solid var(--border)", padding: "7px 0", fontSize: 11, background: best ? "#00d08410" : undefined }}>
      <div style={{ fontWeight: 700 }}>{best ? "★ " : ""}{label} <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>{profileText(c.params, style)}</span>
        {cand && <button style={{ ...field, cursor: "pointer", fontSize: 9.5, padding: "1px 7px", marginLeft: 8 }} onClick={() => onPreview({ ...(c.params as EngineProfile), entry_tf: res!.entry_tf })} title="Fill the backtest form above with these settings">use in form</button>}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 2, marginTop: 2 }}>
        <div><span style={{ color: "var(--text-mute)" }}>search period: </span><M m={c.train} /></div>
        <div><span style={{ color: "var(--text-mute)" }}>untouched test: </span><M m={c.val} /></div>
      </div>
    </div>
  );
  return (
    <div style={card}>
      <div style={cardHead}>Find the best settings · {PAIR_DISPLAY[symbol] || symbol}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 8 }}>
        Tries sensitivity, safe-entry level, target, stop buffer and minimum agreement on this pair's stored history. Settings are chosen on the first 65% and
        must <b>also</b> work on the untouched last 35% — otherwise nothing is recommended. Takes about 30–60 seconds.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={bars} onChange={e => setBars(+e.target.value)} style={field} aria-label="history to optimize on">{[1500, 3000, 5000, 8000].map(b => <option key={b} value={b}>{b.toLocaleString()} {entryTf.toUpperCase()} bars</option>)}</select>
        <button style={{ ...field, cursor: "pointer", color: BLUE, borderColor: "#0094ff88", fontWeight: 700 }} disabled={busy} onClick={run}>{busy ? "Searching… (don't close this page)" : "🎯 Find best settings"}</button>
        {tuned && <span style={{ fontSize: 10.5, color: "#ffb86b" }}>Currently tuned: {profileText(tuned as Record<string, string | number | boolean>, style)}{" "}
          <button style={{ ...field, cursor: "pointer", fontSize: 9.5, padding: "1px 7px" }} onClick={() => apply(null)}>remove</button></span>}
      </div>
      {err && <div style={{ color: DOWN, fontSize: 11, marginTop: 8 }}>{err}</div>}
      {res && (
        <div style={{ marginTop: 10 }}>
          <div style={{ border: `1px solid ${vc}66`, borderLeft: `3px solid ${vc}`, borderRadius: 8, padding: "7px 10px", fontSize: 11.5, lineHeight: 1.5 }}>
            <b style={{ color: vc }}>{res.verdict === "robust" ? "Robust result" : res.verdict === "tentative" ? "Tentative result" : "No robust edge found"}</b> — {res.note}
            <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 2 }}>{res.runs} runs · {res.bars.toLocaleString()} bars · test period starts {new Date(res.split_time * 1000).toLocaleDateString()}{res.demo ? " · DEMO data" : ""}</div>
          </div>
          {res.best && res.profile && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 2px" }}>
              <button style={{ ...field, cursor: "pointer", color: UP, borderColor: "#00d08488", fontWeight: 800 }} onClick={() => apply(res.profile)}>✓ Apply to {PAIR_DISPLAY[symbol] || symbol} everywhere</button>
              <span style={{ fontSize: 10.5, color: "var(--text-dim)", alignSelf: "center" }}>charts · scanner · entry-timeframe scan · Telegram alerts</span>
            </div>
          )}
          {row("Default (balanced)", res.baseline)}
          {res.candidates.map((c, i) => row(`#${i + 1}`, c, res.best === c || (res.best != null && JSON.stringify(res.best.params) === JSON.stringify(c.params)), c))}
          <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginTop: 6, lineHeight: 1.5 }}>
            Past results do not predict future profit. Fees and slippage are included; more trades make a result more trustworthy (aim for 30+ across both periods).
          </div>
        </div>
      )}
    </div>
  );
}
