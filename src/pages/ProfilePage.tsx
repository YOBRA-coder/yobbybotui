// pages/ProfilePage.tsx — account, alerts (in-app + Telegram), strategy defaults, theme.
import { useEffect, useState } from "react";
import { mtfApi, settingsApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useMtf } from "../context/MtfContext";
import { useTheme } from "../context/ThemeContext";
import { SENS_HINT } from "../types/mtf";
import type { EngineConfig, MtfMode, Sens } from "../types/mtf";
import { BLUE, UP, card, cardHead, field } from "../components/ui";

export default function ProfilePage({ notify }: { notify: (m: string, t?: "success" | "error" | "info") => void }) {
  const { auth, logout, updateUser } = useAuth();
  const { prefs, setPrefs, mode, setMode, minAgree, setMinAgree, sens, setSens, consensus, setConsensus, weighting, setWeighting } = useMtf();
  const [adv, setAdv] = useState<Pick<EngineConfig, "rr_intraday" | "rr_scalp" | "sl_buffer" | "gate_sweep" | "gate_killzone">>({ rr_intraday: null, rr_scalp: null, sl_buffer: null, gate_sweep: null, gate_killzone: null });
  const [saved, setSaved] = useState(false);
  useEffect(() => { mtfApi.engine().then(r => setAdv({ rr_intraday: r.config.rr_intraday, rr_scalp: r.config.rr_scalp, sl_buffer: r.config.sl_buffer, gate_sweep: r.config.gate_sweep, gate_killzone: r.config.gate_killzone })).catch(() => undefined); }, []);
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
        <div style={cardHead}>Engine · how signals are found</div>
        <label style={row}><span>Sensitivity<div style={{ fontSize: 9.5, color: "var(--text-mute)", maxWidth: 260 }}>{SENS_HINT[sens]}</div></span>
          <select value={sens} onChange={e => setSens(e.target.value as Sens)} style={field}><option value="strict">Strict</option><option value="balanced">Balanced</option><option value="fast">Fast</option></select></label>
        <label style={row}><span>Hold back signals the strategy vote disagrees with</span><input type="checkbox" checked={consensus} onChange={e => setConsensus(e.target.checked)} /></label>
        <label style={row}><span>Give the best recent strategy 3× weight</span><input type="checkbox" checked={weighting === "best"} onChange={e => setWeighting(e.target.checked ? "best" : "equal")} /></label>
        <div style={{ ...cardHead, marginTop: 14 }}>Advanced (blank = default)</div>
        <label style={row}><span>Intraday target (R)</span><input style={{ ...field, width: 70 }} inputMode="decimal" placeholder="2.0" value={num(adv.rr_intraday)} onChange={e => setAdv({ ...adv, rr_intraday: e.target.value === "" ? null : +e.target.value })} /></label>
        <label style={row}><span>Scalp target (R)</span><input style={{ ...field, width: 70 }} inputMode="decimal" placeholder="1.5" value={num(adv.rr_scalp)} onChange={e => setAdv({ ...adv, rr_scalp: e.target.value === "" ? null : +e.target.value })} /></label>
        <label style={row}><span>Stop buffer (× ATR beyond the zone)</span><input style={{ ...field, width: 70 }} inputMode="decimal" placeholder="0.25" value={num(adv.sl_buffer)} onChange={e => setAdv({ ...adv, sl_buffer: e.target.value === "" ? null : +e.target.value })} /></label>
        <label style={row}><span>Require a liquidity sweep</span><input type="checkbox" checked={!!adv.gate_sweep} onChange={e => setAdv({ ...adv, gate_sweep: e.target.checked })} /></label>
        <label style={row}><span>Only inside London / New York kill zones</span><input type="checkbox" checked={!!adv.gate_killzone} onChange={e => setAdv({ ...adv, gate_killzone: e.target.checked })} /></label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button style={{ ...field, cursor: "pointer", color: UP }} onClick={saveAdv}>Save advanced</button>{saved && <span style={{ fontSize: 10, color: UP }}>saved</span>}
        </div>
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
