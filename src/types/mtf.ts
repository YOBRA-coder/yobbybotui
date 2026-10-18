// types/mtf.ts — shapes returned by the top-down multi-timeframe SMC endpoints
// (backend/app/routers/market.py: /market/mtf, /market/overview, /market/mtf-signals, ...).

export type Direction = "bullish" | "bearish";
export type Bias = Direction | "neutral";
export type SetupState = "SIGNAL" | "SETUP" | "WATCH" | "STAND_ASIDE";
export type MtfMode = "intraday" | "scalp" | "combined";
export type Sens = "strict" | "balanced" | "fast";
export const SENS_AGREE: Record<Sens, number> = { strict: 80, balanced: 70, fast: 60 };
export const SENS_HINT: Record<Sens, string> = {
  strict: "Quality over quantity — needs a liquidity sweep and 80% agreement",
  balanced: "The standard rules (70% agreement)",
  fast: "Earlier, more signals — wider touch window, 60% agreement",
};

export const ALL_TFS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export const ENTRY_TFS = ["1m", "3m", "5m", "15m", "30m"] as const;

export interface MtfCandle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface MtfOB { top: number; bottom: number; kind: Direction; time: number; formed_at?: number; mitigated: boolean; strength: number }
export interface MtfFVG { top: number; bottom: number; kind: Direction; time: number; filled: boolean; fillPct: number }
export interface MtfSD { top: number; bottom: number; kind: "supply" | "demand"; time: number; touches: number; fresh: boolean }
export interface MtfSwing { time: number; price: number; kind: "high" | "low"; label: "HH" | "LH" | "HL" | "LL" | null }
export interface MtfBreak { time: number; level: number; from_time: number; kind: "BOS" | "CHoCH"; dir: Direction }
export interface MtfSweep { time: number; level: number; wick: number; kind: Direction }
export interface MtfPoi { top: number; bottom: number; time: number; kind: Direction; source: string }
export interface MtfRetest { time: number; kind: Direction; source: string; top: number; bottom: number; zone_time: number; confirmed: boolean; active: boolean }
export interface MtfEq { kind: "EQH" | "EQL"; price: number; t1: number; t2: number; swept: boolean }
export interface MtfPD { high: number; low: number; eq: number; pct: number; t_high: number; t_low: number; t_start: number; zone: "premium" | "discount" | "equilibrium" }
export interface MtfTrendline { kind: "support" | "resistance"; t1: number; p1: number; t2: number; p2: number; slope: number; broken: boolean }

export interface MtfPanel {
  tf: string;
  candles: MtfCandle[];
  orderBlocks: MtfOB[];
  fvgs: MtfFVG[];
  sdZones: MtfSD[];
  structure: { swings: MtfSwing[]; trend: "bullish" | "bearish" | "ranging" };
  breaks: { events: MtfBreak[]; trend: Direction | null };
  sweeps: MtfSweep[];
  poi: MtfPoi[];
  retests: MtfRetest[];
  eq: MtfEq[];
  pd: MtfPD | null;
  trendlines: MtfTrendline[];
  bias: Bias;
  atr: number;
  barMs: number;
}

export interface MtfCheck {
  id: string; step: 1 | 2 | 3 | 4; label: string; ok: boolean | null; weight: number; gate: boolean; detail: string;
}

export interface MtfPlan {
  side: "BUY" | "SELL"; entry: number; sl: number; tp: number; rr: number; risk_pct: number; ideal_entry: number; limit_rr?: number | null;
  target_liquidity: { price: number; label: string; rr: number | null } | null;
}

export interface MtfZoneRef { src: string; tf: string; top: number; bottom: number; time: number; fresh: boolean }

export interface Outlook {
  kind: "trend" | "counter"; side: string; state: SetupState; scenario: string; confirm: string | null;
  invalid: number | null; target: number | null; from: number | null; to: number | null; window: string;
  killzone: { name: string; start: number; active: boolean } | null; risk_note: string | null;
}

