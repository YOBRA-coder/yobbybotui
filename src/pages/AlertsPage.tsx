// pages/AlertsPage.tsx — what is happening right now, the activity log and the news.
import { useNavigate } from "react-router-dom";
import { useMtf } from "../context/MtfContext";
import { PAIR_DISPLAY } from "../types";
import { fmtPrice } from "../components/MtfChart";
import { ActivityFeed, NewsList } from "../components/Feeds";
import { activeSession } from "../components/SignalPanels";
import { BLUE, DOWN, UP, WARN, Pill, STATE_META, card, cardHead, field } from "../components/ui";

export default function AlertsPage() {
  const { rows, events, clearEvents, setSymbol, symbol, prefs, entryTf, minAgree } = useMtf();
  const nav = useNavigate();
  const live = rows.filter(r => r.state === "SIGNAL");
  const setups = rows.filter(r => r.state === "SETUP");
  const watch = rows.filter(r => r.state === "WATCH");
  const sess = activeSession();
  const open = (sym: string) => { setSymbol(sym); nav("/"); };
  const line = (r: typeof rows[number]) => (
    <div key={r.symbol} onClick={() => open(r.symbol)} style={{ padding: "8px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
        <b>{PAIR_DISPLAY[r.symbol] || r.symbol} <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>{r.price != null ? fmtPrice(r.price) : ""}</span></b>
        <span style={{ display: "flex", gap: 6 }}><Pill color={STATE_META[r.state].color}>{r.state === "SIGNAL" ? r.type : r.state}</Pill><Pill color="#8aa4c8">{r.agreement}% · {r.grade}</Pill></span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3 }}>{r.watch}</div>
      {r.plan && <div style={{ fontSize: 10.5, marginTop: 3 }}>Entry {fmtPrice(r.plan.entry)} · <span style={{ color: DOWN }}>SL {fmtPrice(r.plan.sl)}</span> · <span style={{ color: UP }}>TP {fmtPrice(r.plan.tp)}</span> · {r.plan.rr}R</div>}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 14, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={card}>
          <div style={cardHead}>Happening now · entry {entryTf.toUpperCase()} · min {minAgree}%</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <Pill color={sess ? BLUE : "#6f86a8"}>{sess ? `${sess} session open` : "Off-hours"}</Pill>
            <Pill color={UP}>{live.length} signal{live.length === 1 ? "" : "s"} live</Pill>
            <Pill color={WARN}>{setups.length} setup{setups.length === 1 ? "" : "s"} waiting</Pill>
            <Pill color={BLUE}>{watch.length} on watch</Pill>
          </div>
          {!rows.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Scanning all pairs…</div>}
          {live.length > 0 && <div style={{ fontSize: 9, letterSpacing: 2, color: UP, marginTop: 8 }}>SIGNALS</div>}
          {live.map(line)}
          {setups.length > 0 && <div style={{ fontSize: 9, letterSpacing: 2, color: WARN, marginTop: 10 }}>SETUPS WAITING FOR A TRIGGER</div>}
          {setups.map(line)}
          {watch.length > 0 && <div style={{ fontSize: 9, letterSpacing: 2, color: BLUE, marginTop: 10 }}>WATCHING FOR A PULLBACK</div>}
          {watch.slice(0, 6).map(line)}
          {rows.length > 0 && !live.length && !setups.length && !watch.length && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>All pairs are standing aside — no clean setup anywhere. That is normal.</div>}
        </div>
        <div style={card}>
          <div style={{ ...cardHead, display: "flex", justifyContent: "space-between" }}>
            <span>Alert delivery</span>
            <button onClick={() => nav("/profile")} style={{ ...field, cursor: "pointer", fontSize: 10 }}>Settings</button>
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.8 }}>
            Pop-up <b style={{ color: prefs.toast ? UP : "var(--text-dim)" }}>{prefs.toast ? "on" : "off"}</b> · Sound <b style={{ color: prefs.sound ? UP : "var(--text-dim)" }}>{prefs.sound ? "on" : "off"}</b> · Desktop <b style={{ color: prefs.desktop ? UP : "var(--text-dim)" }}>{prefs.desktop ? "on" : "off"}</b> · Telegram: set in Profile
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={card}>
          <div style={{ ...cardHead, display: "flex", justifyContent: "space-between" }}>
            <span>Activity log</span>
            {events.length > 0 && <button onClick={clearEvents} style={{ ...field, cursor: "pointer", fontSize: 10 }}>Clear</button>}
          </div>
          <ActivityFeed events={events} limit={40} />
        </div>
        <div style={card}>
          <div style={cardHead}>News</div>
          <NewsList symbol={symbol} limit={14} />
        </div>
      </div>
    </div>
  );
}
