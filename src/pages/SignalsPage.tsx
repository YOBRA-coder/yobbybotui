// pages/SignalsPage.tsx — every signal the scanner has fired, with a preview of how it played out.
import { useEffect, useState } from "react";
import { useMtf } from "../context/MtfContext";
import { PAIR_DISPLAY } from "../types";
import { fmtPrice } from "../components/MtfChart";
import { SignalPreviewChart } from "../components/Feeds";
import { BLUE, DOWN, MUTED, UP, Pill, ago, card, cardHead } from "../components/ui";

type Filter = "ALL" | "FIRED" | "APPROVED" | "STOPPED" | "EXPIRED";
const LABEL = { OPEN: "FIRED", WIN: "APPROVED", LOSS: "STOPPED", EXPIRED: "EXPIRED" } as const;
const COLOR = { OPEN: BLUE, WIN: UP, LOSS: DOWN, EXPIRED: MUTED } as const;
const KEEP = { FIRED: "OPEN", APPROVED: "WIN", STOPPED: "LOSS", EXPIRED: "EXPIRED" } as const;

export default function SignalsPage() {
  const { signals, stats, markRead } = useMtf();
  const [f, setF] = useState<Filter>("ALL");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  useEffect(() => { markRead(); }, [signals.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = signals.filter(s => f === "ALL" || s.status === KEEP[f]);
  const count = (k: Filter) => (k === "ALL" ? signals.length : signals.filter(s => s.status === KEEP[k]).length);
  const stat = (k: string, v: string, c?: string) => <div key={k} style={{ minWidth: 90 }}><div style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: 1.5 }}>{k}</div><div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div></div>;
  const tab = (k: Filter) => (
    <button key={k} onClick={() => setF(k)} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: "5px 12px", borderRadius: 20, border: `1px solid ${f === k ? BLUE : "var(--border2)"}`, background: f === k ? "#0094ff22" : "transparent", color: f === k ? BLUE : "var(--text-dim)" }}>{k} {count(k)}</button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
        {stat("FIRED", String(stats?.total ?? 0))}{stat("LIVE", String(stats?.open ?? 0))}
        {stat("WIN RATE", stats?.win_rate != null ? `${stats.win_rate}%` : "–")}
        {stat("NET R", `${(stats?.net_r ?? 0) > 0 ? "+" : ""}${stats?.net_r ?? 0}R`, (stats?.net_r ?? 0) >= 0 ? UP : DOWN)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{(["ALL", "FIRED", "APPROVED", "STOPPED", "EXPIRED"] as Filter[]).map(tab)}</div>
      <div style={card}>
        <div style={cardHead}>Signals · fired → approved (target hit) or stopped</div>
        {list.map((s, i) => {
          const show = open[s.id] ?? i < 2;
          return (
            <div key={s.id} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}><span style={{ color: s.side === "BUY" ? UP : DOWN }}>{s.side}</span> {PAIR_DISPLAY[s.symbol] || s.symbol} <Pill color="#8aa4c8">{s.style} · {s.entry_tf}</Pill> <Pill color="#8aa4c8">{s.agreement}% · {s.grade}</Pill></div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>Entry {fmtPrice(s.entry)} · SL {fmtPrice(s.sl)} · TP {fmtPrice(s.tp)} · {s.rr}R · {s.zone}</div>
                  {s.reason && <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 3 }}>{s.reason}</div>}
                </div>
                <div style={{ textAlign: "right", fontSize: 11 }}>
                  <Pill color={COLOR[s.status]}>{LABEL[s.status]}</Pill>
                  {s.r_result != null && s.status !== "OPEN" && <div style={{ fontWeight: 800, color: s.r_result > 0 ? UP : s.r_result < 0 ? DOWN : MUTED, marginTop: 4 }}>{s.r_result > 0 ? "+" : ""}{s.r_result}R</div>}
                  <div style={{ color: "var(--text-mute)", fontSize: 10, marginTop: 2 }}>{ago(s.created_at)}</div>
                </div>
              </div>
              <button onClick={() => setOpen({ ...open, [s.id]: !show })} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 10, color: BLUE, background: "transparent", border: "none", padding: "6px 0" }}>{show ? "▾ Hide preview" : "▸ Show preview"}</button>
              {show && <SignalPreviewChart id={s.id} />}
            </div>
          );
        })}
        {!list.length && <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Nothing here yet. The scanner checks every pair each minute and only fires a signal when every gate passes.</div>}
      </div>
    </div>
  );
}
