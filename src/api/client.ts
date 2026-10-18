// api/client.ts — Typed API client for NexusAI Python backend

import type {
  User, Ticker, OHLCV, Signal, Bot, Trade, Strategy, BacktestResult, SMCResponse, BotLog,
} from "../types";
import type {
  MtfResponse, ScannerRow, MtfSignalRow, MtfSignalStats, MtfBacktest, StoreSeries, MtfMode, SignalPreview, NewsResponse, EntryScan, EngineConfig, EngineProfile, OptResult, Sens,
} from "../types/mtf";

// FIX: this was hardcoded to "https://cryptobotapi.onrender.com" — a stale
// hosted deployment. Every request went there regardless of what backend
// you were actually running locally, which is a big part of why local
// changes never seemed to show up. Now configurable via env, defaulting to
// localhost for local dev. Set VITE_API_URL in a .env file to point
// elsewhere (see .env.example).
const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, opts: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...(opts.headers as object || {}) } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    // FastAPI returns `detail` as a plain string for HTTPException, but as
    // an ARRAY of {msg, loc, ...} objects for Pydantic validation errors
    // (422s) — including every custom @field_validator raise in this app.
    // Passing that array straight to Error() silently stringified to
    // "[object Object]", making real validation messages (e.g. "execution
    // must be one of: ...") look like a silent, unexplained failure.
    let message = "Request failed";
    if (typeof err.detail === "string") {
      message = err.detail;
    } else if (Array.isArray(err.detail)) {
      message = err.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
    } else if (err.detail) {
      message = JSON.stringify(err.detail);
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export const authApi = {
  signup: (name: string, email: string, password: string) =>
    req<{ token: string; user: User }>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }),

  login: (email: string, password: string) =>
    req<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  me: (token: string) => req<User>("/auth/me", {}, token),
};

// ── Market ─────────────────────────────────────────────────────────────────────
export const marketApi = {
  tickers: () => req<Ticker[]>("/market/tickers"),
  klines: (symbol: string, interval = "1h", limit = 100, before?: number) =>
    req<OHLCV[]>(
      `/market/klines/${symbol}?interval=${interval}&limit=${limit}` + (before ? `&before=${before}` : "")
    ),
  orderBook: (symbol: string, limit = 20) =>
    req<{ bids: { price: number; size: number }[]; asks: { price: number; size: number }[] }>(
      `/market/orderbook/${symbol}?limit=${limit}`
    ),
  // Order blocks / FVGs / market structure / sweeps / POI — computed
  // server-side by the exact same functions (app/services/smc.py) the
  // Smart Money Concepts bot strategy trades off of, so the chart shows
  // provably the same thing the bot saw rather than a separate client-side
  // approximation of it.
  smc: (symbol: string, interval = "1h", limit = 300) =>
    req<SMCResponse>(`/market/smc/${symbol}?interval=${interval}&limit=${limit}`),
};

