// App.tsx — NexusAI Trading Platform
import { Routes,  Route,  Navigate, useNavigate, NavLink} from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { useWebSocket } from "./hooks/useWebSocket";
import type { Ticker, Bot, Trade, Signal, Strategy, Page, KlineUpdate } from "./types";
import { PAIR_DISPLAY } from "./types";
import { marketApi, signalsApi, botsApi, tradesApi, strategiesApi, accountApi } from "./api/client";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import DashboardPage from "./pages/DashboardPage";
import TradingPage from "./pages/TradingPage";
import SignalsPage from "./pages/SignalsPage";
import BotsPage from "./pages/BotsPage";
import StrategyPage from "./pages/StrategyPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import BotDetails from "./pages/BotsDetails";
import { useLocation } from "react-router-dom";

// ── CSS injection ─────────────────────────────────────────────────────────────
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
  return <MainShell />;
}

// ── Main Shell ────────────────────────────────────────────────────────────────
function MainShell() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
 // const [page, setPage] = useState<Page>("dashboard");
  const [sideOpen, setSideOpen] = useState(window.innerWidth >= 768);
  const [moreOpen, setMoreOpen] = useState(false);
  const [clock, setClock] = useState(new Date().toLocaleTimeString());
  const [notif, setNotif] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
  const location = useLocation();
  // State fed from both HTTP init and WebSocket updates
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [Klines, setKlines] = useState<KlineUpdate[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  // Binance account snapshot for the top bar (equity + live P&L). Polled
  // rather than pushed: /account/summary hits the exchange, so it's on a
  // slow-ish interval of its own instead of riding the 5s ticker socket.
  // A failure here is non-fatal — the pill just shows "offline" and the
  // rest of the app carries on.
  const [account, setAccount] = useState<Awaited<ReturnType<typeof accountApi.summary>> | null>(null);
  useEffect(() => {
    if (!auth.token) { setAccount(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await accountApi.summary(auth.token!);
        if (!cancelled) setAccount(data);
      } catch {
        // Leave the previous snapshot in place rather than blanking the
        // pill on a single transient failure.
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [auth.token]);

  const notify = useCallback((msg: string, type: "success" | "error" | "info" = "info") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3800);
  }, []);

  
  // HTTP initial load
  useEffect(() => {
    if (!auth.token) return;
    Promise.all([
      botsApi.list(auth.token),
      tradesApi.list(auth.token),
      signalsApi.list(auth.token),
      strategiesApi.list(auth.token),
      marketApi.tickers(),
    ]).then(([b, t, s, st, tk]) => {
      setBots(b); setTrades(t); setSignals(s); setStrategies(st); setTickers(tk);
    }).catch(e => notify("Load error: " + e.message, "error"));
  }, [auth.token]);

  // Clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setSideOpen(false);
    } else {
      setSideOpen(true);
    }
  }, [isMobile]);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  // WebSocket
  const { connected } = useWebSocket(auth.token, {
    onTickers: (t) => { setTickers(t); setWsStatus("live"); },
    onBotsUpdate: (b) => setBots(b),
    onNewTrade: (t) => {
      setTrades(prev => [t, ...prev.slice(0, 499)]);
      // "alert when a bot places a trade every time" — there was no
      // notification at all here before, bot or manual, entry or exit.
      // Gated by the Settings > Alerts toggle (defaults on) so it's not
      // forced on someone running several active bots.
      if (t.bot_id && localStorage.getItem("bot_trade_alerts") !== "off") {
        const bot = bots.find(b => b.id === t.bot_id);
        const label = bot ? bot.name : "Bot";
        const pairLabel = PAIR_DISPLAY[t.pair] || t.pair;
        if (t.status === "CLOSED") {
          const pnl = t.pnl || 0;
          notify(`🤖 ${label} closed ${pairLabel} — ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`, pnl >= 0 ? "success" : "error");
        } else {
          notify(`🤖 ${label} placed a ${t.side} on ${pairLabel} @ $${t.price}`, "info");
        }
      }
    },
    onNewSignals: (s) => setSignals(prev => [...s, ...prev].slice(0, 100)),
    onBotError: (data) => notify(data.message, "error"),
    onInit: ({ bots: b, trades: t, signals: s }) => {
      setBots(b); setTrades(t); setSignals(s); setWsStatus("live");
    },
  });

  useEffect(() => {
    if (!connected) setWsStatus(ws => ws === "live" ? "offline" : "connecting");
    else setWsStatus("live");
  }, [connected]);

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const nav: { id: Page; icon: string; label: string }[] = [
    { id: "dashboard", icon: "◈", label: "Dashboard" },
    { id: "trading", icon: "◎", label: "Live Trading" },
    { id: "signals", icon: "◉", label: "Signals" },
    { id: "bots", icon: "⬡", label: "Bots" },
    { id: "strategy", icon: "◇", label: "Strategy" },
    { id: "history", icon: "◫", label: "History" },
    { id: "settings", icon: "⊕", label: "Settings" },
  ];


  // BUG FIX: Strategy and History were commented out of the mobile bottom
  // nav, and the full sidebar (which has all 7 items) is hidden entirely
  // on mobile — so there was literally no way to reach either page on
  // Android/mobile except typing the URL directly. Rather than cram 7
  // icons into one bottom bar, the 5th slot is now a "More" sheet holding
  // everything that doesn't fit, so every page stays reachable.
  const bottomNav: { id: Page; icon: string; label: string }[] = [
    { id: "dashboard", icon: "◈", label: "Dashboard" },
    { id: "trading", icon: "◎", label: "Trading" },
    { id: "signals", icon: "◉", label: "Signals" },
    { id: "bots", icon: "⬡", label: "Bots" },
  ];
  const moreNav: { id: Page; icon: string; label: string }[] = [
    { id: "strategy", icon: "◇", label: "Strategy" },
    { id: "history", icon: "◫", label: "History" },
    { id: "settings", icon: "⊕", label: "Settings" },
  ];


  const pp = { tickers, signals, setSignals, bots, setBots, trades, setTrades, strategies, setStrategies, notify };

  const statusColor = wsStatus === "live" ? "#00d084" : wsStatus === "offline" ? "#ff4757" : "#ffd700";
  const currentPage =
  nav.find((n) => location.pathname === `/${n.id}`)?.label ||
  "Dashboard";
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* ── Sidebar ── */}
      {!isMobile && (
        <aside style={{
          width: sideOpen ? 220 : 58, flexShrink: 0, background: "var(--bg)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width .2s ease", overflow: "hidden"
        }}>
          <div style={{ padding: "16px 10px", display: "flex", alignItems: "center", gap: 9, cursor: "pointer", borderBottom: "1px solid var(--border)", flexShrink: 0 }} onClick={() => setSideOpen(x => !x)}>
            <span style={{ color: "#00d084", fontSize: 22, flexShrink: 0 }}>⬡</span>
            {sideOpen && <span style={{ color: "var(--text)", fontWeight: 900, fontSize: 15, letterSpacing: 3, whiteSpace: "nowrap" }}>NEXUS<span style={{ color: "#00d084" }}>AI</span></span>}
          </div>

          <nav style={{ flex: 1, padding: "8px 6px", overflowY: "auto" }}>
            {nav.map(n => (
              <NavLink
      key={n.id}
      to={`/${n.id}`}
      className="nav-item"
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 9px",
        borderRadius: 7,
        cursor: "pointer",
        marginBottom: 2,
        transition: "all .15s",
        textDecoration: "none",
        color: isActive ? "#00d084" : "var(--text-dim)",
        background: isActive ? "var(--surface)" : "transparent",
        borderLeft: `2px solid ${
          isActive ? "#00d084" : "transparent"
        }`,
      })}
    >
      <span
        style={{
          fontSize: 13,
          width: 18,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {n.icon}
      </span>

      {sideOpen && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {n.label}
        </span>
      )}
    </NavLink>
            ))}
          </nav>

          <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px", flexShrink: 0 }}>
            {sideOpen && <div style={{ color: "var(--text-mute)", fontSize: 10, padding: "5px 9px", cursor: "pointer" }} onClick={logout}>⏻ Sign out</div>}
          </div>
        </aside>
      )}

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Topbar */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 20px", height: 50, borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0 }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>
          {currentPage.toUpperCase()}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: `${statusColor}18`, border: `1px solid ${statusColor}44`, borderRadius: 20, padding: "3px 9px" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, animation: wsStatus === "live" ? "pulse 2s infinite" : "none" }} />
              <span style={{ color: statusColor, fontSize: 9, fontWeight: 700, letterSpacing: 2 }}>{wsStatus.toUpperCase()}</span>
            </div>
            <span style={{ color: "var(--text-mute)", fontSize: 10, fontFamily: "monospace" }}>{clock}</span>
            {/* "add binance balance or p and l for binance account first in
                top bar" — the Binance pill comes BEFORE the demo one so the
                real-money number is what you read first, and it is styled
                differently (gold, explicit LIVE/TEST label) so a real
                balance can never be mistaken for the paper one. Only shown
                once Binance is actually connected. */}
            {account?.broker_connected && (
              <div
                onClick={() => navigate("settings")}
                title={
                  account.live_error
                    ? `Binance unreachable: ${account.live_error}`
                    : `Binance ${account.testnet ? "testnet" : "live"} account equity, and the P&L of live trades placed from this app`
                }
                style={{
                  display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                  background: account.live_error ? "#ff475712" : "#ffd70012",
                  border: `1px solid ${account.live_error ? "#ff475744" : "#ffd70044"}`,
                  borderRadius: 20, padding: "3px 10px",
                }}>
                <span style={{ color: account.testnet ? "#0094ff" : "#ffd700", fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>
                  {account.testnet ? "TEST" : "LIVE"}
                </span>
                {account.live_error ? (
                  <span style={{ color: "#ff4757", fontSize: 10, fontWeight: 700 }}>offline</span>
                ) : (
                  <>
                    <span style={{ color: "var(--text)", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>
                      ${(account.live?.total_equity_usdt ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    {account.live_pnl && (
                      <span style={{
                        color: account.live_pnl.total >= 0 ? "#00d084" : "#ff4757",
                        fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                      }}>
                        {account.live_pnl.total >= 0 ? "+" : ""}{account.live_pnl.total.toFixed(2)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
            {typeof auth.user?.balance === "number" && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: "3px 10px" }} title="Demo (paper) wallet balance — not real money">
                <span style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>DEMO</span>
                <span style={{ color: "#00d084", fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>${auth.user.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }} onClick={() => navigate("settings")} title={auth.user?.email}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#00d084,#0094ff)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, color: "#000", flexShrink: 0 }}>
                {auth.user?.name?.[0]?.toUpperCase()}
              </div>
              {!isMobile && <span style={{ color: "var(--text)", fontSize: 11, fontWeight: 600, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{auth.user?.name}</span>}
            </div>
          </div>
        </header>

        {/* Ticker Tape */}
        {tickers.length > 0 && (
          <div style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", height: 32, overflow: "hidden", display: "flex", alignItems: "center", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 24, padding: "0 14px", animation: "ticker 55s linear infinite", whiteSpace: "nowrap" }}>
              {[...tickers, ...tickers].map((t, i) => (
                <span key={i} style={{ fontSize: 11, display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <span style={{ color: "var(--text)", fontWeight: 700 }}>{PAIR_DISPLAY[t.symbol] || t.symbol}</span>
                  <span style={{ color: "#6080a0" }}>${t.price < 1 ? t.price.toFixed(4) : t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span style={{ color: t.changePct >= 0 ? "#00d084" : "#ff4757", fontWeight: 600 }}>{t.changePct >= 0 ? "▲" : "▼"}{Math.abs(t.changePct).toFixed(2)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "18px 14px 90px" : "18px 20px",
          }}
        > <Routes>
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={<DashboardPage {...pp} />} />
          <Route path="/trading" element={<TradingPage {...pp}/>} />
          <Route path="/signals" element={<SignalsPage {...pp}/>} />
          <Route path="/bots" element={<BotsPage {...pp}/>} />
          <Route path="/strategy" element={<StrategyPage {...pp}/>} />
          <Route path="/history" element={<HistoryPage {...pp} />} />
          <Route path="/settings" element={<SettingsPage {...pp}/>} />
          <Route path="/bot/:id" element={<BotDetails {...pp} />} />
          <Route path="/trading/:pair" element={<TradingPage {...pp} />} />
        </Routes>        </main>

        {/* Mobile Bottom Navigation */}
        {isMobile && (
          <nav
            style={{
              height: 64,
              background: "var(--bg)",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-around",
              alignItems: "center",
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 999,
            }}
          >
            {bottomNav.map((n) => (
                  <NavLink
      key={n.id}
      to={`/${n.id}`}
      style={({ isActive }) => ({
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: isActive ? "#00d084" : "var(--text-dim)",
        fontSize: 11,
        textDecoration: "none",
        flex: 1,
      })}
    >
      <span style={{ fontSize: 18 }}>{n.icon}</span>
      <span>{n.label}</span>
    </NavLink>
            ))}
            <button
              onClick={() => setMoreOpen(x => !x)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                color: moreOpen || moreNav.some(n => location.pathname === `/${n.id}`) ? "#00d084" : "var(--text-dim)",
                fontSize: 11, background: "none", border: "none", fontFamily: "inherit", flex: 1, cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 18 }}>☰</span>
              <span>More</span>
            </button>
          </nav>
        )}

        {/* Mobile "More" sheet — Strategy, History, Settings, Sign out.
            These have no other way to be reached on mobile now that the
            full sidebar is hidden and the bottom bar only fits 4 primary
            tabs + this one. */}
        {isMobile && moreOpen && (
          <>
            <div
              onClick={() => setMoreOpen(false)}
              style={{ position: "fixed", inset: 0, background: "#00000070", zIndex: 998 }}
            />
            <div
              style={{
                position: "fixed", left: 0, right: 0, bottom: 64, zIndex: 999,
                background: "var(--surface2)", borderTop: "1px solid var(--border)",
                borderRadius: "14px 14px 0 0", padding: "10px 8px 14px",
                boxShadow: "0 -8px 32px #00000060",
              }}
            >
              {moreNav.map(n => (
                <NavLink
                  key={n.id}
                  to={`/${n.id}`}
                  style={({ isActive }) => ({
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                    borderRadius: 9, textDecoration: "none",
                    color: isActive ? "#00d084" : "var(--text)",
                    background: isActive ? "var(--surface)" : "transparent",
                    fontSize: 13, fontWeight: 600,
                  })}
                >
                  <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{n.icon}</span>
                  {n.label}
                </NavLink>
              ))}
              <div
                onClick={logout}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 9, color: "var(--text-dim)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>⏻</span>
                Sign out
              </div>
            </div>
          </>
        )}

      </div>

      {/* Notification toast */}
      {notif && (
        <div style={{ position: "fixed", bottom: 22, right: 22, zIndex: 9999, animation: "fadeUp .3s ease", maxWidth: 360, borderRadius: 10, padding: "11px 18px", color: "#000", fontWeight: 700, fontSize: 12, letterSpacing: 0.5, background: notif.type === "success" ? "#00d084" : notif.type === "error" ? "#ff4757" : "#0094ff", boxShadow: "0 8px 32px #00000060" }}>
          {notif.msg}
        </div>
      )}
    </div>
  );
}
