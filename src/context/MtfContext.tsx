// context/MtfContext.tsx — the app's single source of truth for "what the market is saying".
// Holds the chosen pair / style / entry timeframe, polls the top-down analysis, the
// all-pairs scanner and the stored-signal feed, and raises alerts (toast, bell, sound,
// desktop notification) when a NEW signal fires — on whichever page you are looking at.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { mtfApi } from "../api/client";
import { pwa } from "../pwa";
import { useAuth } from "./AuthContext";
import { SENS_AGREE } from "../types/mtf";
import type { EngineConfig, EngineProfile, EntryScan, LayerKey, MtfMode, MtfResponse, MtfSignalRow, MtfSignalStats, NewsItem, ScannerRow, Sens } from "../types/mtf";

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  ob: true, fvg: true, sd: true, poi: true, bos: true, choch: true, swings: true, eq: true, sweep: true, retest: true, trend: true, pd: false, amd: true, ote: true, brk: true, plan: true, volume: false, signals: true, news: true,
};
export interface Prefs { toast: boolean; sound: boolean; desktop: boolean }
const DEFAULT_PREFS: Prefs = { toast: true, sound: true, desktop: false };

export function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      if (!s) return init;
      const parsed = JSON.parse(s);
      return (init !== null && typeof init === "object" && !Array.isArray(init) ? { ...init, ...parsed } : parsed) as T;
    } catch { return init; }
  });
  const set = useCallback((x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* storage unavailable */ } }, [key]);
  return [v, set];
}

export function beep(kind: "buy" | "sell" | "win" | "loss" = "buy") {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const notes = kind === "buy" ? [660, 880] : kind === "sell" ? [660, 440] : kind === "win" ? [523, 659, 784] : [392, 294];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t); o.stop(t + 0.16);
    });
  } catch { /* no audio available */ }
}

export type EventKind = "signal" | "result" | "state" | "info";
export interface ActivityEvent { id: string; t: number; kind: EventKind; symbol: string; text: string; tone: "up" | "down" | "warn" | "info" }

interface Ctx {
  symbol: string; setSymbol: (s: string) => void;
  entryTf: string; setEntryTf: (s: string) => void;
  mode: MtfMode; setMode: (m: MtfMode) => void;
  minAgree: number; setMinAgree: (n: number) => void;
  layers: Record<LayerKey, boolean>; setLayers: (l: Record<LayerKey, boolean>) => void;
  prefs: Prefs; setPrefs: (p: Prefs) => void;
  auto: boolean; setAuto: (b: boolean) => void;
  history: number; setHistory: (n: number) => void;
  engine: EngineConfig | null; refreshEngine: () => Promise<void>;
  useProfile: boolean; setUseProfile: (b: boolean) => void; profile: EngineProfile | null;
  sens: Sens; setSens: (s: Sens) => void; consensus: boolean; setConsensus: (b: boolean) => void;
  weighting: "equal" | "best"; setWeighting: (w: "equal" | "best") => void;
  entryScan: EntryScan | null; setExtra: (id: string, tf: string | null) => void; news: NewsItem[];
  layout: 1 | 2 | 3; setLayout: (n: 1 | 2 | 3) => void;
  lead: string; setLead: (s: string) => void; dir: string; setDir: (s: string) => void;
  viewTf: string; setViewTf: (s: string) => void;
  events: ActivityEvent[]; clearEvents: () => void;
  setWanted: (tfs: string[]) => void;
  data: MtfResponse | null; error: string | null; loading: boolean; updated: number; refresh: () => void;
  rows: ScannerRow[];
  signals: MtfSignalRow[]; stats: MtfSignalStats | null; unread: number; markRead: () => void;
}
const C = createContext<Ctx>({} as Ctx);
export const useMtf = () => useContext(C);