export interface MtfDecision {
  style: "intraday" | "scalp"; label: string; bias_tf: string; setup_tf: string; entry_tf: string;
  type: "BUY" | "SELL" | "HOLD"; state: SetupState; direction: Bias; agreement: number; grade: string; gates_ok: boolean;
  checks: MtfCheck[]; plan: MtfPlan | null; zone: MtfZoneRef | null; trigger?: string | null;
  watch: string; reason: string; time?: number;
  vote_blocked?: boolean; vote_ok?: boolean; entry_risk?: EntryRisk | null; kind?: "trend" | "counter"; side?: "BUY" | "SELL"; outlook?: Outlook | null;
  expect?: { tf: string; src: string; top: number; bottom: number; distance_pct: number } | null;
  bias_info?: unknown;
}

export interface MtfResponse {
  ok: boolean; error?: string; symbol: string; mode: MtfMode; entry_tf: string; min_agree: number;
  demo: boolean; serverTime: number; price: number; changePct?: number | null; staleMinutes: number;
  decision: MtfDecision; counter?: MtfDecision | null; profile?: EngineProfile | null; styles: Record<string, MtfDecision>; panels: MtfPanel[]; vote?: VoteResult; sens?: Sens; consensus?: boolean;
  styleInfo: Record<string, { bias_tf: string; setup_tf: string; entry_tfs: string[]; label: string }>;
}

export interface ScannerRow {
  symbol: string; price: number | null; changePct: number | null; type: "BUY" | "SELL" | "HOLD"; state: SetupState;
  direction: Bias; style: string; agreement: number; grade: string; watch: string; entry_tf: string; bias_tf: string; setup_tf: string;
  tuned?: boolean; zone: string | null; plan: MtfPlan | null; styles: Record<string, { state: SetupState; agreement: number; direction: Bias; grade: string; type: string; entry_tf: string }>;
}

export interface MtfSignalRow {
  id: number; symbol: string; style: string; entry_tf: string; side: "BUY" | "SELL"; entry: number; sl: number; tp: number; rr: number;
  agreement: number; grade: string; zone: string; reason: string; created_at: number; status: "OPEN" | "WIN" | "LOSS" | "EXPIRED";
  closed_at: number | null; r_result: number | null; exit_price?: number | null; bar_time?: number;
}
export interface MtfSignalStats { total: number; wins: number; losses: number; open: number; win_rate: number | null; net_r: number }

export interface MtfBacktest {
  style: string; entry_tf: string; bars: number; trades: number; win_rate: number; net_r: number; avg_r: number;
  profit_factor: number | null; max_drawdown_r: number; equity: { time: number; r: number }[];
  trade_log: { side: string; entry_time: number; exit_time: number; entry: number; sl: number; tp: number; exit: number; result: string; r: number; agreement: number; grade: string; zone: string; bars_held?: number }[];
  from: number | null; to: number | null; note: string; symbol: string; demo: boolean;
  stats?: BtStats; params?: Record<string, string | number | boolean>;
}

export interface StoreSeries { symbol: string; interval: string; count: number; first: number; last: number }

export type LayerKey = "ob" | "fvg" | "sd" | "poi" | "bos" | "choch" | "swings" | "eq" | "sweep" | "retest" | "trend" | "pd" | "plan" | "volume" | "signals" | "news";

export const LAYERS: { key: LayerKey; label: string; hint: string; color: string }[] = [
  { key: "ob", label: "Order blocks", hint: "Last opposite candle before an impulse — unmitigated only", color: "#00d084" },
  { key: "fvg", label: "FVG", hint: "Fair value gaps (imbalances) not yet filled", color: "#3b9dff" },
  { key: "sd", label: "Supply / Demand", hint: "Base-and-departure zones, fresh or barely touched", color: "#b78bff" },
  { key: "poi", label: "POI", hint: "Points of interest — nearest live zone above and below price", color: "#ffd700" },
  { key: "bos", label: "BOS", hint: "Break of structure — a close through a swing in the trend's direction", color: "#00d084" },
  { key: "choch", label: "CHoCH", hint: "Change of character — a close through a swing against the trend", color: "#ff9f43" },
  { key: "swings", label: "HH HL LH LL", hint: "Swing structure labels", color: "#8aa4c8" },
  { key: "eq", label: "EQH / EQL", hint: "Equal highs / lows — resting liquidity", color: "#ff7bd5" },
  { key: "sweep", label: "Sweeps", hint: "Liquidity sweeps — wick through a swing, close back inside", color: "#ff4757" },
  { key: "retest", label: "Retests", hint: "Price returning into a live zone", color: "#35e0d0" },
  { key: "trend", label: "Trendlines", hint: "Support / resistance lines through the last two swings", color: "#c0c8d8" },
  { key: "pd", label: "Premium / Discount", hint: "Dealing range, equilibrium at 50%", color: "#6f86a8" },
  { key: "plan", label: "Trade plan", hint: "Entry, stop and target of the current setup", color: "#0094ff" },
  { key: "signals", label: "Past signals", hint: "Where earlier signals fired and how they ended", color: "#0094ff" },
  { key: "news", label: "News", hint: "Headlines about this coin, placed at their publish time (click to open)", color: "#ffb86b" },
  { key: "volume", label: "Volume", hint: "Volume bars", color: "#4a6080" },
];

