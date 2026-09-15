// components/ProChart.tsx
//
// Real TradingView chart (the official open-source "lightweight-charts"
// library — the same one TradingView ships for embeds that don't need
// their licensed Advanced Charts product). This replaces the ~1,100-line
// hand-rolled canvas chart in viewPro.tsx.
//
// NOTE ON "TradingView": TradingView's full Advanced Charts / Charting
// Library is not distributed on npm — it requires applying for a license
// directly from TradingView and self-hosting their bundle. What IS
// installable (and was already sitting unused in package.json here) is
// their official open-source "lightweight-charts" package, which is the
// same rendering engine, just without the built-in drawing-tools UI and
// without a few advanced study types. That's what this component uses.
//
// Built against lightweight-charts v5 (already pinned in package.json).
// I couldn't run `npm install`/`npm run build` in this environment to
// verify it compiles — please run `npm install && npm run dev` and let
// me know if TypeScript flags anything; the v5 API (addSeries with a
// series-type import, multi-pane via paneIndex, createSeriesMarkers as a
// separate call) is different enough from v3/v4 tutorials online that
// small signature mismatches are the most likely thing to slip through.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { OHLCV, Trade } from "../types";
import { useTheme } from "../context/ThemeContext";

// lightweight-charts draws to a <canvas>, not the DOM — it reads the color
// strings we hand it directly into the canvas 2D context's fillStyle, which
// has no idea what a CSS custom property is. Passing "var(--text-dim)"
// straight through (as a naive dark/light theming pass would) silently
// fails to draw at all, rather than erroring — so this resolves a CSS
// variable to its actual current value before it ever reaches the chart.
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface OrderBookEntry { price: number; size: number }
export interface OrderBookData { bids: OrderBookEntry[]; asks: OrderBookEntry[] }

export interface SignalOverlay {
  id: string;
  type: "BUY" | "SELL" | "HOLD";
  price: number;
  targetPrice: number;
  stopLoss: number;
  confidence?: number;
  reason?: string;
}

export interface BacktestOverlay {
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  result: "WIN" | "LOSS";
  pnlPct: number;
}

export interface ProChartProps {
  candles: OHLCV[];
  trades: Trade[]; // full trade list; component filters to `symbol` itself
  symbol: string;
  timeframe: string;
  timeframes?: string[];
  onTimeframeChange?: (tf: string) => void;
  onTradeClick?: (trade: Trade) => void;
  onUpdateTpSl?: (tradeId: string, data: { stop_loss?: number; take_profit?: number }) => void;
  orderBook?: OrderBookData | null;
  signalOverlay?: SignalOverlay | null;
  backtestOverlay?: BacktestOverlay | null;
  height?: number;
  // True while the parent is fetching a new symbol/timeframe or polling an
  // update. The chart keeps showing whatever candles are already on
  // screen (no blanking, no flash) and just shows a small "Updating…"
  // pill — "add candles to stay when updating or loading, only show
  // updating, and let the user keep viewing/continue after".
  loading?: boolean;
  // Called (at most once per cooldown window) when the user scrolls/zooms
  // near the oldest candle currently loaded, so the parent can fetch and
  // prepend older history — "increase candles I view when I move back".
  onRequestMoreHistory?: () => void;
}

const DEFAULT_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

