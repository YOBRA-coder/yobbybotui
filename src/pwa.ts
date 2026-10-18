// pwa.ts — service-worker registration, "install app" prompt and update detection (tiny event bus, no dependencies).
type Listener = () => void;
const listeners = new Set<Listener>();
let deferred: any = null;
let waiting: ServiceWorker | null = null;
let installed = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);
const emit = () => listeners.forEach(l => l());

export const pwa = {
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  canInstall: () => !!deferred && !installed,
  isInstalled: () => installed,
  updateReady: () => !!waiting,
  isIos: () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !installed,
  async install(): Promise<boolean> {
    if (!deferred) return false;
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    deferred = null; emit();
    return choice?.outcome === "accepted";
  },
  applyUpdate() { waiting?.postMessage("SKIP_WAITING"); },
  /** show a notification through the service worker (the only way that works on Android Chrome) */
  async notify(title: string, body: string, url = "/signals"): Promise<boolean> {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png", tag: title + body, data: { url } }); return true; }
      new Notification(title, { body, icon: "/icons/icon-192.png" });
      return true;
    } catch { return false; }
  },
};

export function initPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener("appinstalled", () => { installed = true; deferred = null; emit(); });
  if (!("serviceWorker" in navigator) || !(import.meta as any).env?.PROD) return;   // dev server: no caching surprises
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      const track = (sw: ServiceWorker | null) => {
        if (!sw) return;
        sw.addEventListener("statechange", () => { if (sw.state === "installed" && navigator.serviceWorker.controller) { waiting = sw; emit(); } });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; emit(); }
      reg.addEventListener("updatefound", () => track(reg.installing));
      setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);       // look for a new version hourly
    }).catch(() => undefined);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded && waiting) { reloaded = true; window.location.reload(); } });
  };
  // after the page has loaded (so caching never competes with first paint) — but don't wait forever on a slow font / image
  if (document.readyState === "complete") start();
  else { window.addEventListener("load", start); setTimeout(start, 4000); }
}
