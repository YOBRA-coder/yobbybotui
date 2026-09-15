// pages/SettingsPage.tsx
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { settingsApi, accountApi } from "../api/client";
import { S } from "./styles";

export default function SettingsPage({ notify }: { notify: (msg: string, type?: "success" | "error" | "info") => void }) {
  const { auth, updateUser } = useAuth();
  const { mode, setMode } = useTheme();
  const [tk, setTk] = useState(auth.user?.telegram_token || "");
  const [ci, setCi] = useState(auth.user?.telegram_chat_id || "");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Broker (Binance) connection
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [useTestnet, setUseTestnet] = useState(true);
  const [brokerTesting, setBrokerTesting] = useState(false);
  const [brokerConnecting, setBrokerConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ can_trade: boolean; balances: any[] } | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof accountApi.summary>> | null>(null);

  // Risk per trade (bots)
  const [riskPct, setRiskPct] = useState(((auth.user?.risk_per_trade ?? 0.08) * 100).toString());
  const [savingRisk, setSavingRisk] = useState(false);

  const [depositing, setDepositing] = useState(false);
  const deposit = async () => {
    if (!auth.token) return;
    setDepositing(true);
    try {
      const res = await accountApi.deposit(auth.token);
      notify(`+$${res.deposited.toLocaleString()} demo funds added`, "success");
      loadSummary();
    } catch (e: any) { notify(e.message, "error"); }
    setDepositing(false);
  };

  // Client-side only — how loud the "bot placed a trade" toasts are.
  // Persisted to localStorage rather than a backend column since it's a
  // pure display preference with nothing else needing to read it.
  const [botAlerts, setBotAlerts] = useState(localStorage.getItem("bot_trade_alerts") !== "off");
  const toggleBotAlerts = () => {
    const next = !botAlerts;
    setBotAlerts(next);
    localStorage.setItem("bot_trade_alerts", next ? "on" : "off");
  };

  const saveRisk = async () => {
    if (!auth.token) return;
    const pct = parseFloat(riskPct);
    if (isNaN(pct) || pct < 1 || pct > 50) { notify("Risk must be between 1% and 50%", "error"); return; }
    setSavingRisk(true);
    try {
      await settingsApi.updateRisk(auth.token, pct / 100);
      updateUser({ risk_per_trade: pct / 100 });
      notify(`Risk per trade set to ${pct}%`, "success");
    } catch (e: any) { notify(e.message, "error"); }
    setSavingRisk(false);
  };

  const loadSummary = async () => {
    if (!auth.token) return;
    try { setSummary(await accountApi.summary(auth.token)); } catch { /* non-fatal, wallet card just stays hidden */ }
  };
  useEffect(() => { loadSummary(); }, [auth.token]);

  const save = async () => {
    if (!auth.token) return;
    setSaving(true);
    try {
      await settingsApi.updateTelegram(auth.token, tk, ci);
      updateUser({ telegram_token: tk, telegram_chat_id: ci });
      notify("Settings saved!", "success");
    } catch (e: any) { notify(e.message, "error"); }
    setSaving(false);
  };

  const test = async () => {
    if (!auth.token) return;
    if (!tk || !ci) { notify("Enter token and chat ID first", "error"); return; }
    // Save first
    await settingsApi.updateTelegram(auth.token, tk, ci).catch(() => {});
    setTesting(true);
    try {
      await settingsApi.testTelegram(auth.token);
      notify("✅ Telegram connected!", "success");
    } catch (e: any) { notify(e.message || "Telegram failed — check credentials", "error"); }
    setTesting(false);
  };

  const testBroker = async () => {
    if (!apiKey || !apiSecret) { notify("Enter your API key and secret first", "error"); return; }
    setBrokerTesting(true);
    setTestResult(null);
    try {
      const result = await settingsApi.testBroker(auth.token!, { api_key: apiKey, api_secret: apiSecret, testnet: useTestnet });
      setTestResult(result);
      notify(`✅ Connected — ${useTestnet ? "Binance Testnet" : "Binance Live"}`, "success");
    } catch (e: any) {
      notify(e.message || "Could not connect to Binance", "error");
    }
    setBrokerTesting(false);
  };

  const connectBroker = async () => {
    if (!auth.token || !testResult) return;
    setBrokerConnecting(true);
    try {
      await settingsApi.connectBroker(auth.token, { api_key: apiKey, api_secret: apiSecret, testnet: useTestnet });
      notify("Binance connected — you can now switch bots to LIVE mode", "success");
      setApiKey(""); setApiSecret(""); setTestResult(null);
      loadSummary();
    } catch (e: any) {
      notify(e.message, "error");
    }
    setBrokerConnecting(false);
  };

  const disconnectBroker = async () => {
    if (!auth.token || !confirm("Disconnect Binance? Any bots currently in LIVE mode will be stopped.")) return;
    try {
      await settingsApi.disconnectBroker(auth.token);
      notify("Binance disconnected", "info");
      loadSummary();
    } catch (e: any) { notify(e.message, "error"); }
  };

  return (
    <div style={{ maxWidth: 580, animation: "fadeUp .3s ease" }}>
      <div style={S.card}>
        <div style={S.ch}>Account</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <div style={S.fg}><label style={S.lbl}>Name</label><input style={{ ...S.inp, opacity: 0.6 }} value={auth.user?.name || ""} disabled /></div>
          <div style={S.fg}><label style={S.lbl}>Email</label><input style={{ ...S.inp, opacity: 0.6 }} value={auth.user?.email || ""} disabled /></div>
        </div>
      </div>

      {summary && (
        <div style={{ ...S.card, marginTop: 13 }}>
          <div style={S.ch}>Wallet</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 9, padding: 13 }}>
              <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>DEMO BALANCE</div>
              <div style={{ color: "var(--text)", fontSize: 20, fontWeight: 800, marginTop: 5 }}>${summary.demo_balance.toLocaleString()}</div>
              <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 3 }}>Virtual — for practicing strategies, no real funds</div>
              <button
                style={{ ...S.btnO, width: "auto", padding: "6px 12px", fontSize: 11, marginTop: 9 }}
                onClick={deposit}
                disabled={depositing || !summary.deposit_available}
              >
                {depositing
                  ? "Adding..."
                  : summary.deposit_available
                    ? `+ Add $${summary.deposit_amount.toLocaleString()} Demo Funds`
                    : summary.demo_balance >= 250000
                      ? "Demo balance at cap"
                      : `Next top-up in ${Math.max(0, Math.ceil((summary.deposit_available_at - Date.now() / 1000) / 60))}m`}
              </button>
              <div style={{ color: "var(--text-mute)", fontSize: 9, marginTop: 5 }}>
                A low demo balance silently blocks bots from sizing new positions — top up here if a bot seems stuck.
              </div>
            </div>
            <div style={{ background: "var(--bg2)", border: `1px solid ${summary.broker_connected ? "#00d08433" : "var(--border)"}`, borderRadius: 9, padding: 13 }}>
              <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>
                BINANCE {summary.broker_connected ? (summary.testnet ? "(TESTNET)" : "(LIVE)") : ""}
              </div>
              {!summary.broker_connected && <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 5 }}>Not connected</div>}
              {summary.broker_connected && summary.live && (
                <>
                  <div style={{ color: "#00d084", fontSize: 20, fontWeight: 800, marginTop: 5 }}>${summary.live.total_equity_usdt.toFixed(2)}</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 3 }}>Real account equity, estimated in USDT</div>
                </>
              )}
              {summary.broker_connected && summary.live_error && (
                <div style={{ color: "#ff4757", fontSize: 10, marginTop: 5 }}>{summary.live_error}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ ...S.card, marginTop: 13 }}>
        <div style={S.ch}>◎ Bot Risk Per Trade</div>
        <p style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 12, lineHeight: 1.6 }}>
          What fraction of a bot's allocated capital it risks on each position it opens. Applies to every bot you run — DEMO and LIVE alike.
        </p>
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <input style={{ ...S.inp, width: 90 }} type="number" min={1} max={50} value={riskPct} onChange={e => setRiskPct(e.target.value)} />
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>%</span>
          <button style={{ ...S.btn, width: "auto", padding: "9px 18px" }} onClick={saveRisk} disabled={savingRisk}>
            {savingRisk ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div style={{ ...S.card, marginTop: 13 }}>
        <div style={S.ch}>◐ Appearance</div>
        <p style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 12, lineHeight: 1.6 }}>
          Auto follows your device's system setting.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {([{ v: "auto" as const, l: "🌓 Auto" }, { v: "dark" as const, l: "🌙 Dark" }, { v: "light" as const, l: "☀️ Light" }]).map(o => (
            <button
              key={o.v}
              onClick={() => setMode(o.v)}
              style={{
                flex: 1, padding: "9px 6px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                background: mode === o.v ? "#00d08418" : "transparent",
                border: `1px solid ${mode === o.v ? "#00d084" : "var(--border2)"}`,
                color: mode === o.v ? "#00d084" : "var(--text-dim)",
              }}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...S.card, marginTop: 13 }}>
        <div style={S.ch}>🔔 Alerts</div>
        <p style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 12, lineHeight: 1.6 }}>
          Show a toast notification every time any of your bots places or closes a trade.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 12 }}>
          <input type="checkbox" checked={botAlerts} onChange={toggleBotAlerts} />
          Alert me when a bot places a trade
        </label>
      </div>

      <div style={{ ...S.card, marginTop: 13 }}>
        <div style={S.ch}>◈ Binance Connection</div>
        <p style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 14, lineHeight: 1.7 }}>
          Connect your own Binance account to switch bots from DEMO to LIVE mode — trades then execute for real, on
          your account, with your funds. We never hold or custody your money; your API key stays encrypted and only
          ever talks to Binance directly on your behalf.<br /><br />
          <b style={{ color: "#ffd700" }}>Defaults to Testnet</b> — Binance's own sandbox with fake funds, so you can
          verify everything works before ever risking real money. Uncheck "Use Testnet" only when you're ready to
          go live with real funds.
        </p>

        {summary?.broker_connected ? (
          <div>
            <p style={{ color: "#00d084", fontSize: 12, marginBottom: 10 }}>
              ✓ Connected {summary.testnet ? "to Binance Testnet" : "to Binance Live"}
            </p>
            <button style={S.danger} onClick={disconnectBroker}>Disconnect Binance</button>
          </div>
        ) : (
          <>
            <div style={S.fg}><label style={S.lbl}>API Key</label><input style={S.inp} value={apiKey} onChange={e => { setApiKey(e.target.value); setTestResult(null); }} placeholder="Binance API key" /></div>
            <div style={S.fg}><label style={S.lbl}>API Secret</label><input style={S.inp} type="password" value={apiSecret} onChange={e => { setApiSecret(e.target.value); setTestResult(null); }} placeholder="Binance API secret" /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 12, margin: "8px 0 14px" }}>
              <input type="checkbox" checked={useTestnet} onChange={e => { setUseTestnet(e.target.checked); setTestResult(null); }} />
              Use Testnet (recommended — no real funds at risk)
            </label>

            {testResult && (
              <div style={{ background: "var(--bg2)", border: "1px solid #00d08433", borderRadius: 8, padding: 11, marginBottom: 12, fontSize: 11 }}>
                <div style={{ color: "#00d084", marginBottom: 6 }}>✓ Connection verified — can trade: {testResult.can_trade ? "yes" : "no"}</div>
                {testResult.balances.length === 0 && <div style={{ color: "var(--text-dim)" }}>No balances on this account yet.</div>}
                {testResult.balances.slice(0, 6).map((b: any) => (
                  <div key={b.asset} style={{ color: "var(--text-dim)" }}>{b.asset}: {b.free} free, {b.locked} locked</div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 9 }}>
              <button style={S.btnO} onClick={testBroker} disabled={brokerTesting}>{brokerTesting ? "Testing..." : "Test Connection"}</button>
              <button style={S.btn} onClick={connectBroker} disabled={!testResult || brokerConnecting}>
                {brokerConnecting ? "Connecting..." : "Save & Connect"}
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ ...S.card, marginTop: 13 }}>
        <div style={S.ch}>✈ Telegram Integration</div>
        <p style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 14, lineHeight: 1.7 }}>
          Connect Telegram to receive real-time trading signals.<br />
          1. Create bot via <span style={{ color: "#00d084" }}>@BotFather</span><br />
          2. Get your chat ID from <span style={{ color: "#00d084" }}>@userinfobot</span><br />
          3. Add bot to your channel as admin (for channels)
        </p>
        <div style={S.fg}><label style={S.lbl}>Bot Token</label><input style={S.inp} value={tk} onChange={e => setTk(e.target.value)} placeholder="1234567890:AABBB..." /></div>
        <div style={S.fg}><label style={S.lbl}>Chat ID or @channel</label><input style={S.inp} value={ci} onChange={e => setCi(e.target.value)} placeholder="-1001234567890 or @mychannel" /></div>
        <div style={{ display: "flex", gap: 9, marginTop: 4 }}>
          <button style={S.btn} onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</button>
          <button style={S.btnO} onClick={test} disabled={testing}>{testing ? "Testing..." : "Test Connection"}</button>
        </div>
      </div>

     
    </div>
  );
}