export const TF_LABEL = (tf: string) => tf.toUpperCase();

export interface SignalPreview { signal: MtfSignalRow & { bar_time: number }; bar_ms: number; candles: MtfCandle[] }
export interface NewsItem { title: string; link: string; source: string; time: number; summary: string }
export interface NewsResponse { items: NewsItem[]; updated: number; filtered: boolean; ok: boolean }

export interface VoteRow { id: string; name: string; tf: string; vote: number; detail: string; weight: number; edge: { n: number; win_rate: number | null; avg_ret: number | null; ok: boolean } | null }
export interface VoteResult {
  votes: VoteRow[]; score: number; direction: "bullish" | "bearish" | "mixed"; buy: number; sell: number; neutral: number;
  best: { id: string; name: string; avg_ret: number; win_rate: number; n: number; vote: number } | null;
  weighting: "equal" | "best"; horizon: number; note: string;
}
export interface EntryScan { symbol: string; best: string | null; rows: { tf: string; state: SetupState; type: string; direction: Bias; agreement: number; grade: string; style: string; watch: string }[] }
export interface EngineProfile {
  sens?: Sens; min_agree?: number; entry_tf?: string; mode?: MtfMode; rr_intraday?: number; rr_scalp?: number; sl_buffer?: number;
  risk_guard?: number; max_chase_atr?: number; min_room_rr?: number; max_risk_pct?: number; gate_sweep?: boolean; gate_killzone?: boolean;
  rsi_guard?: boolean; vol_guard?: boolean; avoid_weekend?: boolean; tuned_at?: number; score?: number;
}
export interface EngineConfig {
  mode: MtfMode; entry_tf: string; min_agree: number; sens: Sens; consensus: boolean; weighting: "equal" | "best";
  rr_intraday: number | null; rr_scalp: number | null; sl_buffer: number | null; gate_sweep: boolean | null; gate_killzone: boolean | null;
  risk_guard: number | null; max_chase_atr: number | null; min_room_rr: number | null; max_risk_pct: number | null;
  rsi_guard: boolean | null; vol_guard: boolean | null; avoid_weekend: boolean | null;
  profiles: Record<string, EngineProfile>;
}
export interface EntryRisk { level: "LOW" | "MEDIUM" | "HIGH"; score: number; reasons: string[]; limit_entry?: number; limit_rr?: number | null }
export interface OptMetrics { trades: number; win_rate: number; avg_r: number; net_r: number; profit_factor: number | null; max_drawdown_r: number }
export interface OptCandidate { params: Record<string, string | number | boolean>; train: OptMetrics; val: OptMetrics; score: number }
export interface OptResult {
  symbol: string; style: string; entry_tf: string; bars: number; runs: number; verdict: "robust" | "tentative" | "none"; note: string;
  split_time: number; from: number; to: number; best: OptCandidate | null; profile: EngineProfile | null;
  baseline: { params: Record<string, string | number | boolean>; train: OptMetrics; val: OptMetrics }; candidates: OptCandidate[]; demo: boolean;
}
export interface BtStats {
  expectancy_r: number; avg_win_r: number; avg_loss_r: number; best_r: number; worst_r: number; max_win_streak: number; max_loss_streak: number;
  avg_bars_held: number; sharpe_r: number | null;
  by_side: Record<string, BtGroup>; by_grade: Record<string, BtGroup>; by_hour: Record<string, BtGroup>; by_weekday: Record<string, BtGroup>; by_month: Record<string, BtGroup>;
  dist: { from: number; to: number; n: number }[]; drawdown: { time: number; dd: number }[];
}
export interface BtGroup { trades: number; wins: number; net_r: number; win_rate: number }
