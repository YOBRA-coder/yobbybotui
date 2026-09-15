// components/SignalDetailModal.tsx
//
// "when i click pop up chart view candles with all the details" — clicking
// a signal used to just navigate away to the Trading page. This instead
// pops up in place with the actual candle chart for that pair (entry/
// target/stop drawn on it via ProChart's signalOverlay) plus every detail
// about the signal, without losing your place on the Signals page.

import { useEffect, useState } from "react";
import type { Signal, Trade, OHLCV } from "../types";
import { PAIR_DISPLAY, timeAgo } from "../types";
import { marketApi } from "../api/client";
import ProChart from "./ProChart";

interface Props {
  signal: Signal;
  trades: Trade[];
  progress: { label: string; pnlText: string; color: string };
  onClose: () => void;
}

export default function SignalDetailModal({ signal: s, trades, progress, onClose }: Props) {
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState("15m");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    marketApi.klines(s.pair, timeframe, 200)
      .then(data => { if (!cancelled) setCandles(data); })
      .catch(() => { if (!cancelled) setCandles([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [s.pair, timeframe]);

  const tp = s.target_price ?? s.targetPrice ?? s.price;
  const sl = s.stop_loss ?? s.stopLoss ?? s.price;
  const postedAt = s.created_at ?? s.timestamp;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000000b0", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, width: "min(920px, 100%)", maxHeight: "92vh", overflow: "auto", padding: 18 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--text)", fontWeight: 800, fontSize: 18 }}>{PAIR_DISPLAY[s.pair] || s.pair}</span>
              <span style={{ background: s.type === "BUY" ? "#00d084" : s.type === "SELL" ? "#ff4757" : "#ffd700", color: "#000", fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 5 }}>{s.type}</span>
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>
              Posted {timeAgo(postedAt)}
            </div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", color: "var(--text-dim)", fontSize: 20, lineHeight: 1, padding: 4 }}>✕</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: progress.color === "#00d084" ? "#00d08414" : "var(--bg2)", border: `1px solid ${progress.color === "#00d084" ? "#00d08444" : "var(--border)"}`, borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{progress.label}</span>
          <span style={{ color: progress.color, fontWeight: 800, fontSize: 13 }}>{progress.pnlText}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          {[{ l: "ENTRY", v: "$" + (s.price || 0).toFixed(4), c: "var(--text)" }, { l: "TARGET", v: "$" + (tp || 0).toFixed(4), c: "#00d084" }, { l: "STOP", v: "$" + (sl || 0).toFixed(4), c: "#ff4757" }].map(m => (
            <div key={m.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px" }}>
              <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{m.l}</div>
              <div style={{ color: m.c, fontWeight: 700, fontSize: 13, marginTop: 2 }}>{m.v}</div>
            </div>
          ))}
        </div>

        <p style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>{s.reason}</p>

        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {["1m", "5m", "15m", "1h", "4h", "1d"].map(tf => (
            <div key={tf} onClick={() => setTimeframe(tf)} style={{ background: timeframe === tf ? "#00d08422" : "var(--surface)", border: `1px solid ${timeframe === tf ? "#00d084" : "var(--border)"}`, color: timeframe === tf ? "#00d084" : "var(--text-dim)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 10 }}>{tf}</div>
          ))}
        </div>

        {/* BUG FIX: this used to conditionally render either a plain
            "Loading chart…" placeholder OR <ProChart>, which fully
            unmounted/remounted the chart (and lost zoom/pan, indicator
            state, everything) on every single timeframe click — since
            ProChart now has its own `loading` overlay (keeps the previous
            candles on screen with an "Updating…" pill instead of a blank
            state), it can just stay mounted the whole time. Also fixes
            this popup's time axis occasionally not being drawn at all,
            which happened when the chart was created fresh while candles
            was still empty right after a remount. */}
        <ProChart
          candles={candles}
          loading={loading}
          trades={trades}
          symbol={s.pair}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          height={360}
          signalOverlay={{
            id: s.id,
            type: s.type,
            price: s.price,
            targetPrice: tp,
            stopLoss: sl,
            confidence: s.confidence,
            reason: s.reason,
          }}
        />
      </div>
    </div>
  );
}
