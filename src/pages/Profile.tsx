import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { settingsApi } from "../api/client";
import { useApp } from "../App";
import { useAuth } from "../context/AuthContext";
import TopBar from "../components/TopBar";
import { Card, Err, Pill, Switch } from "../components/ui";
import type { MtfMode, Settings } from "../types";

interface InstallEvt extends Event { prompt: () => Promise<void> }

export default function Profile() {
  const { auth, logout, setUser } = useAuth();
  const { settings, pairs, isAdmin, reloadSettings } = useApp();
  const nav = useNavigate();
  const [token, setToken] = useState(auth.user?.telegram_token ?? ""), [chat, setChat] = useState(auth.user?.telegram_chat_id ?? "");
  const [msg, setMsg] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallEvt | null>(null);
  const [perm, setPerm] = useState<string>(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  useEffect(() => { const h = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvt); }; window.addEventListener("beforeinstallprompt", h); return () => window.removeEventListener("beforeinstallprompt", h); }, []);

  const flash = (m: string) => { setMsg(m); setErr(null); setTimeout(() => setMsg(null), 3500); };
  const wrap = (p: Promise<unknown>, ok: string) => p.then(() => { flash(ok); reloadSettings(); }).catch((e) => { setErr(e.message); setMsg(null); });
  const patch = (p: Partial<Settings>) => wrap(settingsApi.patch(p), "Saved");
  const s = settings;
  const toggleWatch = (p: string) => { if (!s) return; const w = s.watchlist.includes(p) ? s.watchlist.filter((x) => x !== p) : [...s.watchlist, p]; if (w.length) patch({ watchlist: w }); };

  return (
    <>
      <TopBar showEntry={false} />
      <div className="page" style={{ maxWidth: 900 }}>
        {msg && <div className="blocked" style={{ borderColor: "rgba(25,195,125,.4)", color: "var(--green)", background: "rgba(25,195,125,.08)" }}>{msg}</div>}
        <Err msg={err} />
        <Card title="Account">
          <div className="row"><div className="avatar" style={{ width: 46, height: 46 }}>{auth.user?.name?.[0]?.toUpperCase()}</div>
            <div><b>{auth.user?.name}</b> {isAdmin && <Pill tone="gold">admin</Pill>}<div className="muted">{auth.user?.email}</div></div><span className="spacer" />
            <button className="btn danger" onClick={() => { logout(); nav("/"); }}>Sign out</button></div>
        </Card>

        <Card title="Alerts — how you hear about a signal">
          <div className="row" style={{ marginBottom: 10 }}>
            <b>Browser / phone notifications</b><Pill tone={perm === "granted" ? "green" : undefined}>{perm}</Pill><span className="spacer" />
            <button className="btn ghost sm" disabled={perm === "granted" || perm === "unsupported"} onClick={() => Notification.requestPermission().then(setPerm)}>Enable</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>The scanner runs on the server around the clock. When an approved signal fires (and when it hits target, stop or break-even) it appears in the bell, plays a sound while the app is open, and is sent to Telegram below.</div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Telegram bot token</label><input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC…" /></div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}><label>Chat id</label><input className="input" value={chat} onChange={(e) => setChat(e.target.value)} placeholder="123456789" /></div>
            <button className="btn" onClick={() => wrap(settingsApi.telegram(token, chat).then(() => auth.user && setUser({ ...auth.user, telegram_token: token, telegram_chat_id: chat })), "Telegram saved")}>Save</button>
            <button className="btn ghost" onClick={() => wrap(settingsApi.telegramTest(), "Test message sent — check Telegram")}>Send test</button>
          </div>
          <div className="row" style={{ marginTop: 14 }}><b>Send alerts to Telegram</b><span className="spacer" /><Switch on={s?.telegram_alerts ?? true} disabled={!isAdmin} onChange={(v) => patch({ telegram_alerts: v })} /></div>
        </Card>

        <Card title="Install the app">
          <div className="row"><div style={{ flex: 1 }}><b>CryptoSignal works as an installable app</b><div className="muted" style={{ fontSize: 12.5 }}>Opens full-screen from your home screen or desktop. On iPhone use Share → Add to Home Screen.</div></div>
            <button className="btn" disabled={!install} onClick={() => install?.prompt()}>{install ? "Install" : "Use browser menu"}</button></div>
        </Card>

        {s && (
          <Card title="Scanner settings" right={!isAdmin ? <Pill>admin only</Pill> : undefined}>
            <div className="row" style={{ gap: 20 }}>
              <label className="field"><label>Mode</label><select className="select" disabled={!isAdmin} value={s.mode} onChange={(e) => patch({ mode: e.target.value as MtfMode })}><option value="combined">Combined (intraday + scalp)</option><option value="intraday">Intraday only</option><option value="scalp">Scalp only</option></select></label>
              <label className="field"><label>Entry timeframe</label><select className="select" disabled={!isAdmin} value={s.entry_tf} onChange={(e) => patch({ entry_tf: e.target.value })}>{["1m", "3m", "5m", "15m", "30m"].map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="field"><label>Min agreement %</label><input className="input" type="number" min={40} max={100} disabled={!isAdmin} defaultValue={s.min_agree} onBlur={(e) => +e.target.value !== s.min_agree && patch({ min_agree: +e.target.value })} style={{ width: 110 }} /></label>
              <label className="field"><label>Break-even at (R, 0 = off)</label><input className="input" type="number" step="0.25" min={0} max={3} disabled={!isAdmin} defaultValue={s.breakeven_r} onBlur={(e) => +e.target.value !== s.breakeven_r && patch({ breakeven_r: +e.target.value })} style={{ width: 130 }} /></label>
            </div>
            <h3 style={{ margin: "18px 0 8px", fontSize: 11, letterSpacing: 1.4, color: "var(--text-dim)" }}>WATCHLIST — PAIRS THE SCANNER CHECKS</h3>
            <div className="chips">{pairs.map((p) => <button key={p} className={`chip ${s.watchlist.includes(p) ? "on" : ""}`} disabled={!isAdmin} onClick={() => toggleWatch(p)}>{p.replace("USDT", "")}</button>)}</div>
          </Card>
        )}
      </div>
    </>
  );
}