export function MtfProvider({ children, notify }: { children: ReactNode; notify: (m: string, t?: "success" | "error" | "info") => void }) {
  const [symbol, setSymbolRaw] = useStored<string>("cs_symbol", "BTCUSDT");
  const [entryTf, setEntryTf] = useStored<string>("cs_entry", "15m");
  const [mode, setMode] = useStored<MtfMode>("cs_mode", "combined");
  const [minAgree, setMinAgree] = useStored<number>("cs_min", 70);
  const [layers, setLayers] = useStored<Record<LayerKey, boolean>>("cs_layers_v1", DEFAULT_LAYERS);
  const [prefs, setPrefs] = useStored<Prefs>("cs_prefs", DEFAULT_PREFS);
  const [auto, setAuto] = useState(true);
  const { auth } = useAuth();
  const [history, setHistory] = useStored<number>("cs_bars", 300);
  const [sens, setSensRaw] = useStored<Sens>("cs_sens", "balanced");
  const [consensus, setConsensus] = useStored<boolean>("cs_consensus", false);
  const [useProfile, setUseProfile] = useStored<boolean>("cs_useprofile", true);   // use the optimizer's tuned settings for a pair, when it has them
  const [engine, setEngine] = useState<EngineConfig | null>(null);
  const refreshEngine = useCallback(async () => { try { setEngine((await mtfApi.engine()).config); } catch { /* keep last */ } }, []);
  useEffect(() => { refreshEngine(); }, [refreshEngine]);
  const [weighting, setWeighting] = useStored<"equal" | "best">("cs_weight", "equal");
  const [extra, setExtraState] = useState<Record<string, string>>({});
  const [entryScan, setEntryScan] = useState<EntryScan | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [layout, setLayout] = useStored<1 | 2 | 3>("cs_layout", 3);
  const [lead, setLead] = useStored<string>("cs_lead", "4h");
  const [dir, setDir] = useStored<string>("cs_dir", "1h");
  const [viewTf, setViewTf] = useStored<string>("cs_view", "");
  const [events, setEvents] = useStored<ActivityEvent[]>("cs_events_v1", [] as ActivityEvent[]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const pushEvents = useCallback((ev: ActivityEvent[]) => {
    if (!ev.length) return;
    const have = new Set(eventsRef.current.map(e => e.id));
    const fresh = ev.filter(e => !have.has(e.id));
    if (fresh.length) setEvents([...fresh, ...eventsRef.current].slice(0, 80));
  }, [setEvents]);
  const clearEvents = useCallback(() => setEvents([]), [setEvents]);
  const [wanted, setWantedState] = useState<string[]>([]);

  const [data, setData] = useState<MtfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(0);
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [signals, setSignals] = useState<MtfSignalRow[]>([]);
  const [stats, setStats] = useState<MtfSignalStats | null>(null);
  const [lastSeen, setLastSeen] = useStored<number>("cs_last_seen", 0);

  const setSymbol = useCallback((s: string) => { setSymbolRaw(s); setData(null); }, [setSymbolRaw]);
  const setWanted = useCallback((tfs: string[]) => setWantedState(prev => (prev.join() === tfs.join() ? prev : tfs)), []);
  const setExtra = useCallback((id: string, tf: string | null) => setExtraState(p => {
    if ((p[id] ?? null) === tf) return p;
    const n = { ...p };
    if (tf) n[id] = tf; else delete n[id];
    return n;
  }), []);
  const extraKey = Object.values(extra).join();
  const tfs = useMemo(() => Array.from(new Set([...wanted, entryTf, ...Object.values(extra)])).slice(0, 6), [wanted, entryTf, extraKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const tfKey = tfs.join(",");

  // analysis: one request in flight; late answers from a superseded request are dropped
  const reqId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async (spinner: boolean) => {
    const id = ++reqId.current;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    if (spinner) setLoading(true);
    try {
      const r = await mtfApi.analysis(symbol, { mode, entryTf, minAgree, tfs: tfKey.split(","), bars: history, sens, consensus, weighting, profile: useProfile }, ac.signal);
      if (id !== reqId.current) return;
      if (!r.ok) { setError(r.error || "No data"); setData(null); }
      else { setData(r); setError(null); setUpdated(Date.now() / 1000); }
    } catch (e: any) {
      if (id !== reqId.current || e?.name === "AbortError") return;
      setError(e?.message || "Request failed");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [symbol, mode, entryTf, minAgree, tfKey, history, sens, consensus, weighting, useProfile]);

  useEffect(() => {
    load(true);
    if (!auto) return;
    const ms = ["1m", "3m", "5m"].includes(entryTf) ? 8000 : 15000;
    const t = setInterval(() => load(false), ms);
    return () => { clearInterval(t); abort.current?.abort(); };
  }, [load, auto, entryTf]);

  const prevStates = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    prevStates.current = null;
    const run = async () => {
      try {
        const o = await mtfApi.overview({ mode, entryTf, minAgree, sens, consensus, weighting, profile: useProfile });
        if (!live) return;
        setRows(o.rows);
        const prev = prevStates.current;
        const next = new Map(o.rows.map(r => [r.symbol, r.state]));
        if (prev) {
          const now = Math.floor(Date.now() / 1000);
          pushEvents(o.rows.filter(r => prev.has(r.symbol) && prev.get(r.symbol) !== r.state).map(r => ({
            id: `st-${r.symbol}-${r.state}-${Math.floor(now / 60)}`, t: now, kind: "state" as const, symbol: r.symbol,
            text: `${r.symbol.replace("USDT", "")} ${prev.get(r.symbol)!.replace("_", " ").toLowerCase()} → ${r.state.replace("_", " ").toLowerCase()} (${r.agreement}%, ${r.entry_tf})`,
            tone: r.state === "SIGNAL" ? (r.type === "SELL" ? "down" as const : "up" as const) : r.state === "SETUP" ? "warn" as const : "info" as const,
          })));
        }
        prevStates.current = next;
      } catch { /* keep last */ }
    };
    run();
    const t = setInterval(run, 30000);
    return () => { live = false; clearInterval(t); };
  }, [mode, entryTf, minAgree, sens, consensus, weighting, useProfile, pushEvents]);

  // which entry timeframe is ready right now (drives the dots on the top-bar buttons)
  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    const run = async () => {
      try { const r = await mtfApi.entryScan(symbol, { mode, minAgree, sens, consensus, weighting, profile: useProfile }, ac.signal); if (live) setEntryScan(r); } catch { /* keep last */ }
    };
    setEntryScan(null);
    run();
    const t = setInterval(run, 30000);
    return () => { live = false; ac.abort(); clearInterval(t); };
  }, [symbol, mode, minAgree, sens, consensus, weighting, useProfile]);

  // headlines for the chart's news markers (this coin)
  useEffect(() => {
    let live = true;
    setNews([]);
    const run = () => mtfApi.news(symbol, 40).then(r => { if (live) setNews(r.items); }).catch(() => undefined);
    run();
    const t = setInterval(run, 300000);
    return () => { live = false; clearInterval(t); };
  }, [symbol]);

  // keep the server's engine settings in step, so the background scanner (and your Telegram alerts) follow the rules you picked
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    if (!auth.token) return;
    const t = setTimeout(() => { mtfApi.saveEngine(auth.token!, { mode, entry_tf: entryTf, min_agree: minAgree, sens, consensus, weighting }).catch(() => undefined); }, 900);
    return () => clearTimeout(t);
  }, [mode, entryTf, minAgree, sens, consensus, weighting, auth.token]);

  // signal feed + alerts
  const known = useRef<Map<number, string> | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    let live = true;
    const run = async () => {
      try {
        const s = await mtfApi.signals(80);
        if (!live) return;
        setSignals(s.signals); setStats(s.stats);
        const prev = known.current;
        const next = new Map(s.signals.map(x => [x.id, x.status]));
        if (prev) {
          for (const x of s.signals) {
            const before = prev.get(x.id);
            const isNew = before === undefined;
            const settled = before === "OPEN" && (x.status === "WIN" || x.status === "LOSS");
            if (!isNew && !settled) continue;
            const msg = isNew
              ? `${x.side} ${x.symbol} · ${x.style} ${x.entry_tf} · ${x.agreement}% (${x.grade}) — entry ${x.entry}`
              : `${x.symbol} ${x.side} ${x.status === "WIN" ? "hit target" : "hit stop"} (${(x.r_result ?? 0) > 0 ? "+" : ""}${x.r_result}R)`;
            pushEvents([{
              id: `sg-${x.id}-${x.status}`, t: Math.floor(Date.now() / 1000), kind: isNew ? "signal" : "result", symbol: x.symbol, text: msg,
              tone: isNew ? (x.side === "BUY" ? "up" : "down") : x.status === "WIN" ? "up" : "down",
            }]);
            const p = prefsRef.current;
            if (p.toast) notify(msg, isNew ? "info" : x.status === "WIN" ? "success" : "error");
            if (p.sound) beep(isNew ? (x.side === "BUY" ? "buy" : "sell") : x.status === "WIN" ? "win" : "loss");
            if (p.desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
              pwa.notify(isNew ? `${x.side} signal · ${x.symbol}` : `Signal ${x.status} · ${x.symbol}`, msg).catch(() => undefined);
            }
          }
        }
        known.current = next;
      } catch { /* keep last */ }
    };
    run();
    const t = setInterval(run, 20000);
    return () => { live = false; clearInterval(t); };
  }, [notify, pushEvents]);

  const unread = useMemo(() => signals.filter(s => s.id > lastSeen).length, [signals, lastSeen]);
  const markRead = useCallback(() => { if (signals.length) setLastSeen(Math.max(...signals.map(s => s.id))); }, [signals, setLastSeen]);

  const profile = useProfile ? (engine?.profiles?.[symbol] ?? data?.profile ?? null) : null;
  const setSens = useCallback((x: Sens) => { setSensRaw(x); setMinAgree(SENS_AGREE[x]); }, [setSensRaw, setMinAgree]);
  const value: Ctx = {
    symbol, setSymbol, entryTf, setEntryTf, mode, setMode, minAgree, setMinAgree, layers, setLayers, prefs, setPrefs,
    auto, setAuto, history, setHistory, engine, refreshEngine, useProfile, setUseProfile, profile, sens, setSens, consensus, setConsensus, weighting, setWeighting, entryScan, setExtra, news, layout, setLayout, lead, setLead, dir, setDir, viewTf, setViewTf, events, clearEvents, setWanted, data, error, loading, updated, refresh: () => load(true), rows, signals, stats, unread, markRead,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
