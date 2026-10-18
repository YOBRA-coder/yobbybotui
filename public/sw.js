/* NexusAI service worker — makes the app installable and keeps the shell working offline.
 *  - the page and its hashed /assets/* files are cached, so the app opens with no network
 *  - API calls and other origins are NEVER cached (signals must be live; the app shows its own offline state)
 *  - a new version installs in the background; the page offers a "Reload" when it is ready
 */
const VERSION = "nexus-v3";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS).catch(() => undefined)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // exchange / news / backend on another origin: network only
  if (url.pathname.startsWith("/api/")) return;                    // same-origin API proxy: network only

  // page loads: network first, fall back to the cached shell, then to the offline page
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("/index.html", copy)); return res; })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/offline.html"))),
    );
    return;
  }
  // hashed build files never change: cache first
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }
  // everything else static (icons, manifest): stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    }),
  );
});

// tapping a notification opens / focuses the app
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/signals";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate?.(target); return c.focus(); } }
      return self.clients.openWindow(target);
    }),
  );
});
