// App.tsx — NexusAI: multi-timeframe SMC crypto SIGNALS (no trading, no bots).
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { MtfProvider, useMtf } from "./context/MtfContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { PAIR_DISPLAY, PAIRS } from "./types";
import { ENTRY_TFS } from "./types/mtf";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import DashboardPage from "./pages/DashboardPage";
import ChartsPage from "./pages/ChartsPage";
import MarketPage from "./pages/MarketPage";
import SignalsPage from "./pages/SignalsPage";
import AlertsPage from "./pages/AlertsPage";
import BacktestPage from "./pages/BacktestPage";
import ProfilePage from "./pages/ProfilePage";
import { fmtPrice } from "./components/MtfChart";
import { BLUE, DOWN, UP, WARN, field } from "./components/ui";

const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }

  /* Theme tokens — see context/ThemeContext.tsx. Brand/status colors
     (accent green, danger red, warning yellow) stay constant across
     themes; surface/border/text tokens switch. */
  :root, :root[data-theme="dark"] {
    --bg: #070d17; --bg2: #040a12; --surface: #0c1420; --surface2: #080e18;
    --border: #0a1828; --border2: #0d1a2a;
    --text: #e0eaf5; --text-dim: #4a6080; --text-mute: #2e4060;
    --accent: #00d084; --danger: #ff4757; --warn: #ffd700;
  }
  :root[data-theme="light"] {
    --bg: #f4f6f9; --bg2: #eef1f6; --surface: #ffffff; --surface2: #ffffff;
    --border: #e2e8f0; --border2: #dbe2ea;
    --text: #101828; --text-dim: #5b6b82; --text-mute: #8b98ab;
    --accent: #00a870; --danger: #d92d3f; --warn: #b45309;
  }

  body { background: var(--bg); color: var(--text); font-family: 'IBM Plex Mono', monospace; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
  select option { background: var(--surface2); color: var(--text); }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
  @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
  @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  .nav-item:hover { background: var(--surface) !important; color: var(--text) !important; }
  input:focus, select:focus { border-color: #00d084 !important; box-shadow: 0 0 0 2px #00d08420 !important; outline: none !important; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button:not(:disabled):hover { opacity: 0.85; }
  tr:hover > td { background: var(--surface) !important; }
`;
if (!document.getElementById("nxcss")) {
  const el = document.createElement("style");
  el.id = "nxcss"; el.textContent = css;
  document.head.appendChild(el);
}

export default function App() {
  return <ThemeProvider><AuthProvider><AppRouter /></AuthProvider></ThemeProvider>;
}

function AppRouter() {
  const { auth } = useAuth();
  if (!auth.user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }
  return <Shell />;
}

type Notif = { msg: string; type: "success" | "error" | "info" };

const ROUTES = ["/", "/charts", "/market", "/signals", "/alerts", "/backtest", "/profile"];
function Shell() {
  // reopen on the page you were last on
  const loc = useLocation();
  const go = useNavigate();
  useEffect(() => {
    try {
      const last = localStorage.getItem("cs_route");
      if (loc.pathname === "/" && last && last !== "/" && ROUTES.includes(last)) go(last, { replace: true });
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem("cs_route", loc.pathname); } catch { /* ignore */ } }, [loc.pathname]);
  const [notif, setNotif] = useState<Notif | null>(null);
  const notify = useCallback((msg: string, type: Notif["type"] = "info") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4200);
  }, []);
  return (
    <MtfProvider notify={notify}>
      <Frame notify={notify} notif={notif} />
    </MtfProvider>
  );
}

const NAV: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Dashboard", icon: "◫" },
  { to: "/charts", label: "Charts", icon: "▦" },
  { to: "/market", label: "Market", icon: "◎" },
  { to: "/signals", label: "Signals", icon: "◆" },
  { to: "/alerts", label: "Alerts", icon: "🔔" },
  { to: "/backtest", label: "Backtest", icon: "↺" },
  { to: "/profile", label: "Profile", icon: "☺" },
];

function Frame({ notify, notif }: { notify: (m: string, t?: Notif["type"]) => void; notif: Notif | null }) {
  const mobile = useIsMobile(820);
  const nav = useNavigate();
  const { symbol, setSymbol, entryTf, setEntryTf, entryScan, data, loading, error, refresh, auto, setAuto, unread, updated } = useMtf();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t); }, []);
  const age = updated ? Math.round(clock / 1000 - updated) : null;
  const status = error ? { t: "Feed problem", c: DOWN } : loading && !data ? { t: "Analysing…", c: WARN } : data?.demo ? { t: "Demo data", c: WARN } : data ? { t: age != null ? `Analysis ${age}s ago` : "Live", c: UP } : { t: "Connecting…", c: WARN };
  const chg = data?.changePct;
  const readiness = (t: string) => { const r = entryScan?.rows.find(x => x.tf === t); return r?.state === "SIGNAL" ? (r.type === "SELL" ? DOWN : UP) : r?.state === "SETUP" ? WARN : null; };
  const tfBtn = (t: string) => ({ cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 6, border: `1px solid ${t === entryTf ? BLUE : readiness(t) ?? "var(--border2)"}`, background: t === entryTf ? "#0094ff22" : "transparent", color: t === entryTf ? BLUE : "var(--text-dim)" } as const);

  const top = (
    <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: mobile ? "10px 12px" : "10px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 20 }}>
      {mobile && <b style={{ color: UP, letterSpacing: 2, fontSize: 12 }}>NEXUS</b>}
      <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ ...field, fontWeight: 800, fontSize: 12 }} aria-label="pair">
        {PAIRS.map(p => <option key={p} value={p}>{PAIR_DISPLAY[p] || p}</option>)}
      </select>
      <div style={{ border: "1px solid var(--border2)", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 800 }}>
        {data ? fmtPrice(data.price) : "—"} {chg != null && <span style={{ color: chg >= 0 ? UP : DOWN, fontSize: 10 }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
      </div>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: 1.5 }}>ENTRY TF</span>
        {ENTRY_TFS.map(t => <button key={t} style={tfBtn(t)} title={readiness(t) ? `${t.toUpperCase()} has a signal or setup ready` : undefined} onClick={() => setEntryTf(t)}>{t.toUpperCase()}{readiness(t) && <span style={{ color: readiness(t)!, marginLeft: 3 }}>●</span>}</button>)}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: status.c, fontWeight: 700 }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 7, background: status.c, marginRight: 5, animation: loading ? "pulse 1s infinite" : undefined }} />{status.t}</span>
        <button title={auto ? "Auto-refresh on" : "Auto-refresh off"} onClick={() => setAuto(!auto)} style={{ ...field, cursor: "pointer", color: auto ? UP : "var(--text-dim)" }}>{auto ? "AUTO" : "PAUSED"}</button>
        <button title="Refresh now" aria-label="refresh" onClick={refresh} style={{ ...field, cursor: "pointer" }}>⟳</button>
        <button title="Alerts" aria-label="alerts" onClick={() => nav("/alerts")} style={{ ...field, cursor: "pointer", position: "relative" }}>
          🔔{unread > 0 && <span style={{ position: "absolute", top: -6, right: -6, background: DOWN, color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 800, padding: "1px 5px" }}>{unread > 9 ? "9+" : unread}</span>}
        </button>
      </div>
    </header>
  );

  const linkStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", textDecoration: "none", fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
    color: active ? "var(--text)" : "var(--text-dim)", background: active ? "var(--surface2)" : "transparent", borderLeft: `3px solid ${active ? UP : "transparent"}`,
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      {!mobile && (
        <aside style={{ width: 190, background: "var(--surface)", borderRight: "1px solid var(--border)", position: "sticky", top: 0, height: "100vh", flexShrink: 0 }}>
          <div style={{ padding: "18px 16px", fontWeight: 800, letterSpacing: 3, color: UP, fontSize: 14 }}>NEXUS<span style={{ color: "var(--text)" }}>AI</span><div style={{ fontSize: 8, color: "var(--text-mute)", letterSpacing: 2, marginTop: 3 }}>CRYPTO SIGNALS</div></div>
          {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.to === "/"} className="nav-item" style={({ isActive }) => linkStyle(isActive)}><span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>{n.label}</NavLink>)}
        </aside>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {top}
        <main style={{ padding: mobile ? "12px 12px 80px" : "18px 20px 30px", flex: 1 }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/charts" element={<ChartsPage />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/backtest" element={<BacktestPage notify={notify} />} />
            <Route path="/profile" element={<ProfilePage notify={notify} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      {mobile && (
        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", background: "var(--surface)", borderTop: "1px solid var(--border)", zIndex: 30 }}>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} style={({ isActive }) => ({ flex: 1, textAlign: "center", padding: "8px 0 10px", textDecoration: "none", fontSize: 9, fontWeight: 700, color: isActive ? UP : "var(--text-dim)" })}>
              <div style={{ fontSize: 16 }}>{n.icon}</div>{n.label}
            </NavLink>
          ))}
        </nav>
      )}
      {notif && (
        <div role="status" style={{ position: "fixed", bottom: mobile ? 76 : 22, right: 22, zIndex: 9999, animation: "fadeUp .3s ease", maxWidth: 360, borderRadius: 10, padding: "11px 18px", color: "#000", fontWeight: 700, fontSize: 12, background: notif.type === "success" ? UP : notif.type === "error" ? DOWN : BLUE, boxShadow: "0 8px 32px #00000060" }}>
          {notif.msg}
        </div>
      )}
    </div>
  );
}
