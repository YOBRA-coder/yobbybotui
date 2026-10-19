// pages/ProfilePage.tsx — account, alerts (in-app + Telegram), strategy defaults, theme.
import { useEffect, useState } from "react";
import { mtfApi, settingsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useMtf } from "../context/MtfContext";
import { useTheme } from "../context/ThemeContext";
import { SENS_HINT } from "../types/mtf";
import type { EngineConfig, MtfMode, Sens } from "../types/mtf";
import { pwa } from "../pwa";
import { BLUE, UP, card, cardHead, field } from "../components/ui";

export default function ProfilePage({ notify }: { notify: (m: string, t?: "success" | "error" | "info") => void }) {
  const { auth, logout, updateUser } = useAuth();
  const { prefs, setPrefs, mode, setMode, minAgree, setMinAgree, sens, setSens, consensus, setConsensus, weighting, setWeighting } = useMtf();
  type Adv = Pick<EngineConfig, "rr_intraday" | "rr_scalp" | "sl_buffer" | "gate_sweep" | "gate_killzone" | "risk_guard" | "max_chase_atr" | "min_room_rr" | "max_risk_pct" | "rsi_guard" | "vol_guard" | "avoid_weekend" | "gate_amd">;
  const ADV_KEYS: (keyof Adv)[] = ["rr_intraday", "rr_scalp", "sl_buffer", "gate_sweep", "gate_killzone", "risk_guard", "max_chase_atr", "min_room_rr", "max_risk_pct", "rsi_guard", "vol_guard", "avoid_weekend", "gate_amd"];
  const [adv, setAdv] = useState<Adv>({ rr_intraday: null, rr_scalp: null, sl_buffer: null, gate_sweep: null, gate_killzone: null, risk_guard: null, max_chase_atr: null, min_room_rr: null, max_risk_pct: null, rsi_guard: null, vol_guard: null, avoid_weekend: null, gate_amd: null });
  const { engine, refreshEngine, refresh } = useMtf();
  const [, pwaTick] = useState(0);
  useEffect(() => pwa.subscribe(() => pwaTick(x => x + 1)), []);
  const [saved, setSaved] = useState(false);
  useEffect(() => { mtfApi.engine().then(r => setAdv(Object.fromEntries(ADV_KEYS.map(k => [k, r.config[k] ?? null])) as Adv)).catch(() => undefined); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const dropProfile = async (sym: string) => {
    if (!auth.token) return;
    try { await mtfApi.saveProfile(auth.token, sym, null); await refreshEngine(); refresh(); notify(`Tuned settings for ${sym} removed`, "success"); }
    catch (e: any) { notify(e?.message || "Could not remove", "error"); }
  };
  const nfield = (k: "max_chase_atr" | "min_room_rr" | "max_risk_pct" | "rr_intraday" | "rr_scalp" | "sl_buffer", ph: string) => (
    <input style={{ ...field, width: 70 }} inputMode="decimal" placeholder={ph} value={num(adv[k])} onChange={e => setAdv({ ...adv, [k]: e.target.value === "" ? null : +e.target.value })} />
  );
  const saveAdv = async () => {
    if (!auth.token) return;
    try { await mtfApi.saveEngine(auth.token, adv); setSaved(true); setTimeout(() => setSaved(false), 2500); notify("Engine settings saved — the scanner now uses them", "success"); }
    catch (e: any) { notify(e?.message || "Could not save", "error"); }
  };
  const num = (v: number | null) => (v == null ? "" : String(v));
  const { mode: theme, setMode: setTheme } = useTheme();
  const [tok, setTok] = useState(auth.user?.telegram_token || "");
  const [chat, setChat] = useState(auth.user?.telegram_chat_id || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!auth.token) return;
    setBusy(true);
    try { await settingsApi.updateTelegram(auth.token, tok.trim(), chat.trim()); updateUser({ telegram_token: tok.trim(), telegram_chat_id: chat.trim() }); notify("Telegram saved", "success"); }
    catch (e: any) { notify(e?.message || "Could not save", "error"); } finally { setBusy(false); }
  };
  const test = async () => {
    if (!auth.token) return;
    try { await settingsApi.testTelegram(auth.token); notify("Test message sent", "success"); } catch (e: any) { notify(e?.message || "Test failed", "error"); }
  };
  const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 12, gap: 10 } as const;
  const toggle = (k: keyof typeof prefs, label: string) => (
    <label style={row}><span>{label}</span><input type="checkbox" checked={prefs[k]} onChange={async e => {
      if (k === "desktop" && e.target.checked && typeof Notification !== "undefined" && Notification.permission !== "granted") {
        if ((await Notification.requestPermission()) !== "granted") { notify("Desktop notifications were blocked by the browser", "error"); return; }
      }
      setPrefs({ ...prefs, [k]: e.target.checked });
    }} /></label>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 14, alignItems: "start" }}>
      <div style={card}>
        <div style={cardHead}>Account</div>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{auth.user?.name}</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>{auth.user?.email}</div>
        <button style={{ ...field, cursor: "pointer" }} onClick={logout}>Sign out</button>
        <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 12, lineHeight: 1.5 }}>NexusAI shows trade ideas only. It never places orders and holds no exchange keys. Signals are not financial advice and losses are normal — size every trade so a stop-out is small.</div>
      </div>
      <div style={card}>
        <div style={cardHead}>Alerts</div>
        {toggle("toast", "Pop-up on new signal")}{toggle("sound", "Sound")}{toggle("desktop", "Desktop notification")}
        <div style={{ ...cardHead, marginTop: 16 }}>Telegram</div>
        <input value={tok} onChange={e => setTok(e.target.value)} placeholder="Bot token (from @BotFather)" style={{ ...field, width: "100%", marginBottom: 8 }} />
        <input value={chat} onChange={e => setChat(e.target.value)} placeholder="Your chat id" style={{ ...field, width: "100%", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...field, cursor: "pointer", color: UP }} disabled={busy} onClick={save}>Save</button>
          <button style={{ ...field, cursor: "pointer", color: BLUE }} onClick={test}>Send test</button>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 8 }}>New signals and their WIN / LOSS result are pushed once each.</div>
      </div>
      <div style={card}>
        <div style={cardHead}>App · install &amp; notifications</div>
        <div style={row}><span>{pwa.isInstalled() ? "Installed on this device ✓" : pwa.canInstall() ? "Install as an app (full screen, home-screen icon)" : pwa.isIos() ? "iPhone / iPad: tap Share → Add to Home Screen" : "Install: use your browser's menu → Install app / Add to Home screen"}</span>
          {pwa.canInstall() && <button style={{ ...field, cursor: "pointer", color: UP }} onClick={() => pwa.install()}>Install</button>}</div>
        <div style={row}><span>Phone notifications for new signals<div style={{ fontSize: 9.5, color: "var(--text-mute)", maxWidth: 260 }}>Works while the app is open or in the background. For alerts when it is fully closed, connect Telegram below.</div></span>
          <button style={{ ...field, cursor: "pointer", color: BLUE }} onClick={async () => {
            if (typeof Notification === "undefined") { notify("This browser has no notification support", "error"); return; }
            if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") { notify("Notifications were blocked — allow them in the browser's site settings", "error"); return; }
            setPrefs({ ...prefs, desktop: true });
            (await pwa.notify("NexusAI", "Notifications are on — you'll see new signals here.")) || notify("Could not show a notification", "error");
          }}>Enable &amp; test</button></div>
      </div>
      <div style={card}>
        <div style={cardHead}>Engine · how signals are found</div>
        <label style={row}><span>Sensitivity<div style={{ fontSize: 9.5, color: "var(--text-mute)", maxWidth: 260 }}>{SENS_HINT[sens]}</div></span>
          <select value={sens} onChange={e => setSens(e.target.value as Sens)} style={field}><option value="strict">Strict</option><option value="balanced">Balanced</option><option value="fast">Fast</option></select></label>
        <label style={row}><span>Hold back signals the strategy vote disagrees with</span><input type="checkbox" checked={consensus} onChange={e => setConsensus(e.target.checked)} /></label>
        <label style={row}><span>Give the best recent strategy 3× weight</span><input type="checkbox" checked={weighting === "best"} onChange={e => setWeighting(e.target.checked ? "best" : "equal")} /></label>
        <div style={{ ...cardHead, marginTop: 14 }}>Advanced (blank = default)</div>
        <label style={row}><span>Safe entry (hold back risky entries)<div style={{ fontSize: 9.5, color: "var(--text-mute)", maxWidth: 260 }}>Rates every entry LOW / MEDIUM / HIGH risk: chasing price, oversized candle, little room, exhausted RSI…</div></span>
          <select value={adv.risk_guard == null ? "" : String(adv.risk_guard)} onChange={e => setAdv({ ...adv, risk_guard: e.target.value === "" ? null : +e.target.value })} style={field}>
            <option value="">Auto (by sensitivity)</option><option value="0">Off (only rate)</option><option value="1">Block HIGH risk</option><option value="2">Block MEDIUM and HIGH</option></select></label>
        <label style={row}><span>Max distance from the zone (× ATR)</span>{nfield("max_chase_atr", "1.5")}</label>
        <label style={row}><span>Minimum room to the next level (R)</span>{nfield("min_room_rr", "1.5")}</label>
        <label style={row}><span>Widest stop allowed (% of price)</span>{nfield("max_risk_pct", "6")}</label>
        <label style={row}><span>Skip exhausted RSI (&gt;76 buys / &lt;24 sells)</span><input type="checkbox" checked={!!adv.rsi_guard} onChange={e => setAdv({ ...adv, rsi_guard: e.target.checked })} /></label>
        <label style={row}><span>Skip volatility spikes (ATR &gt; 2× normal)</span><input type="checkbox" checked={!!adv.vol_guard} onChange={e => setAdv({ ...adv, vol_guard: e.target.checked })} /></label>
        <label style={row}><span>Don't trade against the AMD session read (Asia raid → expected move)</span><input type="checkbox" checked={!!adv.gate_amd} onChange={e => setAdv({ ...adv, gate_amd: e.target.checked })} /></label>
        <label style={row}><span>Avoid weekends (thin liquidity)</span><input type="checkbox" checked={!!adv.avoid_weekend} onChange={e => setAdv({ ...adv, avoid_weekend: e.target.checked })} /></label>
        <label style={row}><span>Intraday target (R)</span><input style={{ ...field, width: 70 }} inputMode="decimal" placeholder="2.0" value={num(adv.rr_intraday)} onChange={e => setAdv({ ...adv, rr_intraday: e.target.value === "" ? null : +e.target.value })} /></label>
        <label style={row}><span>Scalp target (R)</span><input style={{ ...field, width: 70 }} inputMode="decimal" placeholder="1.5" value={num(adv.rr_scalp)} onChange={e => setAdv({ ...adv, rr_scalp: e.target.value === "" ? null : +e.target.value })} /></label>
        <label style={row}><span>Stop buffer (× ATR beyond the zone)</span><input style={{ ...field, width: 70 }} inputMode="decimal" placeholder="0.25" value={num(adv.sl_buffer)} onChange={e => setAdv({ ...adv, sl_buffer: e.target.value === "" ? null : +e.target.value })} /></label>
        <label style={row}><span>Require a liquidity sweep</span><input type="checkbox" checked={!!adv.gate_sweep} onChange={e => setAdv({ ...adv, gate_sweep: e.target.checked })} /></label>
        <label style={row}><span>Only inside London / New York kill zones</span><input type="checkbox" checked={!!adv.gate_killzone} onChange={e => setAdv({ ...adv, gate_killzone: e.target.checked })} /></label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button style={{ ...field, cursor: "pointer", color: UP }} onClick={saveAdv}>Save advanced</button>{saved && <span style={{ fontSize: 10, color: UP }}>saved</span>}
        </div>
        {engine && Object.keys(engine.profiles || {}).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={cardHead}>Tuned pairs (from the Backtest optimizer)</div>
            {Object.entries(engine.profiles).map(([sym, p]) => (
              <div key={sym} style={{ ...row, fontSize: 11 }}>
                <span><b>{sym}</b> <span style={{ color: "var(--text-dim)" }}>{p.sens ?? ""}{p.min_agree ? ` · ≥${p.min_agree}%` : ""}{p.rr_intraday ? ` · ${p.rr_intraday}R` : p.rr_scalp ? ` · ${p.rr_scalp}R` : ""}{p.risk_guard != null ? ` · guard ${p.risk_guard}` : ""}{p.tuned_at ? ` · ${new Date(p.tuned_at * 1000).toLocaleDateString()}` : ""}</span></span>
                <button style={{ ...field, cursor: "pointer", color: "#ff4757" }} onClick={() => dropProfile(sym)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginTop: 8, lineHeight: 1.5 }}>Sensitivity, style and the vote options are saved to the server automatically, so the scanner that sends your Telegram alerts uses the same rules as the screen.</div>
      </div>
      <div style={card}>
        <div style={cardHead}>Strategy &amp; look</div>
        <label style={row}><span>Style</span><select value={mode} onChange={e => setMode(e.target.value as MtfMode)} style={field}><option value="combined">Combined (intraday + scalp)</option><option value="intraday">Intraday 4H→1H</option><option value="scalp">Scalp 1H→15M</option></select></label>
        <label style={row}><span>Minimum agreement</span><select value={minAgree} onChange={e => setMinAgree(+e.target.value)} style={field}>{[60, 65, 70, 75, 80, 85].map(v => <option key={v} value={v}>{v}%</option>)}</select></label>
        <label style={row}><span>Theme</span><select value={theme} onChange={e => setTheme(e.target.value as typeof theme)} style={field}><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
      </div>
    </div>
  );
}
