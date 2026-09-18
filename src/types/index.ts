// types/index.ts — Shared TypeScript types for NexusAI

export interface User {
  id: string;
  name: string;
  email: string;
  telegram_token?: string;
  telegram_chat_id?: string;
  balance?: number;
  risk_per_trade?: number;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

export interface Ticker {
  symbol: string;
  price: number;
  change24h: number;
  changePct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  bid: number;
  ask: number;
  lastUpdate: number;
}

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
  id: string;
  pair: string;
  type: "BUY" | "SELL" | "HOLD";
  strength: number;
  price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  reason: string;
  ai_generated: boolean | number;
  status: "ACTIVE" | "CLOSED" | "PENDING";
  created_at: number;
  // Legacy camelCase compat
  targetPrice?: number;
  stopLoss?: number;
  aiGenerated?: boolean;
  timestamp?: number;
}

export interface Bot {
  id: string;
  user_id: string;
  name: string;
  pair: string;
  strategy: string;
  status: "RUNNING" | "STOPPED" | "PAUSED";
  mode?: "DEMO" | "LIVE";
  profit: number;
  trades: number;
  wins?: number;
  losses?: number;
  win_rate: number;
  capital: number;
  // MIXED = simultaneously holding a long and a short (possible once a bot
  // may hold more than one position — see max_open_positions).
  current_position?: "LONG" | "SHORT" | "MIXED" | null;
  started_at: number;
  max_hold_minutes?: number | null;
  // Live per-bot market read, refreshed each simulation cycle regardless
  // of whether the bot has an open position.
  market_signal?: "BUY" | "SELL" | "HOLD" | null;
  market_confidence?: number | null;
  volatility_pct?: number | null;
  rr_ratio?: number | null;
  market_updated_at?: number | null;
  // Per-bot tuning — previously one hardcoded global shared by every bot.
  confidence_threshold?: number | null;
  // BUG FIX: 4h and 1d are accepted by the backend (config.TIMEFRAMES and
  // the bot loop's TIMEFRAME_CANDLES both list them) but were missing from
  // this union, so a bot legitimately set to 4h/1d was a type error on the
  // client.
  timeframe?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | null;
  cooldown_minutes?: number | null;
  // Last reason text this bot's evaluation produced, even when it didn't
  // trade — answers "why hasn't this bot traded yet".
  reason_log?: string | null;
  // Consecutive-loss circuit breaker — see database.py migration notes.
  consecutive_losses?: number;
  auto_pause_after_losses?: number | null;
  // "stop after how many trades" — lifetime trade-count cap.
  max_trades?: number | null;
  // How many positions this bot may hold at once (default 1).
  max_open_positions?: number | null;
  // Confluence mode — strategy is the literal "CONFLUENCE" marker when set.
  confluence_strategies?: string[] | null;
  confluence_min_agree?: number | null;
}

export interface Trade {
  id: string;
  user_id?: string;
  bot_id?: string | null;
  signal_id?: string | null;
  pair: string;
  side: "BUY" | "SELL";
  price: number;
  amount: number;
  total: number;
  fee: number;
  pnl: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  live?: boolean | number;
  // Where this trade's stop-loss / take-profit are actually enforced:
  // "EXCHANGE" = a resting OCO on Binance, honoured even if this app is
  // offline. "APP" = only position_monitor_loop is watching, so the levels
  // stop working the moment the backend does.
  sl_tp_venue?: "EXCHANGE" | "APP";
  exchange_order_list_id?: string | null;
  exchange_exit_error?: string | null;
  status: "FILLED" | "PENDING" | "CANCELLED" | "CLOSED";
  created_at?: number;
  closed_at?: number | null;
  timestamp?: number;
  // "let every trade taken has a reason" — the signal/strategy rule that
  // triggered this trade (or "Manual order placed by user" / "Copied from
  // signal" for non-bot trades).
  reason?: string | null;
}

export interface Strategy {
  id: string;
  user_id?: string;
  name: string;
  description: string;
  execution: string;
  pair: string;
  timeframe?: "1m" | "5m" | "15m" | "1h";
  win_rate: number;
  total_trades: number;
  profit_factor: number;
  max_drawdown: number;
  parameters: Record<string, number> | string;
}

export interface BacktestTrade {
  side: "BUY" | "SELL";
  entry_time: number;
  entry_price: number;
  exit_time: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  result: "WIN" | "LOSS";
}

export interface BacktestResult {
  profit: number;
  trades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradeLog?: BacktestTrade[];
  pair?: string;
  timeframe?: string;
  candleCount?: number;
}
// In your types file
export interface KlineUpdate {
  symbol: string;
  interval: string;
  data: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closed: boolean;
  };
}

export type KlineMessage = {
  symbol: string;
  interval: string;
  data: KlineUpdate[];
}

// WebSocket message types
export type WSMessage =
  | { type: "TICKERS"; data: Ticker[] }
  | { type: "BOTS_UPDATE"; data: Bot[] }
  | { type: "NEW_TRADE"; data: Trade }
  | { type: "NEW_SIGNALS"; data: Signal[] }
  | { type: "BOT_ERROR"; data: { bot_id: string; message: string } }
  | { type: "INIT"; data: { bots: Bot[]; trades: Trade[]; signals: Signal[] } }
  | { type: "PING" | "PONG" }
  | {type: "KLINE"; data: KlineUpdate[]};

export type Page = "dashboard" | "trading" | "signals" | "bots" | "strategy" | "history" | "settings";

export const PAIR_DISPLAY: Record<string, string> = {
  BTCUSDT: "BTC/USDT", ETHUSDT: "ETH/USDT", BNBUSDT: "BNB/USDT",
  SOLUSDT: "SOL/USDT", XRPUSDT: "XRP/USDT", ADAUSDT: "ADA/USDT",
  DOGEUSDT: "DOGE/USDT", AVAXUSDT: "AVAX/USDT", DOTUSDT: "DOT/USDT",
  MATICUSDT: "MATIC/USDT", LTCUSDT: "LTC/USDT", LINKUSDT: "LINK/USDT",
};

export const PAIRS = Object.keys(PAIR_DISPLAY);

// Candle intervals a bot/strategy can evaluate signals on. Shorter =
// updates more often (more trade opportunities); longer = smoother,
// fewer false signals. Matches backend TIMEFRAMES in config.py — kept in
// sync with the chart's own DEFAULT_TIMEFRAMES (ProChart.tsx), which
// always offered 4h/1d even before bots/backtesting could actually use
// them.
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export const TIMEFRAME_LABEL: Record<string, string> = {
  "1m": "1 minute (fastest, noisiest)",
  "5m": "5 minutes",
  "15m": "15 minutes (recommended)",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day (slowest, smoothest)",
};

// Renders a unix-seconds-or-ms timestamp as a short "how long ago" label
// (e.g. "3s ago", "5m ago", "2h ago", "3d ago"). Accepts either seconds
// (backend `created_at`) or ms (legacy `timestamp`) — anything below the
// year-2001-in-ms threshold is treated as seconds and scaled up.
export function timeAgo(ts?: number | null): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function fmtPrice(price: number): string {
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(3);
  if (price < 10000) return price.toFixed(2);
  return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