// ── Top-down multi-timeframe SMC (4H bias → 1H setup → entry TF trigger) ─────────
// All public market data — no token needed. Every call takes an AbortSignal so
// a fast pair/timeframe switch cancels the request it superseded instead of
// letting a late answer overwrite the newer one.
export const mtfApi = {
  analysis: (symbol: string, o: { mode: MtfMode; entryTf: string; minAgree: number; tfs: string[]; bars?: number; sens?: Sens; consensus?: boolean; weighting?: string; profile?: boolean }, signal?: AbortSignal) =>
    req<MtfResponse>(
      `/market/mtf/${symbol}?mode=${o.mode}&entry_tf=${o.entryTf}&min_agree=${o.minAgree}&tfs=${o.tfs.join(",")}&bars=${o.bars ?? 300}&sens=${o.sens ?? "balanced"}&consensus=${!!o.consensus}&weighting=${o.weighting ?? "equal"}&profile=${o.profile !== false}`,
      { signal },
    ),
  overview: (o: { mode: MtfMode; entryTf: string; minAgree: number; sens?: Sens; consensus?: boolean; weighting?: string; profile?: boolean }, signal?: AbortSignal) =>
    req<{ rows: ScannerRow[]; updated: number; demo: boolean }>(
      `/market/overview?mode=${o.mode}&entry_tf=${o.entryTf}&min_agree=${o.minAgree}&sens=${o.sens ?? "balanced"}&consensus=${!!o.consensus}&weighting=${o.weighting ?? "equal"}&profile=${o.profile !== false}`, { signal },
    ),
  signals: (limit = 60, signal?: AbortSignal) =>
    req<{ signals: MtfSignalRow[]; stats: MtfSignalStats }>(`/market/mtf-signals?limit=${limit}`, { signal }),
  backtest: (symbol: string, o: { style: string; entryTf: string; bars: number; minAgree: number; longOnly: boolean } & Partial<{
    sens: Sens; rr: number; slBuffer: number; feePct: number; slippagePct: number; minGrade: string; breakevenAtR: number;
    maxHold: number; killzoneOnly: boolean; gateSweep: boolean; consensus: boolean; riskGuard: number; maxChaseAtr: number; minRoomRr: number; maxRiskPct: number }>) => {
    const q = new URLSearchParams({
      style: o.style, entry_tf: o.entryTf, bars: String(o.bars), min_agree: String(o.minAgree), long_only: String(o.longOnly),
      sens: o.sens ?? "balanced", rr: String(o.rr ?? 0), sl_buffer: String(o.slBuffer ?? -1), fee_pct: String(o.feePct ?? 0.1),
      slippage_pct: String(o.slippagePct ?? 0), min_grade: o.minGrade ?? "D", breakeven_at_r: String(o.breakevenAtR ?? 0),
      max_hold_bars: String(o.maxHold ?? 300), killzone_only: String(!!o.killzoneOnly), gate_sweep: String(!!o.gateSweep), consensus: String(!!o.consensus),
      risk_guard: String(o.riskGuard ?? -1), max_chase_atr: String(o.maxChaseAtr ?? 0), min_room_rr: String(o.minRoomRr ?? 0), max_risk_pct: String(o.maxRiskPct ?? 0),
    });
    return req<MtfBacktest>(`/market/mtf/backtest/${symbol}?${q}`);
  },
  entryScan: (symbol: string, o: { mode: MtfMode; minAgree: number; sens: Sens; consensus: boolean; weighting: string; profile?: boolean }, signal?: AbortSignal) =>
    req<EntryScan>(`/market/entry-scan/${symbol}?mode=${o.mode}&min_agree=${o.minAgree}&sens=${o.sens}&consensus=${o.consensus}&weighting=${o.weighting}&profile=${o.profile !== false}`, { signal }),
  optimize: (symbol: string, o: { style: string; entryTf: string; bars: number; feePct?: number; slippagePct?: number }, signal?: AbortSignal) =>
    req<OptResult>(`/market/mtf/optimize/${symbol}?style=${o.style}&entry_tf=${o.entryTf}&bars=${o.bars}&fee_pct=${o.feePct ?? 0.1}&slippage_pct=${o.slippagePct ?? 0}`, { signal }),
  saveProfile: (token: string, symbol: string, profile: EngineProfile | null) =>
    req<{ ok: boolean; profile: EngineProfile; config: EngineConfig }>(`/settings/engine/profile/${symbol}`, { method: "PUT", body: JSON.stringify(profile ?? {}) }, token),
  engine: () => req<{ config: EngineConfig; presets: Record<string, { min_agree: number; label: string }> }>("/market/engine"),
  saveEngine: (token: string, patch: Partial<EngineConfig>) =>
    req<{ ok: boolean; config: EngineConfig }>("/settings/engine", { method: "PUT", body: JSON.stringify(patch) }, token),
  preview: (id: number) => req<SignalPreview>(`/market/mtf-signals/${id}/preview`),
  news: (symbol = "", limit = 30) => req<NewsResponse>(`/market/news?symbol=${symbol}&limit=${limit}`),
  store: () => req<{ series: StoreSeries[]; total_candles: number; pairs: string[] }>("/market/store"),
  sync: (symbols: string, tfs = "4h,1h,15m,5m", bars = 1500) =>
    req<{ synced: Record<string, number> }>(`/market/store/sync?symbols=${symbols}&tfs=${tfs}&bars=${bars}`, { method: "POST" }),
};

