// pages/DashboardPage.tsx — chart workspace + signal card + sessions, like GoldSignal.
import { useMtf } from "../context/MtfContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { PAIR_DISPLAY } from "../types";
import { Checklist, SessionsCard, SignalCard, Workspace } from "../components/SignalPanels";
import { NewsList } from "../components/Feeds";
import { DOWN, UP, WARN, Pill, STATE_META, ago, card, cardHead } from "../components/ui";

export default function DashboardPage() {
  const { data, error, signals, rows, setSymbol, symbol } = useMtf();
  const mobile = useIsMobile(1000);
  const hot = rows.filter(r => r.state === "SIGNAL" || r.state === "SETUP").slice(0, 6);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && <div style={{ background: "#ff475718", border: "1px solid #ff475755", color: DOWN, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>{error} — retrying automatically.</div>}
      {data?.demo && <div style={{ background: "#ffd70014", border: "1px solid #ffd70055", color: WARN, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>DEMO DATA — the exchange is not reachable, so these candles are simulated. Do not trade on them.</div>}
      {data && data.staleMinutes > 5 && !data.demo && <div style={{ background: "#ff475718", border: "1px solid #ff475755", color: DOWN, borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>Data is {Math.round(data.staleMinutes)} min old — the exchange feed is lagging; showing the last stored candles.</div>}
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0,1fr)" : "minmax(0,1fr) 340px", gap: 14, alignItems: "start" }}>
        <Workspace compact />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <SignalCard />
          <SessionsCard />
        </div>
      </div>
      <Checklist />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 14 }}>
        <div style={card}>
          <div style={cardHead}>Worth watching now</div>
          {hot.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Nothing is close to a trigger on any pair right now.</div>}
          {hot.map(r => (
            <div key={r.symbol} onClick={() => setSymbol(r.symbol)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--border)", cursor: "pointer", fontSize: 11.5 }}>
              <b>{PAIR_DISPLAY[r.symbol] || r.symbol}</b>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}><Pill color={STATE_META[r.state].color}>{r.state === "SIGNAL" ? r.type : r.state}</Pill><span style={{ color: "var(--text-dim)" }}>{r.agreement}%</span></span>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={cardHead}>Recent signals</div>
          {signals.slice(0, 6).map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 11.5 }}>
              <span><b style={{ color: s.side === "BUY" ? UP : DOWN }}>{s.side}</b> {PAIR_DISPLAY[s.symbol] || s.symbol} <span style={{ color: "var(--text-dim)" }}>{s.entry_tf} · {ago(s.created_at)}</span></span>
              <span style={{ fontWeight: 700, color: s.status === "WIN" ? UP : s.status === "LOSS" ? DOWN : "var(--text-dim)" }}>{s.status === "OPEN" ? "FIRED" : `${(s.r_result ?? 0) > 0 ? "+" : ""}${s.r_result ?? 0}R`}</span>
            </div>
          ))}
          {!signals.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>No signal has fired yet — the scanner checks every pair each minute.</div>}
        </div>
        <div style={card}>
          <div style={cardHead}>News · {symbol.replace("USDT", "")}</div>
          <NewsList symbol={symbol} limit={6} />
        </div>
      </div>
    </div>
  );
}