// Chart timestamps are unix seconds (UTC). Force East Africa Time (UTC+3,
// no DST) for display regardless of the viewer's own timezone, since the
// axis previously just showed whatever the browser's local timezone was.
const EAT_OFFSET_SECONDS = 3 * 3600;
function toEAT(time: number): Date {
  return new Date((time + EAT_OFFSET_SECONDS) * 1000);
}
function formatEATTime(time: number): string {
  const d = toEAT(time);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function formatEATDate(time: number): string {
  const d = toEAT(time);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}
function formatEATFull(time: number): string {
  const d = toEAT(time);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatEATDate(time)} ${hh}:${mm} EAT`;
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function bollinger(values: number[], period = 20) {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(mean + 2 * std);
    lower.push(mean - 2 * std);
  }
  return { upper, lower };
}

function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (gain += d) : (loss -= d);
  }
  gain /= period; loss /= period;
  out[period] = 100 - 100 / (1 + gain / (loss || 0.0001));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + gain / (loss || 0.0001));
  }
  return out;
}

// ── Support / Resistance ────────────────────────────────────────────────
// Simple, transparent swing-pivot method (no external TA lib needed):
// a candle is a swing high/low if its high/low is the most extreme within
// `lookback` bars on both sides. Nearby pivots are merged into a single
// zone (by % distance) so a real level shows once, not as a dozen
// almost-identical lines from every touch of it.
interface SRLevel { price: number; kind: "support" | "resistance"; touches: number }
function findSupportResistance(candles: OHLCV[], lookback = 5, mergePct = 0.15, maxLevels = 6): SRLevel[] {
  if (candles.length < lookback * 2 + 1) return [];
  const raw: SRLevel[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) raw.push({ price: c.high, kind: "resistance", touches: 1 });
    if (isLow) raw.push({ price: c.low, kind: "support", touches: 1 });
  }
  // Merge pivots of the same kind that sit within mergePct% of each other.
  const merged: SRLevel[] = [];
  for (const kind of ["support", "resistance"] as const) {
    const pts = raw.filter(r => r.kind === kind).sort((a, b) => a.price - b.price);
    for (const p of pts) {
      const last = merged[merged.length - 1];
      if (last && last.kind === kind && Math.abs(p.price - last.price) / last.price * 100 < mergePct) {
        last.price = (last.price * last.touches + p.price) / (last.touches + 1);
        last.touches += 1;
      } else {
        merged.push({ ...p });
      }
    }
  }
  // Strongest (most-touched) levels closest to current price are the most
  // useful to show — cap the count so the chart doesn't turn into a
  // ladder of lines.
  const lastPrice = candles[candles.length - 1].close;
  return merged
    .sort((a, b) => b.touches - a.touches || Math.abs(a.price - lastPrice) - Math.abs(b.price - lastPrice))
    .slice(0, maxLevels);
}

// ── Order blocks ─────────────────────────────────────────────────────────
// A bullish order block is the last down (red) candle immediately before a
// strong, decisive up move — the idea being that's the last area
// institutional buying likely accumulated before pushing price up, so it
// often acts as support on a retest. A bearish order block is the mirror:
// the last up candle before a strong down move. "Strong" here means the
// breakout candle's body is at least `impulseMult`x the average recent
// body size, which filters routine noise out and keeps only genuinely
// impulsive moves.
interface OrderBlock { top: number; bottom: number; kind: "bullish" | "bearish"; time: number }
function findOrderBlocks(candles: OHLCV[], impulseMult = 1.8, maxBlocks = 4): OrderBlock[] {
  if (candles.length < 15) return [];
  const bodies = candles.map(c => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length || 1;
  const blocks: OrderBlock[] = [];
  for (let i = 1; i < candles.length; i++) {
    const impulse = candles[i];
    const body = Math.abs(impulse.close - impulse.open);
    if (body < avgBody * impulseMult) continue;
    const prev = candles[i - 1];
    const bullishImpulse = impulse.close > impulse.open;
    const prevIsOpposite = bullishImpulse ? prev.close < prev.open : prev.close > prev.open;
    if (!prevIsOpposite) continue;
    blocks.push({
      top: Math.max(prev.open, prev.close),
      bottom: Math.min(prev.open, prev.close),
      kind: bullishImpulse ? "bullish" : "bearish",
      time: Math.floor(prev.time / 1000),
    });
  }
  // Most recent blocks are the ones still relevant to current price action.
  return blocks.slice(-maxBlocks);
}

type Indicator = "ema20" | "ema50" | "bb" | "volume" | "rsi" | "macd" | "sr" | "ob";
type DrawingTool = "none" | "line" | "box";
interface Drawing { id: string; tool: "line" | "box"; t1: number; p1: number; t2: number; p2: number }

export default function ProChart({
  candles, trades, symbol, timeframe, timeframes = DEFAULT_TIMEFRAMES,
  onTimeframeChange, onTradeClick, onUpdateTpSl, orderBook, signalOverlay, backtestOverlay, height = 520,
  loading = false, onRequestMoreHistory,
}: ProChartProps) {
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // Tracks what's already on the chart so the candle-update effect can tell
  // "just the newest bar changed/ticked" apart from "different symbol or
  // timeframe, reload everything" — see that effect for why this matters.
  const lastRenderedRef = useRef<{ symbol: string; timeframe: string; lastTime: number | null }>({ symbol: "", timeframe: "", lastTime: null });

  // trade_id -> { sl?: IPriceLine, tp?: IPriceLine }
  const priceLinesRef = useRef<Map<string, { sl?: IPriceLine; tp?: IPriceLine }>>(new Map());
  const dragRef = useRef<{ tradeId: string; kind: "sl" | "tp" } | null>(null);
  const signalLinesRef = useRef<IPriceLine[]>([]);
  const srLinesRef = useRef<IPriceLine[]>([]);
  const clickCandidateRef = useRef<{ x: number; y: number; time: number | null } | null>(null);

  // Indicator toggles persist across reloads ("make indicators persist if
  // I toggle, save my settings even when reload") — stored once globally
  // rather than per-symbol, since which studies someone likes to see is a
  // chart preference, not something tied to one pair.
  const INDICATOR_STORAGE_KEY = "chart_indicators_v1";
  const DEFAULT_INDICATORS: Record<Indicator, boolean> = {
    ema20: true, ema50: true, bb: false, volume: true, rsi: false, macd: false, sr: false, ob: false,
  };
  const [indicators, setIndicators] = useState<Record<Indicator, boolean>>(() => {
    try {
      const saved = localStorage.getItem(INDICATOR_STORAGE_KEY);
      return saved ? { ...DEFAULT_INDICATORS, ...JSON.parse(saved) } : DEFAULT_INDICATORS;
    } catch { return DEFAULT_INDICATORS; }
  });
  useEffect(() => {
    try { localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(indicators)); } catch { /* storage full/unavailable, non-fatal */ }
  }, [indicators]);
  const [showBook, setShowBook] = useState(true);
  // Popup/fullscreen mode: renders the exact same chart (indicators, RSI/
  // MACD panes, drawing tools, open positions) in a full-viewport overlay
  // instead of the cramped inline card — addresses "only when I click open
  // popup chart and view it" for RSI/MACD/trades/signals actually being
  // readable, especially on desktop where the inline layout is squeezed.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // ── Drawing tools (line / box) ──────────────────────────────────────────
  // A basic hand-drawn trendline/box toolkit — lightweight-charts (the
  // free library used here) doesn't ship one; that's part of TradingView's
  // separately-licensed Advanced Charts product. Drawings are stored as
  // {time, price} pairs (not pixels) so they stay anchored to the right
  // spot on the chart as you pan/zoom, and persist per-symbol so they're
  // still there when you come back to this pair.
  const [drawTool, setDrawTool] = useState<DrawingTool>("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const drawStartRef = useRef<{ time: number; price: number } | null>(null);
  const [, forceRedraw] = useState(0);

  // BUG FIX: this used to key drawings by `symbol` alone, so a trendline
  // drawn on the 1h chart would also (confusingly) show up on the 1d chart
  // for the same pair, and reloading the effect only happened when `symbol`
  // changed — switching timeframe on the same pair never reloaded anything,
  // so it looked like drawings "worked" until you changed timeframe, at
  // which point they silently kept showing the wrong set. Keying by
  // `symbol + timeframe` and reloading on either change gives every
  // pair/timeframe combination its own persisted drawing set, exactly as
  // requested ("persist in every timeframe").
  const drawingKey = `chart_drawings_${symbol}_${timeframe}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(drawingKey);
      setDrawings(saved ? JSON.parse(saved) : []);
    } catch { setDrawings([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  const drawingKeyRef = useRef(drawingKey);
  useEffect(() => { drawingKeyRef.current = drawingKey; }, [drawingKey]);

  const saveDrawings = (next: Drawing[]) => {
    setDrawings(next);
    try { localStorage.setItem(drawingKeyRef.current, JSON.stringify(next)); } catch { /* storage full/unavailable, non-fatal */ }
  };

  // Arrows on the chart are for ACTIVE trades only — closed trades are
  // history, not something you need to act on, and mixing the two made it
  // hard to tell at a glance what's still open on this pair.
  const symbolTrades = useMemo(
    () => trades.filter(t => t.pair === symbol && t.status === "FILLED"),
    [trades, symbol]
  );

  // Refs so the mouse-handler effect (set up once on mount) always sees
  // current values without needing to be re-attached on every render.
  const drawToolRef = useRef<DrawingTool>("none");
  const previewRef = useRef<{ time: number; price: number } | null>(null);
  const forceRedrawRef = useRef(() => {});
  const addDrawingRef = useRef((_d: Drawing) => {});
  const onUpdateTplRef = useRef(onUpdateTpSl);
  const onTradeClickRef = useRef(onTradeClick);
  const symbolTradesRef = useRef(symbolTrades);
  useEffect(() => { drawToolRef.current = drawTool; }, [drawTool]);
  useEffect(() => { forceRedrawRef.current = () => forceRedraw(n => n + 1); });
  useEffect(() => { addDrawingRef.current = (d: Drawing) => saveDrawings([...drawings, d]); }, [drawings]);
  useEffect(() => { onUpdateTplRef.current = onUpdateTpSl; }, [onUpdateTpSl]);
  useEffect(() => { onTradeClickRef.current = onTradeClick; }, [onTradeClick]);
  useEffect(() => { symbolTradesRef.current = symbolTrades; }, [symbolTrades]);

  // ── Chart + series setup (once) ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: cssVar("--surface2", "#080e18") }, textColor: cssVar("--text-dim", "#4a6080") },
      grid: { vertLines: { color: cssVar("--border2", "#0d1a2a") }, horzLines: { color: cssVar("--border2", "#0d1a2a") } },
      rightPriceScale: { borderColor: cssVar("--border2", "#0d1a2a") },
      timeScale: {
        borderColor: cssVar("--border2", "#0d1a2a"), timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (time: number) => formatEATTime(time),
      },
      localization: {
        timeFormatter: (time: number) => formatEATFull(time),
      },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00d084", downColor: "#ff4757", borderVisible: false,
      wickUpColor: "#00d084", wickDownColor: "#ff4757",
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    ema20Ref.current = chart.addSeries(LineSeries, { color: "#f5a623", lineWidth: 1, priceLineVisible: false });
    ema50Ref.current = chart.addSeries(LineSeries, { color: "#4da6ff", lineWidth: 1, priceLineVisible: false });
    bbUpperRef.current = chart.addSeries(LineSeries, { color: "#8a5cf6", lineWidth: 1, priceLineVisible: false });
    bbLowerRef.current = chart.addSeries(LineSeries, { color: "#8a5cf6", lineWidth: 1, priceLineVisible: false });

    // Secondary panes for RSI / MACD — created up front and hidden via
    // pane height rather than added/removed, so paneIndex stays stable
    // regardless of which indicators are toggled.
    rsiRef.current = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1 }, 1);
    macdRef.current = chart.addSeries(HistogramSeries, { color: "#4da6ff" }, 2);
    chart.panes()[1]?.setHeight(0);
    chart.panes()[2]?.setHeight(0);

    // ── Mouse interaction: drag SL/TP, click a trade marker to edit, or draw ──
    const el = containerRef.current;
    const HIT_PX = 6;

    const priceAtY = (y: number) => candleSeries.coordinateToPrice(y);
    const yAtPrice = (p: number) => candleSeries.priceToCoordinate(p);
    const timeAtX = (x: number) => chart.timeScale().coordinateToTime(x) as number | null;

    const onMouseDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (drawToolRef.current !== "none") {
        const time = timeAtX(x);
        const price = priceAtY(y);
        if (time != null && price != null) {
          drawStartRef.current = { time, price };
          // BUG FIX: this never disabled chart pan/zoom while drawing, so
          // click-dragging to draw a line/box also panned the chart at the
          // same time — the drawing would land somewhere other than where
          // you dragged, or seem to not draw at all. Same fix already
          // applied to SL/TP dragging below; drawing needs it too.
          chart.applyOptions({ handleScroll: false, handleScale: false });
        }
        return;
      }

      // SL/TP line drag takes priority over marker-click detection.
      for (const [tradeId, lines] of priceLinesRef.current.entries()) {
        for (const kind of ["sl", "tp"] as const) {
          const line = lines[kind];
          if (!line) continue;
          const ly = yAtPrice(line.options().price);
          if (ly != null && Math.abs(ly - y) <= HIT_PX) {
            dragRef.current = { tradeId, kind };
            chart.applyOptions({ handleScroll: false, handleScale: false });
            return;
          }
        }
      }

      // Otherwise, remember where mousedown happened — if mouseup lands
      // very close to the same spot (a click, not a pan-drag) AND it's
      // near a trade's entry point, treat it as "open this trade".
      clickCandidateRef.current = { x, y, time: timeAtX(x) };
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (drawStartRef.current) {
        const time = timeAtX(x);
        const price = priceAtY(y);
        if (time != null && price != null) {
          previewRef.current = { time, price };
          forceRedrawRef.current();
        }
        return;
      }
      if (!dragRef.current) return;
      const price = priceAtY(y);
      if (price == null) return;
      const lines = priceLinesRef.current.get(dragRef.current.tradeId);
      const line = lines?.[dragRef.current.kind];
      line?.applyOptions({ price });
    };

    const onMouseUp = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (drawStartRef.current) {
        const time = timeAtX(x);
        const price = priceAtY(y);
        if (time != null && price != null && drawToolRef.current !== "none") {
          const d: Drawing = {
            id: `d_${Date.now()}`, tool: drawToolRef.current,
            t1: drawStartRef.current.time, p1: drawStartRef.current.price, t2: time, p2: price,
          };
          addDrawingRef.current(d);
        }
        drawStartRef.current = null;
        previewRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        forceRedrawRef.current();
        return;
      }

      if (dragRef.current) {
        const { tradeId, kind } = dragRef.current;
        const lines = priceLinesRef.current.get(tradeId);
        const line = lines?.[kind];
        const finalPrice = line?.options().price;
        dragRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        if (finalPrice != null && onUpdateTplRef.current) {
          onUpdateTplRef.current(tradeId, kind === "sl" ? { stop_loss: finalPrice } : { take_profit: finalPrice });
        }
        return;
      }

      const start = clickCandidateRef.current;
      clickCandidateRef.current = null;
      if (!start || !onTradeClickRef.current) return;
      const movedPx = Math.hypot(x - start.x, y - start.y);
      if (movedPx > 4) return; // treat as a pan, not a click
      if (start.time == null) return;

      // Find the closest trade marker within a small time+price window.
      let closest: Trade | null = null;
      let closestDist = Infinity;
      for (const t of symbolTradesRef.current) {
        const tTime = Math.floor((t.created_at ? t.created_at * 1000 : t.timestamp || 0) / 1000);
        const ty = yAtPrice(t.price);
        const tx = chart.timeScale().timeToCoordinate(tTime as Time);
        if (ty == null || tx == null) continue;
        const dist = Math.hypot(tx - start.x, ty - start.y);
        if (dist < closestDist) { closestDist = dist; closest = t; }
      }
      if (closest && closestDist <= 14) onTradeClickRef.current(closest);
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // Keep the drawing overlay's pixel positions in sync as the visible
    // range changes (pan/zoom) — drawings are stored as time/price, not
    // pixels, so they need re-projecting whenever the view moves.
    chart.timeScale().subscribeVisibleTimeRangeChange(() => forceRedrawRef.current());
    const onWindowResize = () => forceRedrawRef.current();
    window.addEventListener("resize", onWindowResize);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onWindowResize);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // chart is created once; data updates happen in the effects below

  // Re-apply theme colors to the chart's canvas config when auto/dark/light
  // changes — the chart doesn't sit in the DOM's CSSOM, so toggling
  // data-theme on <html> alone doesn't repaint it the way it repaints
  // regular styled elements. This only touches layout/grid/scale chrome,
  // not series data, so it's cheap and doesn't disturb candles/markers/
  // drawings.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { background: { color: cssVar("--surface2", "#080e18") }, textColor: cssVar("--text-dim", "#4a6080") },
      grid: { vertLines: { color: cssVar("--border2", "#0d1a2a") }, horzLines: { color: cssVar("--border2", "#0d1a2a") } },
      rightPriceScale: { borderColor: cssVar("--border2", "#0d1a2a") },
      timeScale: { borderColor: cssVar("--border2", "#0d1a2a") },
    });
  }, [resolved]);

  // ── Push candle/volume data ─────────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    const volSeries = volumeSeriesRef.current;
    if (!series || !volSeries || candles.length === 0) return;
    // BUG FIX: switching symbol/timeframe changes the `symbol`/`timeframe`
    // props one render before the parent's `candles` state catches up
    // (it's still awaiting the fetch) — this effect used to fire on that
    // very render, saw `isNewView = true` from the prop change, and pushed
    // the OLD symbol's candles into the chart as if they were the new
    // symbol's data (wrong price scale entirely), then patched real data
    // on top a moment later once the fetch resolved. That mismatch is what
    // showed up as the chart "getting malformed" right after a switch.
    // While the parent is loading, skip every push and leave whatever's
    // already rendered on screen alone; once `loading` clears, `candles`
    // is guaranteed to already be the new view's real data.
    if (loading) return;

    const prev = lastRenderedRef.current;
    const isNewView = prev.symbol !== symbol || prev.timeframe !== timeframe;

    if (isNewView) {
      // Genuine reload (switched pair/timeframe, or first load): replace
      // everything and fit the view. This is the ONE case a reset makes sense.
      //
      // BUG FIX: lightweight-charts throws (crashing the whole chart, which
      // is what showed up as "changing timeframe brings error") if the data
      // handed to setData() isn't strictly ascending by time, or contains
      // two bars with the same time. That could happen whenever the
      // candles feed mixed real and simulated data, or a fetch raced a
      // symbol/timeframe switch. Sorting + de-duplicating here is a cheap
      // guarantee that never blows up the chart even if the data feed
      // upstream ever hiccups again.
      const sorted = [...candles].sort((a, b) => a.time - b.time);
      const deduped: OHLCV[] = [];
      for (const c of sorted) {
        if (deduped.length && deduped[deduped.length - 1].time === c.time) deduped[deduped.length - 1] = c;
        else deduped.push(c);
      }
      const data = deduped.map(c => ({
        time: Math.floor(c.time / 1000) as Time, open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      series.setData(data);
      volSeries.setData(deduped.map(c => ({
        time: Math.floor(c.time / 1000) as Time, value: c.volume,
        color: c.close >= c.open ? "#00d08466" : "#ff475766",
      })));
      chartRef.current?.timeScale().fitContent();
    } else {
      // BUG FIX: this used to call setData() + fitContent() on every
      // ~15s poll for the SAME pair/timeframe, which reset the user's
      // zoom/pan back to "fit everything" every single time — the chart
      // would visibly jump every 15 seconds no matter what you were doing.
      // Now only the bar(s) that actually changed are pushed via update(),
      // which lightweight-charts handles as an in-place refresh (a still-
      // forming candle) or a smooth append (a new candle), without
      // touching the visible range at all.
      const lastTime = prev.lastTime;
      const changed = (lastTime == null ? candles : candles.filter(c => Math.floor(c.time / 1000) >= lastTime))
        .slice()
        .sort((a, b) => a.time - b.time);
      for (const c of changed) {
        series.update({ time: Math.floor(c.time / 1000) as Time, open: c.open, high: c.high, low: c.low, close: c.close });
        volSeries.update({ time: Math.floor(c.time / 1000) as Time, value: c.volume, color: c.close >= c.open ? "#00d08466" : "#ff475766" });
      }
    }
    lastRenderedRef.current = { symbol, timeframe, lastTime: Math.floor(candles[candles.length - 1].time / 1000) };
  }, [candles, symbol, timeframe, loading]);

  // ── Indicator overlays ──────────────────────────────────────────────────
  useEffect(() => {
    const closes = candles.map(c => c.close);
    const times = candles.map(c => Math.floor(c.time / 1000) as Time);

    if (ema20Ref.current) {
      ema20Ref.current.applyOptions({ visible: indicators.ema20 });
      if (indicators.ema20) ema20Ref.current.setData(ema(closes, 20).map((v, i) => ({ time: times[i], value: v })));
    }
    if (ema50Ref.current) {
      ema50Ref.current.applyOptions({ visible: indicators.ema50 });
      if (indicators.ema50) ema50Ref.current.setData(ema(closes, 50).map((v, i) => ({ time: times[i], value: v })));
    }
    if (bbUpperRef.current && bbLowerRef.current) {
      bbUpperRef.current.applyOptions({ visible: indicators.bb });
      bbLowerRef.current.applyOptions({ visible: indicators.bb });
      if (indicators.bb) {
        const { upper, lower } = bollinger(closes, 20);
        bbUpperRef.current.setData(upper.map((v, i) => v == null ? null : { time: times[i], value: v }).filter(Boolean) as any);
        bbLowerRef.current.setData(lower.map((v, i) => v == null ? null : { time: times[i], value: v }).filter(Boolean) as any);
      }
    }
    if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: indicators.volume });

    // More vertical room for RSI/MACD in the fullscreen popup — the whole
    // point of "open popup and view it" was these being too squeezed to
    // read in the inline card.
    const paneHeight = fullscreen ? 170 : 120;
    const rsiPane = chartRef.current?.panes()[1];
    if (rsiRef.current && rsiPane) {
      rsiPane.setHeight(indicators.rsi ? paneHeight : 0);
      if (indicators.rsi) {
        rsiRef.current.setData(rsiSeries(closes).map((v, i) => v == null ? null : { time: times[i], value: v }).filter(Boolean) as any);
      }
    }
    const macdPane = chartRef.current?.panes()[2];
    if (macdRef.current && macdPane) {
      macdPane.setHeight(indicators.macd ? paneHeight : 0);
      if (indicators.macd) {
        const e12 = ema(closes, 12), e26 = ema(closes, 26);
        const hist = e12.map((v, i) => v - e26[i]);
        macdRef.current.setData(hist.map((v, i) => ({
          time: times[i], value: v, color: v >= 0 ? "#00d08488" : "#ff475788",
        })));
      }
    }
  }, [candles, indicators, fullscreen]);

  // ── Trade markers + SL/TP price lines ───────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || candles.length === 0) return;

    // BUG FIX: markers used the trade's raw execution timestamp directly.
    // lightweight-charts only draws a marker when its `time` matches one of
    // the series' actual bar times exactly — a trade filled at, say,
    // 14:23:07 doesn't line up with an hourly candle's 14:00:00 bar, so the
    // marker silently failed to render at all. That's why an active trade's
    // arrow would "disappear" (especially right after it opened, or after
    // switching timeframe to one with different bucket boundaries). Snap
    // each trade's time down to the candle bar it actually falls within.
    const candleTimes = candles.map(c => Math.floor(c.time / 1000));
    const snapToBar = (rawSeconds: number): number | null => {
      if (!candleTimes.length || rawSeconds < candleTimes[0]) return null;
      let result = candleTimes[0];
      for (const t of candleTimes) {
        if (t <= rawSeconds) result = t; else break;
      }
      return result;
    };

    const entryMarkers: SeriesMarker<Time>[] = symbolTrades
      .map(t => {
        const raw = Math.floor((t.created_at ? t.created_at * 1000 : t.timestamp || 0) / 1000);
        const snapped = snapToBar(raw);
        if (snapped == null) return null;
        return {
          time: snapped as Time,
          position: t.side === "BUY" ? "belowBar" : "aboveBar",
          color: t.side === "BUY" ? "#00d084" : "#ff4757",
          shape: t.side === "BUY" ? "arrowUp" : "arrowDown",
          text: `${t.side} ${t.amount}`,
        } as SeriesMarker<Time>;
      })
      .filter((m): m is SeriesMarker<Time> => m !== null);

    const markers = entryMarkers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);

    // Rebuild SL/TP price lines for currently open trades on this symbol.
    for (const lines of priceLinesRef.current.values()) {
      if (lines.sl) series.removePriceLine(lines.sl);
      if (lines.tp) series.removePriceLine(lines.tp);
    }
    priceLinesRef.current.clear();

    for (const t of symbolTrades) {
      const lines: { sl?: IPriceLine; tp?: IPriceLine } = {};
      if (t.stop_loss) {
        lines.sl = series.createPriceLine({
          price: t.stop_loss, color: "#ff4757", lineWidth: 2, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "SL",
        });
      }
      if (t.take_profit) {
        lines.tp = series.createPriceLine({
          price: t.take_profit, color: "#00d084", lineWidth: 2, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "TP",
        });
      }
      if (lines.sl || lines.tp) priceLinesRef.current.set(t.id, lines);
    }
  }, [symbolTrades, candles]);

  // ── Signal overlay: entry/target/stop from a clicked signal ────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of signalLinesRef.current) series.removePriceLine(line);
    signalLinesRef.current = [];

    if (signalOverlay) {
      const entryLine = series.createPriceLine({
        price: signalOverlay.price, color: cssVar("--text-dim", "#4a6080"), lineWidth: 1, lineStyle: LineStyle.Dotted,
        axisLabelVisible: true, title: "Entry",
      });
      const targetLine = series.createPriceLine({
        price: signalOverlay.targetPrice, color: "#00d084", lineWidth: 2, lineStyle: LineStyle.Dotted,
        axisLabelVisible: true, title: "Target",
      });
      const stopLine = series.createPriceLine({
        price: signalOverlay.stopLoss, color: "#ff4757", lineWidth: 2, lineStyle: LineStyle.Dotted,
        axisLabelVisible: true, title: "Stop",
      });
      signalLinesRef.current = [entryLine, targetLine, stopLine];
    } else if (backtestOverlay) {
      const winColor = backtestOverlay.result === "WIN" ? "#00d084" : "#ff4757";
      const entryLine = series.createPriceLine({
        price: backtestOverlay.entryPrice, color: cssVar("--text-dim", "#4a6080"), lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: "Entry",
      });
      const exitLine = series.createPriceLine({
        price: backtestOverlay.exitPrice, color: winColor, lineWidth: 2, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: "Exit",
      });
      signalLinesRef.current = [entryLine, exitLine];
    }

    return () => {
      for (const line of signalLinesRef.current) {
        try { series.removePriceLine(line); } catch { /* series may already be gone */ }
      }
      signalLinesRef.current = [];
    };
  }, [signalOverlay, backtestOverlay]);

  // ── Support / resistance lines ──────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of srLinesRef.current) {
      try { series.removePriceLine(line); } catch { /* series may already be gone */ }
    }
    srLinesRef.current = [];
    if (!indicators.sr) return;
    const levels = findSupportResistance(candles);
    srLinesRef.current = levels.map(lvl => series.createPriceLine({
      price: lvl.price,
      color: lvl.kind === "resistance" ? "#ff4757" : "#00d084",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: lvl.kind === "resistance" ? "R" : "S",
    }));
    return () => {
      for (const line of srLinesRef.current) {
        try { series.removePriceLine(line); } catch { /* series may already be gone */ }
      }
      srLinesRef.current = [];
    };
  }, [candles, indicators.sr]);

  // Order blocks are drawn as time/price-anchored rectangles in the same
  // SVG overlay used for hand-drawn lines/boxes (below), since
  // lightweight-charts' price lines are horizontal-only and can't express
  // a block's left/right time bounds.
  const orderBlocks = useMemo(
    () => (indicators.ob ? findOrderBlocks(candles) : []),
    [candles, indicators.ob]
  );

  // ── Crosshair OHLC readout ───────────────────────────────────────────────
  // "make my chart premium" + "h,l in candles" — a live legend that tracks
  // the crosshair (or the latest bar, at rest) showing O/H/L/C the way a
  // paid charting product does, instead of only exposing high/low via the
  // hover tooltip the library draws itself.
  const [hoverBar, setHoverBar] = useState<OHLCV | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: any) => {
      if (!param || param.time == null) { setHoverBar(null); return; }
      const bar = candles.find(c => Math.floor(c.time / 1000) === (param.time as number));
      setHoverBar(bar ?? null);
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);
  const legendBar = hoverBar ?? candles[candles.length - 1] ?? null;

  // ── Load older history on scroll-back ───────────────────────────────────
  // Fires onRequestMoreHistory (debounced) once the visible range's left
  // edge gets within ~10 bars of the oldest candle currently loaded.
  const lastHistoryRequestRef = useRef(0);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onRequestMoreHistory) return;
    const handler = (range: { from: number; to: number } | null) => {
      if (!range) return;
      if (range.from <= 10) {
        const now = Date.now();
        if (now - lastHistoryRequestRef.current > 2000) {
          lastHistoryRequestRef.current = now;
          onRequestMoreHistory();
        }
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [onRequestMoreHistory]);

  const toggle = (k: Indicator) => setIndicators(p => ({ ...p, [k]: !p[k] }));

  // Converts a stored {time, price} point to pixel coordinates for the SVG
  // drawing overlay. Returns null if the point is off-screen or the chart
  // isn't ready yet — callers skip rendering that point.
  const projectPoint = (time: number, price: number): { x: number; y: number } | null => {
    const chart = chartRef.current, series = candleSeriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(time as Time);
    const y = series.priceToCoordinate(price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  // Open positions for this pair — a clearer, more prominent list than the
  // small "view trade" buttons alone, showing live unrealized P&L per
  // position (was previously easy to miss which trades were actually open
  // on the pair you had selected).
  const openPositions = symbolTrades.map(t => {
    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle?.close ?? t.price;
    const pnl = t.side === "BUY" ? (currentPrice - t.price) * t.amount : (t.price - currentPrice) * t.amount;
    return { trade: t, currentPrice, pnl };
  });

  return (
    <div style={fullscreen
      ? { position: "fixed", inset: 0, zIndex: 4000, background: "var(--bg2)", display: "flex", flexDirection: "column", padding: 10 }
      : { display: "flex", flexDirection: "column", height: "100%", width: "100%" }
    }>
      {signalOverlay && (
        <div style={{
          display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center",
          padding: "8px 12px", margin: "4px", borderRadius: 8,
          background: "var(--surface)", border: `1px solid ${signalOverlay.type === "BUY" ? "#00d08444" : "#ff475744"}`,
          fontSize: 11,
        }}>
          <span style={{
            fontWeight: 800, padding: "2px 8px", borderRadius: 4, fontSize: 10,
            background: signalOverlay.type === "BUY" ? "#00d084" : "#ff4757", color: "#000",
          }}>{signalOverlay.type} SIGNAL</span>
          <span style={{ color: "var(--text-dim)" }}>Entry <b style={{ color: "var(--text)" }}>${signalOverlay.price.toFixed(4)}</b></span>
          <span style={{ color: "var(--text-dim)" }}>Target <b style={{ color: "#00d084" }}>${signalOverlay.targetPrice.toFixed(4)}</b></span>
          <span style={{ color: "var(--text-dim)" }}>Stop <b style={{ color: "#ff4757" }}>${signalOverlay.stopLoss.toFixed(4)}</b></span>
          {signalOverlay.confidence != null && <span style={{ color: "var(--text-dim)" }}>Confidence <b style={{ color: "var(--text)" }}>{signalOverlay.confidence.toFixed(0)}%</b></span>}
          {signalOverlay.reason && <span style={{ color: "var(--text-dim)", flexBasis: "100%" }}>{signalOverlay.reason}</span>}
        </div>
      )}
      {backtestOverlay && (
        <div style={{
          display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center",
          padding: "8px 12px", margin: "4px", borderRadius: 8,
          background: "var(--surface)", border: `1px solid ${backtestOverlay.result === "WIN" ? "#00d08444" : "#ff475744"}`,
          fontSize: 11,
        }}>
          <span style={{
            fontWeight: 800, padding: "2px 8px", borderRadius: 4, fontSize: 10,
            background: backtestOverlay.result === "WIN" ? "#00d084" : "#ff4757", color: "#000",
          }}>BACKTEST {backtestOverlay.result}</span>
          <span style={{ color: "var(--text-dim)" }}>{backtestOverlay.side} entry <b style={{ color: "var(--text)" }}>${backtestOverlay.entryPrice.toFixed(4)}</b></span>
          <span style={{ color: "var(--text-dim)" }}>Exit <b style={{ color: backtestOverlay.result === "WIN" ? "#00d084" : "#ff4757" }}>${backtestOverlay.exitPrice.toFixed(4)}</b></span>
          <span style={{ color: "var(--text-dim)" }}>PnL <b style={{ color: backtestOverlay.pnlPct >= 0 ? "#00d084" : "#ff4757" }}>{backtestOverlay.pnlPct.toFixed(2)}%</b></span>
        </div>
      )}
      {/* Toolbar: timeframes + indicator toggles */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 4px", alignItems: "center" }}>
        {timeframes.map(tf => (
          <button key={tf} onClick={() => onTimeframeChange?.(tf)}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
              background: tf === timeframe ? "#0094ff" : "var(--surface)",
              color: tf === timeframe ? "#fff" : "var(--text-dim)",
              border: `1px solid ${tf === timeframe ? "#0094ff" : "var(--border2)"}`,
            }}>{tf}</button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border2)", margin: "0 4px" }} />
        {(["ema20", "ema50", "bb", "volume", "rsi", "macd", "sr", "ob"] as Indicator[]).map(k => (
          <button key={k} onClick={() => toggle(k)}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
              background: indicators[k] ? "#0094ff22" : "var(--surface)",
              color: indicators[k] ? "#0094ff" : "var(--text-dim)",
              border: `1px solid ${indicators[k] ? "#0094ff" : "var(--border2)"}`,
            }}>{k.toUpperCase()}</button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border2)", margin: "0 4px" }} />
        {([["none", "↖"], ["line", "╱ Line"], ["box", "▭ Box"]] as [DrawingTool, string][]).map(([tool, label]) => (
          <button key={tool} onClick={() => setDrawTool(tool)} title={tool === "none" ? "Cursor (pan/zoom)" : `Draw ${tool}`}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
              background: drawTool === tool ? "#ffd70022" : "var(--surface)",
              color: drawTool === tool ? "#ffd700" : "var(--text-dim)",
              border: `1px solid ${drawTool === tool ? "#ffd700" : "var(--border2)"}`,
            }}>{label}</button>
        ))}
        {drawings.length > 0 && (
          <button onClick={() => saveDrawings([])} title="Clear all drawings"
            style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: "transparent", color: "#ff4757", border: "1px solid #ff475744" }}>
            Clear
          </button>
        )}
        <button onClick={() => setShowBook(s => !s)}
          style={{ marginLeft: fullscreen ? 0 : "auto", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border2)" }}>
          {showBook ? "▶ Book" : "◀ Book"}
        </button>
        <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Close (Esc)" : "Expand chart"}
          style={{ marginLeft: fullscreen ? 8 : 0, padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: fullscreen ? "#ff475718" : "#0094ff18", color: fullscreen ? "#ff4757" : "#0094ff", border: `1px solid ${fullscreen ? "#ff475744" : "#0094ff44"}` }}>
          {fullscreen ? "✕ Close" : "⛶ Expand"}
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 8 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0, height: fullscreen ? "auto" : height }}>
          <div ref={containerRef} style={{ width: "100%", height: "100%", cursor: drawTool !== "none" ? "crosshair" : "default" }} />

          {/* OHLC legend — tracks the crosshair, falls back to the latest
              bar at rest. "h,l in candles" + general premium-chart feel. */}
          {legendBar && (
            <div style={{
              position: "absolute", top: 6, left: 8, zIndex: 2, pointerEvents: "none",
              display: "flex", gap: 10, fontSize: 11, fontFamily: "monospace",
              background: "rgba(8,14,24,0.85)", padding: "3px 8px", borderRadius: 6,
              border: "1px solid var(--border2)",
            }}>
              <span style={{ color: "var(--text-dim)" }}>O <b style={{ color: "var(--text)" }}>{legendBar.open.toFixed(4)}</b></span>
              <span style={{ color: "var(--text-dim)" }}>H <b style={{ color: "#00d084" }}>{legendBar.high.toFixed(4)}</b></span>
              <span style={{ color: "var(--text-dim)" }}>L <b style={{ color: "#ff4757" }}>{legendBar.low.toFixed(4)}</b></span>
              <span style={{ color: "var(--text-dim)" }}>C <b style={{ color: legendBar.close >= legendBar.open ? "#00d084" : "#ff4757" }}>{legendBar.close.toFixed(4)}</b></span>
            </div>
          )}

          {/* "Updating…" pill — shown while a fetch is in flight, over
              whatever candles are already rendered, so the chart never
              blanks or shows a half-formed state mid-update. */}
          {loading && (
            <div style={{
              position: "absolute", top: 6, right: 8, zIndex: 2, pointerEvents: "none",
              display: "flex", alignItems: "center", gap: 6, fontSize: 11,
              background: "rgba(8,14,24,0.85)", padding: "3px 9px", borderRadius: 6,
              border: "1px solid var(--border2)", color: "var(--text-dim)",
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#0094ff",
                animation: "pcPulse 1s ease-in-out infinite",
              }} />
              Updating chart…
            </div>
          )}
          <style>{"@keyframes pcPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }"}</style>

          {/* Drawing overlay — pure visual, pointer-events disabled so all
              mouse interaction still goes through the chart container's
              own handlers (which do the actual time/price math). */}
          <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", width: "100%", height: "100%" }}>
            {indicators.ob && orderBlocks.map((b, i) => {
              const lastTime = Math.floor((candles[candles.length - 1]?.time ?? 0) / 1000);
              const a = projectPoint(b.time, b.top);
              const c = projectPoint(lastTime, b.bottom);
              if (!a || !c) return null;
              const color = b.kind === "bullish" ? "#00d084" : "#ff4757";
              return (
                <rect key={`ob_${i}`} x={a.x} y={a.y} width={Math.max(0, c.x - a.x)} height={Math.max(0, c.y - a.y)}
                  fill={`${color}14`} stroke={color} strokeWidth={1} strokeDasharray="3 3" />
              );
            })}
            {drawings.map(d => {
              const a = projectPoint(d.t1, d.p1), b = projectPoint(d.t2, d.p2);
              if (!a || !b) return null;
              if (d.tool === "line") {
                return <line key={d.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd700" strokeWidth={2} />;
              }
              const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
              return <rect key={d.id} x={x} y={y} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="#ffd70014" stroke="#ffd700" strokeWidth={1.5} />;
            })}
            {drawStartRef.current && previewRef.current && (() => {
              const a = projectPoint(drawStartRef.current.time, drawStartRef.current.price);
              const b = projectPoint(previewRef.current.time, previewRef.current.price);
              if (!a || !b) return null;
              if (drawTool === "line") return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd700" strokeWidth={2} strokeDasharray="4 3" />;
              const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
              return <rect x={x} y={y} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="#ffd70014" stroke="#ffd700" strokeWidth={1.5} strokeDasharray="4 3" />;
            })()}
          </svg>
        </div>
        {showBook && orderBook && (
          <div style={{ width: 180, overflowY: "auto", fontSize: 11, fontFamily: "monospace" }}>
            <div style={{ color: "#ff4757", marginBottom: 4 }}>ASKS</div>
            {orderBook.asks.slice(0, 12).reverse().map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", color: "#ff4757" }}>
                <span>{a.price.toFixed(2)}</span><span style={{ color: "var(--text-dim)" }}>{a.size.toFixed(3)}</span>
              </div>
            ))}
            <div style={{ height: 1, background: "var(--border2)", margin: "6px 0" }} />
            <div style={{ color: "#00d084", marginBottom: 4 }}>BIDS</div>
            {orderBook.bids.slice(0, 12).map((b, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", color: "#00d084" }}>
                <span>{b.price.toFixed(2)}</span><span style={{ color: "var(--text-dim)" }}>{b.size.toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open positions for this pair — click to edit (drag the SL/TP lines
          above, or click here to open the full edit modal). */}
      {openPositions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 4px", maxHeight: 110, overflowY: "auto" }}>
          {openPositions.map(({ trade: t, currentPrice, pnl }) => (
            <div key={t.id} onClick={() => onTradeClick?.(t)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                padding: "5px 9px", borderRadius: 6, cursor: onTradeClick ? "pointer" : "default",
                background: "var(--surface)", border: "1px solid var(--border2)", fontSize: 11,
              }}>
              <span style={{ color: t.side === "BUY" ? "#00d084" : "#ff4757", fontWeight: 700 }}>{t.side}</span>
              <span style={{ color: "var(--text-dim)" }}>Entry {t.price.toFixed(4)}</span>
              <span style={{ color: "var(--text-dim)" }}>Now {currentPrice.toFixed(4)}</span>
              <span style={{ color: pnl >= 0 ? "#00d084" : "#ff4757", fontWeight: 700, marginLeft: "auto" }}>
                {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
