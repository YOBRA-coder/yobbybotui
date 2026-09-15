// pages/SignalsPage.tsx
import { useState } from "react";
import type { PageProps } from "./shared";
import { PAIR_DISPLAY, timeAgo } from "../types";
import { signalsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { S } from "./styles";
import SignalDetailModal from "../components/SignalDetailModal";

export default function SignalsPage({ signals, setSignals, tickers, trades, notify }: PageProps) {
  const { auth } = useAuth();
  const [gen, setGen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
    const [sendingCopy, setSendingCopy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "BUY" | "SELL" | "HOLD">("ALL");
  const [detailSignal, setDetailSignal] = useState<typeof signals[0] | null>(null);

  const generate = async () => {
    if (!auth.token) return;
    setGen(true);
    try {
      const results = await signalsApi.generate(auth.token);
      setSignals(prev => [...results, ...prev].slice(0, 100));
      notify(`${results.length} signals generated!`, "success");
    } catch (e: any) { notify(e.message, "error"); }
    setGen(false);
  };

  const sendTG = async (s: typeof signals[0]) => {
    if (!auth.token) return;
    setSending(s.id);
    try {
      await signalsApi.sendTelegram(auth.token, s.id);
      notify("Signal sent to Telegram! ✈", "success");
    } catch (e: any) { notify(e.message || "Telegram failed", "error"); }
    setSending(null);
  };

  const copyTrade = async (s: typeof signals[0]) => {
    if (!auth.token) return;
    setSendingCopy(s.id);
    try {
      await signalsApi.copy(auth.token, s.id );
      notify("Signal copied to trade! ✈", "success");
    } catch (e: any) { notify(e.message || "Copy trade failed", "error"); }
    setSendingCopy(null);
  };



  // "calculating p&l auto for each signal indicating how its going if
  // closed or open" — signals had no P&L or status tracking of any kind
  // before. If you actually copied a signal into a trade, show that
  // trade's real (open/unrealized or closed/realized) P&L; otherwise show
  // a clearly-labeled hypothetical "if you'd taken this" P&L computed off
  // live price, so you can see how the signal is playing out either way.
  // `alert: true` means "this is still working and hasn't hit its stop or
  // target yet, and hasn't been copied" — i.e. worth surfacing as a
  // still-actionable copy opportunity, not just a quiet history row.
  const progressFor = (s: typeof signals[0]) => {
    const tp = s.target_price ?? s.targetPrice ?? s.price;
    const sl = s.stop_loss ?? s.stopLoss ?? s.price;
    const linkedTrade = trades.find(t => t.signal_id === s.id);
    const ticker = tickers.find(t => t.symbol === s.pair);
    const currentPrice = ticker?.price;

    if (linkedTrade) {
      const isOpen = linkedTrade.status === "FILLED";
      let pnl = linkedTrade.pnl || 0;
      if (isOpen && currentPrice != null) {
        pnl = linkedTrade.side === "BUY"
          ? (currentPrice - linkedTrade.price) * linkedTrade.amount
          : (linkedTrade.price - currentPrice) * linkedTrade.amount;
      }
      const pnlPct = linkedTrade.total ? (pnl / linkedTrade.total) * 100 : 0;
      return {
        label: isOpen ? "Copied — Open" : "Copied — Closed",
        pnlText: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`,
        color: pnl >= 0 ? "#00d084" : "#ff4757",
        alert: false,
      };
    }

    if (s.type === "HOLD" || currentPrice == null) {
      return { label: "No position taken", pnlText: "—", color: "var(--text-dim)", alert: false };
    }

    const pnlPct = s.type === "BUY"
      ? ((currentPrice - s.price) / s.price) * 100
      : ((s.price - currentPrice) / s.price) * 100;
    const hitTarget = s.type === "BUY" ? currentPrice >= tp : currentPrice <= tp;
    const hitStop = s.type === "BUY" ? currentPrice <= sl : currentPrice >= sl;
    const stillLive = !hitTarget && !hitStop;
    const label = hitTarget ? "Would've hit target ✅" : hitStop ? "Would've hit stop 🛑" : "Tracking — not taken";
    return {
      label,
      pnlText: `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% if taken`,
      color: pnlPct >= 0 ? "#00d084" : "#ff4757",
      // Still actionable and moving in the right direction — worth an alert.
      alert: stillLive && pnlPct > 0,
    };
  };

  const filtered = filter === "ALL" ? signals : signals.filter(s => s.type === filter);

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button style={{ ...S.btn, width: "auto", padding: "9px 18px" }} onClick={generate} disabled={gen}>
          {gen ? "⏳ Scanning..." : "⚡ Generate Signals"}
        </button>
        {(["ALL", "BUY", "SELL", "HOLD"] as const).map(f => (
          <div key={f} style={{ background: filter === f ? "#00d08422" : "var(--surface)", border: `1px solid ${filter === f ? "#00d084" : "var(--border)"}`, color: filter === f ? "#00d084" : "var(--text-dim)", borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontSize: 11 }} onClick={() => setFilter(f)}>{f}</div>
        ))}
        <span style={{ color: "var(--text-mute)", fontSize: 10, marginLeft: "auto" }}>{filtered.length} signals</span>
      </div>

      {filtered.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "70px 0", color: "var(--text-mute)" }}>
          <div style={{ fontSize: 44 }}>◉</div>
          <div style={{ color: "var(--text-mute)", marginTop: 10, fontWeight: 600, fontSize: 13 }}>Generate signals to see them here</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(310px,1fr))", gap: 11 }}>
        {filtered.map(s => {
          const tp = s.target_price ?? s.targetPrice ?? s.price;
          const sl = s.stop_loss ?? s.stopLoss ?? s.price;
          const isAI = !!(s.ai_generated || s.aiGenerated);
          const progress = progressFor(s);
          const alreadyCopied = trades.some(t => t.signal_id === s.id);
          return (
            <div key={s.id} style={{ background: "var(--surface)", border: `1px solid ${progress.alert ? "#00d084" : s.type === "BUY" ? "#00d08444" : s.type === "SELL" ? "#ff475744" : "#ffd70044"}`, borderRadius: 11, padding: 15, cursor: "pointer" }} onClick={() => setDetailSignal(s)}>
              {progress.alert && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#00d08420", border: "1px solid #00d08466", color: "#00d084", fontSize: 9, fontWeight: 800, borderRadius: 5, padding: "3px 8px", marginBottom: 8 }}>
                  🔔 STILL PROFITABLE — COPY NOW
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: "var(--text)", fontWeight: 800, fontSize: 14 }}>{PAIR_DISPLAY[s.pair] || s.pair}</span>
                  {isAI && <span style={{ background: "#0094ff18", border: "1px solid #0094ff44", color: "#0094ff", fontSize: 8, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>AI</span>}
                </div>
                <span style={{ background: s.type === "BUY" ? "#00d084" : s.type === "SELL" ? "#ff4757" : "#ffd700", color: "#000", fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 4 }}>{s.type}</span>
              </div>
              <div style={{ color: "var(--text-mute)", fontSize: 9, marginBottom: 8 }}>Posted {timeAgo(s.created_at ?? s.timestamp)}</div>
              <p style={{ color: "var(--text-dim)", fontSize: 10, marginBottom: 10, lineHeight: 1.55 }}>{s.reason?.slice(0, 90)}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 8 }}>
                {[{ l: "ENTRY", v: "$" + (s.price || 0).toFixed(4), c: "var(--text)" }, { l: "TARGET", v: "$" + (tp || 0).toFixed(4), c: "#00d084" }, { l: "STOP", v: "$" + (sl || 0).toFixed(4), c: "#ff4757" }].map(m => (
                  <div key={m.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 7px" }}>
                    <div style={{ color: "var(--text-mute)", fontSize: 8, fontWeight: 700, letterSpacing: 1 }}>{m.l}</div>
                    <div style={{ color: m.c, fontWeight: 700, fontSize: 10, marginTop: 1 }}>{m.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 9px", marginBottom: 10 }}>
                <span style={{ color: "var(--text-dim)", fontSize: 9 }}>{progress.label}</span>
                <span style={{ color: progress.color, fontWeight: 700, fontSize: 10 }}>{progress.pnlText}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ background: "var(--bg2)", borderRadius: 8, overflow: "hidden", width: 60, height: 4 }}>
                    <div style={{ width: `${s.confidence}%`, height: "100%", background: s.type === "BUY" ? "#00d084" : s.type === "SELL" ? "#ff4757" : "#ffd700" }} />
                  </div>
                  <span style={{ color: "var(--text-dim)", fontSize: 9 }}>{(s.confidence || 0).toFixed(0)}%</span>
                </div>
                <button style={{ background: alreadyCopied ? "#2e406018" : "#0094ff18", border: `1px solid ${alreadyCopied ? "var(--text-mute)" : "#0094ff44"}`, color: alreadyCopied ? "var(--text-dim)" : "#0094ff", borderRadius: 6, padding: "4px 11px", cursor: alreadyCopied ? "default" : "pointer", fontSize: 10, fontFamily: "inherit" }} onClick={(e) => { e.stopPropagation(); !alreadyCopied && copyTrade(s); }} disabled={sendingCopy === s.id || alreadyCopied}>
                  {alreadyCopied ? "✓ Copied" : sendingCopy === s.id ? "..." : "✈ Copy"}
                </button>
                <button style={{ background: "#0094ff18", border: "1px solid #0094ff44", color: "#0094ff", borderRadius: 6, padding: "4px 11px", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }} onClick={(e) => { e.stopPropagation(); sendTG(s); }} disabled={sendingCopy === s.id}>
                  {sending === s.id ? "..." : "✈ Send"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {detailSignal && (
        <SignalDetailModal
          signal={detailSignal}
          trades={trades}
          progress={progressFor(detailSignal)}
          onClose={() => setDetailSignal(null)}
        />
      )}
    </div>
  );
}
