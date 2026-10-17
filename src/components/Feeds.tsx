// components/Feeds.tsx — news, the activity log, and the little signal preview chart.
import { useEffect, useState } from "react";
import { mtfApi } from "../api/client";
import type { ActivityEvent } from "../context/MtfContext";
import type { NewsResponse, SignalPreview } from "../types/mtf";
import { BLUE, DOWN, MUTED, UP, WARN, ago } from "./ui";

const TONE: Record<ActivityEvent["tone"], string> = { up: UP, down: DOWN, warn: WARN, info: BLUE };
const KIND_ICON: Record<ActivityEvent["kind"], string> = { signal: "◆", result: "✔", state: "●", info: "ℹ" };

export function ActivityFeed({ events, limit = 30, empty }: { events: ActivityEvent[]; limit?: number; empty?: string }) {
  if (!events.length) return <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{empty || "Nothing yet — new signals, setups forming and results will be logged here."}</div>;
  return (
    <div>
      {events.slice(0, limit).map(e => (
        <div key={e.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 11, lineHeight: 1.4 }}>
          <span style={{ color: TONE[e.tone], width: 12, textAlign: "center" }}>{KIND_ICON[e.kind]}</span>
          <span style={{ flex: 1 }}>{e.text}</span>
          <span style={{ color: "var(--text-mute)", whiteSpace: "nowrap", fontSize: 10 }}>{ago(e.t)}</span>
        </div>
      ))}
    </div>
  );
}

export function NewsList({ symbol, limit = 12, allowToggle = true }: { symbol: string; limit?: number; allowToggle?: boolean }) {
  const [onlyCoin, setOnlyCoin] = useState(true);
  const [res, setRes] = useState<NewsResponse | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setRes(null); setErr(false);
    mtfApi.news(onlyCoin ? symbol : "", limit).then(r => live && setRes(r)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [symbol, onlyCoin, limit]);
  const coin = symbol.replace("USDT", "");
  return (
    <div>
      {allowToggle && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {[true, false].map(v => (
            <button key={String(v)} onClick={() => setOnlyCoin(v)} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 20, border: `1px solid ${onlyCoin === v ? BLUE : "var(--border2)"}`, background: onlyCoin === v ? "#0094ff22" : "transparent", color: onlyCoin === v ? BLUE : "var(--text-dim)" }}>{v ? coin : "All crypto"}</button>
          ))}
        </div>
      )}
      {err && <div style={{ color: DOWN, fontSize: 11 }}>Could not load news.</div>}
      {!err && !res && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Loading headlines…</div>}
      {res && !res.items.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{res.ok ? `No recent headlines mention ${coin}.` : "News feeds are unreachable from the server right now."}</div>}
      {res?.items.map(n => (
        <a key={n.link} href={n.link} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "7px 0", borderTop: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.35 }}>{n.title}</div>
          <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginTop: 2 }}>{n.source}{n.time ? ` · ${ago(n.time)}` : ""}</div>
        </a>
      ))}
    </div>
  );
}

// ── signal preview: entry / stop / target over the candles around the signal ──
const cache = new Map<number, SignalPreview>();
export function SignalPreviewChart({ id, height = 150 }: { id: number; height?: number }) {
  const [pv, setPv] = useState<SignalPreview | null>(cache.get(id) ?? null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (cache.has(id)) { setPv(cache.get(id)!); return; }
    let live = true;
    mtfApi.preview(id).then(r => { if (r.signal.status !== "OPEN") cache.set(id, r); if (live) setPv(r); }).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [id]);
  if (err) return <div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>Preview unavailable (candles for this signal are not stored).</div>;
  if (!pv) return <div style={{ height, color: "var(--text-dim)", fontSize: 10.5 }}>Loading preview…</div>;
  const s = pv.signal, cs = pv.candles;
  if (cs.length < 3) return <div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>Not enough stored candles to draw this signal yet.</div>;
  const W = 600, H = height, pad = 8;
  const vals = cs.flatMap(c => [c.high, c.low]).concat([s.sl, s.tp, s.entry]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const Y = (p: number) => pad + (1 - (p - lo) / span) * (H - pad * 2);
  const X = (i: number) => (i / (cs.length - 1)) * W;
  const ei = Math.max(0, cs.findIndex(c => c.time > s.bar_time));
  const xi = ei === -1 ? 0 : X(ei);
  const long = s.side === "BUY";
  const xs = (t: number) => { let k = cs.findIndex(c => c.time >= t); if (k < 0) k = cs.length - 1; return X(k); };
  const pts = cs.map((c, i) => `${X(i)},${Y(c.close)}`);
  const exitX = s.closed_at ? xs(s.closed_at) : null;
  const exitY = s.exit_price != null ? Y(s.exit_price) : null;
  const col = s.status === "WIN" ? UP : s.status === "LOSS" ? DOWN : BLUE;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={`${s.symbol} ${s.side} preview`} style={{ display: "block", background: "var(--bg2)", borderRadius: 8 }}>
        <rect x={xi} y={Math.min(Y(s.entry), Y(s.tp))} width={W - xi} height={Math.abs(Y(s.tp) - Y(s.entry))} fill={UP} fillOpacity={0.12} />
        <rect x={xi} y={Math.min(Y(s.entry), Y(s.sl))} width={W - xi} height={Math.abs(Y(s.sl) - Y(s.entry))} fill={DOWN} fillOpacity={0.12} />
        <line x1={0} x2={W} y1={Y(s.tp)} y2={Y(s.tp)} stroke={UP} strokeDasharray="4 3" />
        <line x1={0} x2={W} y1={Y(s.sl)} y2={Y(s.sl)} stroke={DOWN} strokeDasharray="4 3" />
        <line x1={0} x2={W} y1={Y(s.entry)} y2={Y(s.entry)} stroke={BLUE} strokeDasharray="2 3" />
        <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={MUTED} fillOpacity={0.12} />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--text)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <line x1={xi} x2={xi} y1={0} y2={H} stroke={long ? UP : DOWN} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        {exitX != null && exitY != null && <circle cx={exitX} cy={exitY} r={5} fill={col} />}
      </svg>
      <div style={{ display: "flex", gap: 12, fontSize: 9.5, color: "var(--text-dim)", marginTop: 4, flexWrap: "wrap" }}>
        <span style={{ color: UP }}>━ target</span><span style={{ color: DOWN }}>━ stop</span><span style={{ color: BLUE }}>┅ entry</span>
        <span>{long ? "▲" : "▼"} fired {ago(s.created_at)}</span>
        {s.status !== "OPEN" && s.closed_at && <span style={{ color: col }}>● {s.status === "WIN" ? "target hit" : s.status === "LOSS" ? "stopped out" : "expired"} {ago(s.closed_at)}</span>}
      </div>
    </div>
  );
}
