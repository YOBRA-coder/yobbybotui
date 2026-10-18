// components/PwaBar.tsx — slim banner for: offline, a new version is ready, install the app.
import { useEffect, useState } from "react";
import { pwa } from "../pwa";
import { BLUE, UP, WARN } from "./ui";

export default function PwaBar() {
  const [, tick] = useState(0);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [hideInstall, setHideInstall] = useState(() => { try { return localStorage.getItem("cs_hide_install") === "1"; } catch { return false; } });
  useEffect(() => pwa.subscribe(() => tick(x => x + 1)), []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const bar = (color: string, children: React.ReactNode) => (
    <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "6px 12px", fontSize: 11.5, background: `${color}22`, borderBottom: `1px solid ${color}66`, color: "var(--text)" }}>{children}</div>
  );
  const b = (c: string): React.CSSProperties => ({ cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: `1px solid ${c}`, background: "transparent", color: c });
  if (!online) return bar(WARN, <span>⚠ You're offline — showing the last data on this device. Live prices and new signals resume when you're back online.</span>);
  if (pwa.updateReady()) return bar(UP, <><span>A new version of the app is ready.</span><button style={b(UP)} onClick={() => pwa.applyUpdate()}>Reload</button></>);
  if (pwa.canInstall() && !hideInstall) {
    return bar(BLUE, <>
      <span>Install NexusAI on this device for a full-screen app and signal notifications.</span>
      <button style={b(BLUE)} onClick={() => pwa.install()}>Install</button>
      <button style={{ ...b("var(--text-dim)"), border: "none" }} onClick={() => { setHideInstall(true); try { localStorage.setItem("cs_hide_install", "1"); } catch { /* ignore */ } }}>Not now</button>
    </>);
  }
  return null;
}