// ── Signals ────────────────────────────────────────────────────────────────────
export const signalsApi = {
  list: (token: string) => req<Signal[]>("/signals", {}, token),
  generate: (token: string) => req<Signal[]>("/signals/generate", { method: "POST" }, token),
  sendTelegram: (token: string, signalId: string) =>
    req<{ ok: boolean }>(`/signals/${signalId}/telegram`, { method: "POST" }, token),
  copy: (token: string, signal_id: string, amount = 0.01) =>
    req<Trade>("/signals/copy", { method: "POST", body: JSON.stringify({ signal_id, amount }) }, token),
};

// ── Bots ───────────────────────────────────────────────────────────────────────
export const botsApi = {
  list: (token: string) => req<Bot[]>("/bots", {}, token),
  get: (token: string, id: string) =>
    req<Bot & { recent_trades: Trade[] }>(`/bots/${id}`, {}, token),
  create: (token: string, data: { name: string; pair: string; strategy: string; capital: number; mode?: "DEMO" | "LIVE"; max_hold_minutes?: number; timeframe?: string; confidence_threshold?: number; cooldown_minutes?: number; auto_pause_after_losses?: number; max_trades?: number; max_open_positions?: number; confluence_strategies?: string[]; confluence_min_agree?: number }) =>
    req<Bot>("/bots", { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, id: string, data: { status?: string; capital?: number; name?: string; strategy?: string; pair?: string; mode?: "DEMO" | "LIVE"; max_hold_minutes?: number; timeframe?: string; confidence_threshold?: number; cooldown_minutes?: number; auto_pause_after_losses?: number; max_trades?: number; max_open_positions?: number; confluence_strategies?: string[]; confluence_min_agree?: number }) =>
    req<Bot>(`/bots/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
  delete: (token: string, id: string) =>
    req<{ ok: boolean }>(`/bots/${id}`, { method: "DELETE" }, token),
  // Activity log — what each bot looked at and decided, step by step.
  // `sinceId` returns only rows newer than the last one already held, so
  // polling is cheap. Oldest-first: just append.
  logsFeed: (token: string, opts: { pair?: string; sinceId?: number; limit?: number } = {}) =>
    req<BotLog[]>(
      `/bots/logs/feed?since_id=${opts.sinceId ?? 0}&limit=${opts.limit ?? 150}` +
        (opts.pair ? `&pair=${encodeURIComponent(opts.pair)}` : ""),
      {}, token,
    ),
  logs: (token: string, id: string, opts: { sinceId?: number; limit?: number } = {}) =>
    req<BotLog[]>(`/bots/${id}/logs?since_id=${opts.sinceId ?? 0}&limit=${opts.limit ?? 200}`, {}, token),
  // "which strategy is the best...can i create a bot that confirms from
  // all or selected strategies" — ad-hoc backtest for a Confluence combo,
  // not tied to a saved bot, so it can be checked before creating one.
  confluenceBacktest: (token: string, data: { pair: string; timeframe?: string; confluence_strategies: string[]; confluence_min_agree?: number }) =>
    req<{ profit: number; trades: number; winRate: number; sharpeRatio: number; maxDrawdown: number; profitFactor: number; pair: string; timeframe: string; candleCount: number; requiredAgree: number }>(
      "/bots/confluence-backtest", { method: "POST", body: JSON.stringify(data) }, token,
    ),
};

// ── Trades ─────────────────────────────────────────────────────────────────────
export const tradesApi = {
  list: (token: string) => req<Trade[]>("/trades", {}, token),
  // `venue` defaults to DEMO server-side — BINANCE sends a real signed
  // market order to the connected exchange account.
  place: (token: string, data: { pair: string; side: string; amount: number; order_type: string; limit_price?: number; stop_loss?: number; take_profit?: number; venue?: "DEMO" | "BINANCE" }) =>
    req<Trade>("/trades", { method: "POST", body: JSON.stringify(data) }, token),
  updateTpSl: (token: string, tradeId: string, data: { stop_loss?: number; take_profit?: number }) =>
    req<Trade>(`/trades/${tradeId}`, { method: "PATCH", body: JSON.stringify(data) }, token),
  close: (token: string, tradeId: string) =>
    req<Trade>(`/trades/${tradeId}/close`, { method: "POST" }, token),
};

// ── Strategies ─────────────────────────────────────────────────────────────────
export const strategiesApi = {
  list: (token: string) => req<Strategy[]>("/strategies", {}, token),
  create: (token: string, data: { name: string; description?: string; execution?: string; pair?: string; timeframe?: string; parameters?: Record<string, number> }) =>
    req<Strategy>("/strategies", { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, id: string, data: { description?: string; execution?: string; pair?: string; timeframe?: string; parameters?: Record<string, number>; active?: boolean }) =>
    req<Strategy>(`/strategies/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
  backtest: (token: string, id: string) =>
    req<BacktestResult>(`/strategies/${id}/backtest`, { method: "POST" }, token),
};

// ── Settings ───────────────────────────────────────────────────────────────────
export const settingsApi = {
  updateTelegram: (token: string, telegram_token: string, telegram_chat_id: string) =>
    req<{ ok: boolean }>("/settings/telegram", { method: "PATCH", body: JSON.stringify({ telegram_token, telegram_chat_id }) }, token),
  testTelegram: (token: string) =>
    req<{ ok: boolean }>("/settings/telegram/test", { method: "POST" }, token),
  testBroker: (token: string, data: { api_key: string; api_secret: string; testnet: boolean }) =>
    req<{ ok: boolean; can_trade: boolean; testnet: boolean; balances: { asset: string; free: string; locked: string }[] }>(
      "/settings/broker/test", { method: "POST", body: JSON.stringify(data) }, token
    ),
  connectBroker: (token: string, data: { api_key: string; api_secret: string; testnet: boolean }) =>
    req<{ ok: boolean; testnet: boolean }>("/settings/broker", { method: "PATCH", body: JSON.stringify(data) }, token),
  disconnectBroker: (token: string) =>
    req<{ ok: boolean }>("/settings/broker", { method: "DELETE" }, token),
  updateRisk: (token: string, risk_per_trade: number) =>
    req<{ ok: boolean; risk_per_trade: number }>("/settings/risk", { method: "PATCH", body: JSON.stringify({ risk_per_trade }) }, token),
};

export const accountApi = {
  summary: (token: string) =>
    req<{
      demo_balance: number; broker_connected: boolean; testnet: boolean;
      live: { balances: { asset: string; free: number; locked: number; usdt_value: number }[]; total_equity_usdt: number; can_trade: boolean } | null;
      live_error: string | null;
      // P&L of the LIVE trades this app placed — realized from closed
      // positions plus mark-to-market on open ones. Distinct from `live`
      // above, which is raw exchange equity (and also counts anything you
      // opened directly in the Binance app).
      live_pnl: {
        realized: number; unrealized: number; total: number;
        open_positions: number; closed_trades: number;
      };
      deposit_available: boolean; deposit_available_at: number; deposit_amount: number;
    }>("/account/summary", {}, token),
  deposit: (token: string) =>
    req<{ ok: boolean; balance: number; deposited: number; deposit_available_at: number }>(
      "/account/deposit", { method: "POST" }, token
    ),
};

export { ApiError };
