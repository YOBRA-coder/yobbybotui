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
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type Logical,
} from "lightweight-charts";
import type { OHLCV, Trade, SMCResponse } from "../types";
import BotActivityPanel from "./BotActivityPanel";
import SmcDecisionPanel from "./SmcDecisionPanel";
import { useTheme } from "../context/ThemeContext";
import { marketApi } from "../api/client";

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
  // "show which bot is active in charts" — the full bot list; the component
  // filters to the ones running on `symbol` itself and renders a strip
  // above the chart plus per-position ownership labels below it.
  bots?: ChartBot[];
  onBotClick?: (botId: string) => void;
  // Auth token — when given, the chart shows a live "Bot activity" feed for
  // the bots running on this pair (what each looked at and why it did or
  // didn't trade). Omit it (history/signal previews) and the feed is hidden.
  token?: string | null;
}

// Deliberately a structural subset of types/index.ts's Bot rather than an
// import of it, so ProChart stays usable by anything that can supply these
// few fields (viewPro, backtest previews) without dragging the whole Bot
// shape along.
export interface ChartBot {
  id: string;
  name: string;
  pair: string;
  strategy: string;
  status: string;
  mode?: string;
  market_signal?: string | null;
  market_confidence?: number | null;
  timeframe?: string | null;
}

const DEFAULT_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

// Multi-timeframe: given the chart's current timeframe, which one counts as
// "higher" and which as "lower" for the MTF bias strip.
const TF_LADDER = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
function neighborTimeframes(tf: string): { lower: string | null; higher: string | null } {
  const i = TF_LADDER.indexOf(tf);
  if (i === -1) return { lower: null, higher: null };
  return { lower: i > 0 ? TF_LADDER[i - 1] : null, higher: i < TF_LADDER.length - 1 ? TF_LADDER[i + 1] : null };
}

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
interface OrderBlock {
  top: number; bottom: number; kind: "bullish" | "bearish";
  time: number;        // bar time (seconds) of the origin candle
  mitigated: boolean;  // price has since traded back through the block
  strength: number;    // impulse body / average body — how decisive the move was
}

// BUG FIX (why order blocks "didn't work"):
//  1. avgBody was averaged over EVERY loaded candle — and the chart now
//     loads up to 800+ bars on scroll-back. One volatile stretch anywhere
//     in that history dragged the average up so far that nothing in the
//     recent, visible range ever cleared impulseMult x avgBody, so the
//     detector returned an empty array and the overlay drew nothing.
//     avgBody is now a ROLLING 20-bar average measured just before the
//     impulse, so "decisive" means decisive relative to what the market
//     was doing at that moment.
//  2. It required the immediately-preceding candle to be the opposite
//     colour. Real impulses usually start from a small 1-3 bar base, so
//     that one-bar rule discarded most genuine blocks. Now it walks back
//     up to 3 bars to find the origin candle.
//  3. Blocks that price has already traded straight back through are no
//     longer tradeable levels, but were still drawn identically to fresh
//     ones. They're now flagged `mitigated` and rendered faded, and fresh
//     blocks are preferred when trimming to maxBlocks.
function findOrderBlocksPass(candles: OHLCV[], impulseMult: number, originLookback: number): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const lastPrice = candles[candles.length - 1].close;

  for (let i = 21; i < candles.length; i++) {
    const impulse = candles[i];
    const body = Math.abs(impulse.close - impulse.open);
    // Rolling baseline: the 20 bars immediately BEFORE this one.
    const window = candles.slice(i - 20, i);
    const avgBody = window.reduce((a, c) => a + Math.abs(c.close - c.open), 0) / window.length || 1;
    if (body < avgBody * impulseMult) continue;

    const bullishImpulse = impulse.close > impulse.open;
    // Walk back for the last opposite-coloured candle — the "base" the
    // impulse launched from.
    let origin: OHLCV | null = null;
    for (let back = 1; back <= originLookback && i - back >= 0; back++) {
      const c = candles[i - back];
      const isOpposite = bullishImpulse ? c.close < c.open : c.close > c.open;
      if (isOpposite) { origin = c; break; }
    }
    // BUG FIX ("order blocks not showing"): requiring a strictly
    // opposite-coloured candle within the lookback discarded a large share
    // of real impulses — a continuation run (several same-direction bars
    // then one much larger one) has no opposite candle to anchor to at
    // all, and on real market data that pattern is common enough that it
    // was routinely the reason this came back empty. Falling back to the
    // single candle immediately before the impulse — regardless of colour
    // — is what most order-block implementations actually do; a true
    // opposite-coloured base is preferred when one exists, but its absence
    // is no longer a reason to draw nothing.
    if (!origin) origin = candles[i - 1];
    if (!origin) continue;

    const top = Math.max(origin.open, origin.close);
    const bottom = Math.min(origin.open, origin.close);
    if (top === bottom) continue; // a flat/zero-range base isn't a usable zone
    // Mitigated = price has closed back through the far side of the block
    // at some point after it formed.
    let mitigated = false;
    for (let j = i + 1; j < candles.length; j++) {
      if (bullishImpulse ? candles[j].close < bottom : candles[j].close > top) { mitigated = true; break; }
    }
    blocks.push({
      top, bottom, kind: bullishImpulse ? "bullish" : "bearish",
      time: Math.floor(origin.time / 1000),
      mitigated, strength: body / avgBody,
    });
  }

  return blocks.sort((a, b) => {
    if (a.mitigated !== b.mitigated) return a.mitigated ? 1 : -1;
    const da = Math.min(Math.abs(a.top - lastPrice), Math.abs(a.bottom - lastPrice));
    const db = Math.min(Math.abs(b.top - lastPrice), Math.abs(b.bottom - lastPrice));
    return da - db;
  });
}

function findOrderBlocks(candles: OHLCV[], impulseMult = 1.2, maxBlocks = 6): OrderBlock[] {
  if (candles.length < 25) return [];
  // Two-tier: the configured strictness first, then — only if that finds
  // literally nothing — a looser pass. This is what actually fixes "not
  // showing": on a calm/ranging stretch the strict pass can legitimately
  // find zero genuine impulses, but an empty overlay reads as "the feature
  // is broken" rather than "the market is quiet right now". A relaxed
  // fallback means toggling OB on real data almost always draws something,
  // while the strict pass (drawn first, so it's what you get whenever it
  // has anything) still takes priority when it does find real impulses.
  const strict = findOrderBlocksPass(candles, impulseMult, 3);
  const blocks = strict.length > 0 ? strict : findOrderBlocksPass(candles, Math.max(0.8, impulseMult - 0.4), 6);
  return blocks.slice(0, maxBlocks).sort((a, b) => a.time - b.time);
}

// ── Supply & demand zones ────────────────────────────────────────────────
// Distinct from the S/R price lines above: S/R marks a single price, a
// supply/demand zone marks a price RANGE (the consolidation "base" a move
// originated from) and is what most smart-money workflows actually trade
// off. Detection is the classic base-then-departure pattern: 1-4 small
// -bodied candles (the base), immediately followed by a candle that leaves
// the base decisively. Demand = departure up (zone below price acts as a
// floor); supply = departure down.
interface SDZone {
  top: number; bottom: number; kind: "supply" | "demand";
  time: number; touches: number; fresh: boolean;
}
function findSupplyDemandZonesPass(
  candles: OHLCV[], depBodyRatio: number, avgMult: number, baseBodyRatio: number, requireUnbroken: boolean
): SDZone[] {
  const zones: SDZone[] = [];

  for (let i = 25; i < candles.length; i++) {
    const departure = candles[i];
    const depBody = Math.abs(departure.close - departure.open);
    const depRange = departure.high - departure.low;
    if (depRange <= 0) continue;
    if (depBody / depRange < depBodyRatio) continue; // a real departure candle is mostly body, not wick

    const window = candles.slice(i - 20, i);
    const avgRange = window.reduce((a, c) => a + (c.high - c.low), 0) / window.length || 1;
    if (depBody < avgRange * avgMult) continue;

    // Collect the base: consecutive preceding candles with small bodies.
    const base: OHLCV[] = [];
    for (let back = 1; back <= 4 && i - back >= 0; back++) {
      const c = candles[i - back];
      const r = c.high - c.low;
      if (r <= 0) break;
      if (Math.abs(c.close - c.open) / r > baseBodyRatio) break; // too decisive to be a base
      base.push(c);
    }
    if (base.length === 0) continue;

    const top = Math.max(...base.map(c => c.high));
    const bottom = Math.min(...base.map(c => c.low));
    const kind: "supply" | "demand" = departure.close > departure.open ? "demand" : "supply";

    // How many times price has come back and touched this zone since — a
    // zone that has already been tested several times is weaker.
    let touches = 0;
    let broken = false;
    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      if (c.low <= top && c.high >= bottom) touches++;
      if (kind === "demand" ? c.close < bottom : c.close > top) { broken = true; break; }
    }
    if (broken && requireUnbroken) continue; // zone has been consumed — no longer a level

    zones.push({
      time: Math.floor(base[base.length - 1].time / 1000),
      top, bottom, kind, touches, fresh: touches === 0,
    });
  }
  return zones;
}

function findSupplyDemandZones(candles: OHLCV[], maxZones = 4): SDZone[] {
  if (candles.length < 30) return [];
  // BUG FIX ("order blocks not showing" applied the same way here — this
  // toggle had the identical symptom): four strict conditions were ANDed
  // together (mostly-body departure, decisive-vs-recent-range departure, a
  // genuinely small-bodied base, AND the zone never having been revisited)
  // — on a shorter history or a calmer stretch of any pair, all four
  // rarely align at once and the toggle came back empty. Same two-tier
  // fix: try the strict definition first, fall back to a looser one only
  // if that finds nothing, and only then allow zones price has already
  // revisited once (still excluding ones price has fully broken through,
  // which are genuinely gone).
  const strict = findSupplyDemandZonesPass(candles, 0.6, 1.3, 0.5, true);
  const zones = strict.length > 0
    ? strict
    : findSupplyDemandZonesPass(candles, 0.45, 0.9, 0.65, false);

  const lastPrice = candles[candles.length - 1].close;
  return zones
    .sort((a, b) => {
      if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
      const da = Math.min(Math.abs(a.top - lastPrice), Math.abs(a.bottom - lastPrice));
      const db = Math.min(Math.abs(b.top - lastPrice), Math.abs(b.bottom - lastPrice));
      return da - db;
    })
    .slice(0, maxZones)
    .sort((a, b) => a.time - b.time);
}

// ── Candlestick pattern recognition ──────────────────────────────────────
// "highlight type of candle in chart" — classifies each bar so the legend
// can name whatever the crosshair is on, and the notable reversal patterns
// get a small label drawn above/below the bar itself.
export interface CandleType {
  name: string;
  bias: "bullish" | "bearish" | "neutral";
  notable: boolean; // worth drawing a marker on the chart for
}
function classifyCandle(c: OHLCV, prev?: OHLCV): CandleType {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range <= 0) return { name: "Flat", bias: "neutral", notable: false };

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const bodyPct = body / range;
  const bullish = c.close > c.open;

  // Two-bar patterns first — they override single-bar reads.
  if (prev) {
    const prevBody = Math.abs(prev.close - prev.open);
    const prevBull = prev.close > prev.open;
    if (prevBody > 0 && body > prevBody) {
      if (bullish && !prevBull && c.close >= prev.open && c.open <= prev.close)
        return { name: "Bullish Engulfing", bias: "bullish", notable: true };
      if (!bullish && prevBull && c.close <= prev.open && c.open >= prev.close)
        return { name: "Bearish Engulfing", bias: "bearish", notable: true };
    }
  }

  if (bodyPct < 0.12) {
    if (lowerWick > body * 3 && upperWick < body * 1.5)
      return { name: "Dragonfly Doji", bias: "bullish", notable: true };
    if (upperWick > body * 3 && lowerWick < body * 1.5)
      return { name: "Gravestone Doji", bias: "bearish", notable: true };
    return { name: "Doji", bias: "neutral", notable: true };
  }
  if (bodyPct > 0.85)
    return { name: bullish ? "Bullish Marubozu" : "Bearish Marubozu", bias: bullish ? "bullish" : "bearish", notable: true };
  if (lowerWick > body * 2 && upperWick < body * 0.6)
    return { name: bullish ? "Hammer" : "Hanging Man", bias: bullish ? "bullish" : "bearish", notable: true };
  if (upperWick > body * 2 && lowerWick < body * 0.6)
    return { name: bullish ? "Inverted Hammer" : "Shooting Star", bias: bullish ? "bullish" : "bearish", notable: true };
  if (bodyPct < 0.3)
    return { name: "Spinning Top", bias: "neutral", notable: false };
  return { name: bullish ? "Bullish" : "Bearish", bias: bullish ? "bullish" : "bearish", notable: false };
}

// ── Fair Value Gaps / imbalance ("gap", "fair value") ───────────────────
// Classic 3-candle imbalance: candle B (the middle one) moves so decisively
// that candle A's wick and candle C's wick never overlap, leaving a price
// range the market never actually traded through. Bullish FVG: C's low is
// above A's high (gap sits below, often acts as support on a retrace).
// Bearish FVG: C's high is below A's low (gap sits above, often resistance).
// A gap is "filled" once price has traded back through the whole zone.
interface FVG {
  top: number; bottom: number; kind: "bullish" | "bearish";
  time: number;      // time of candle C (the confirming candle), seconds
  filled: boolean;
  fillPct: number;   // 0-100, how much of the gap has been traded back into
}
function findFairValueGaps(candles: OHLCV[], maxGaps = 8): FVG[] {
  if (candles.length < 5) return [];
  const gaps: FVG[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    let top = 0, bottom = 0, kind: "bullish" | "bearish" | null = null;
    if (c.low > a.high) { bottom = a.high; top = c.low; kind = "bullish"; }
    else if (c.high < a.low) { top = a.low; bottom = c.high; kind = "bearish"; }
    if (!kind) continue;
    const size = top - bottom;
    if (size <= 0) continue;

    let filled = false, deepest = 0; // deepest = how far into the zone price has come back, 0-size
    for (let j = i + 1; j < candles.length; j++) {
      const cj = candles[j];
      if (kind === "bullish") {
        // Price sits ABOVE a bullish gap when it forms; "filling" means a
        // later candle's LOW dropping back down into the zone from above.
        const intrusion = Math.max(0, top - Math.max(bottom, cj.low));
        deepest = Math.max(deepest, intrusion);
        if (cj.low <= bottom) { filled = true; deepest = size; break; }
      } else {
        // Price sits BELOW a bearish gap when it forms; "filling" means a
        // later candle's HIGH climbing back up into the zone from below.
        const intrusion = Math.max(0, Math.min(top, cj.high) - bottom);
        deepest = Math.max(deepest, intrusion);
        if (cj.high >= top) { filled = true; deepest = size; break; }
      }
    }
    gaps.push({ top, bottom, kind, time: Math.floor(c.time / 1000), filled, fillPct: Math.min(100, (deepest / size) * 100) });
  }
  const lastPrice = candles[candles.length - 1].close;
  return gaps
    .sort((x, y) => {
      if (x.filled !== y.filled) return x.filled ? 1 : -1;
      const dx = Math.min(Math.abs(x.top - lastPrice), Math.abs(x.bottom - lastPrice));
      const dy = Math.min(Math.abs(y.top - lastPrice), Math.abs(y.bottom - lastPrice));
      return dx - dy;
    })
    .slice(0, maxGaps)
    .sort((x, y) => x.time - y.time);
}

// ── Market structure: swing highs/lows, HH/HL/LH/LL, trend ──────────────
// Same pivot-detection idea as findSupportResistance, but kept in
// chronological order (not merged/deduped) so each swing can be compared
// to the PREVIOUS swing of the same kind to label it Higher High / Lower
// High / Higher Low / Lower Low — the actual definition of market
// structure and the basis for "trend" (a run of HH+HL is an uptrend, a run
// of LH+LL is a downtrend; anything mixed is a range).
export interface SwingPoint {
  time: number; price: number; kind: "high" | "low";
  label: "HH" | "LH" | "HL" | "LL" | null; // null for the first swing of its kind (nothing to compare to yet)
}
function findMarketStructure(candles: OHLCV[], lookback = 3): { swings: SwingPoint[]; trend: "bullish" | "bearish" | "ranging" } {
  if (candles.length < lookback * 2 + 3) return { swings: [], trend: "ranging" };
  const raw: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) raw.push({ time: Math.floor(c.time / 1000), price: c.high, kind: "high", label: null });
    if (isLow) raw.push({ time: Math.floor(c.time / 1000), price: c.low, kind: "low", label: null });
  }
  raw.sort((a, b) => a.time - b.time);

  let lastHigh: number | null = null, lastLow: number | null = null;
  for (const s of raw) {
    if (s.kind === "high") {
      s.label = lastHigh == null ? null : (s.price > lastHigh ? "HH" : "LH");
      lastHigh = s.price;
    } else {
      s.label = lastLow == null ? null : (s.price > lastLow ? "HL" : "LL");
      lastLow = s.price;
    }
  }

  // Trend = read off the most recent labelled high and low. HH+HL = clear
  // uptrend, LH+LL = clear downtrend, anything else (one broke, one didn't
  // yet) = ranging/transitional — deliberately conservative rather than
  // guessing a direction off a single swing.
  const recentHighs = raw.filter(s => s.kind === "high" && s.label).slice(-1)[0];
  const recentLows = raw.filter(s => s.kind === "low" && s.label).slice(-1)[0];
  let trend: "bullish" | "bearish" | "ranging" = "ranging";
  if (recentHighs?.label === "HH" && recentLows?.label === "HL") trend = "bullish";
  else if (recentHighs?.label === "LH" && recentLows?.label === "LL") trend = "bearish";

  return { swings: raw.slice(-24), trend }; // cap so the overlay doesn't clutter on long history
}

// ── Liquidity sweeps ("sweeps", stop hunts) ──────────────────────────────
// A sweep is a wick that pokes through a recent swing high/low (running
// the stops resting just beyond it) and then closes back on the origin
// side of that level — the rejection that makes it a sweep rather than a
// genuine breakout. Bearish sweep = swept a swing HIGH, then closed back
// below it (liquidity grab before reversing down). Bullish sweep = swept a
// swing LOW, then closed back above it (grab before reversing up).
export interface Sweep {
  time: number; level: number; wick: number; kind: "bullish" | "bearish";
}
function findLiquiditySweeps(candles: OHLCV[], swings: SwingPoint[], maxSweeps = 6): Sweep[] {
  if (!swings.length || candles.length < 5) return [];
  const sweeps: Sweep[] = [];
  const highs = swings.filter(s => s.kind === "high");
  const lows = swings.filter(s => s.kind === "low");

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const t = Math.floor(c.time / 1000);
    // Only compare against swings that had already formed before this bar.
    const priorHigh = [...highs].reverse().find(h => h.time < t && h.price < c.high);
    if (priorHigh && c.close < priorHigh.price && c.open < priorHigh.price) {
      sweeps.push({ time: t, level: priorHigh.price, wick: c.high, kind: "bearish" });
    }
    const priorLow = [...lows].reverse().find(l => l.time < t && l.price > c.low);
    if (priorLow && c.close > priorLow.price && c.open > priorLow.price) {
      sweeps.push({ time: t, level: priorLow.price, wick: c.low, kind: "bullish" });
    }
  }
  return sweeps.slice(-maxSweeps);
}

// ── time <-> logical index ───────────────────────────────────────────────
// THE fix for "drawings don't draw" and for order blocks/zones vanishing.
//
// The overlay used to position everything with timeScale().timeToCoordinate(),
// which only resolves times that are EXACT bar times already present in the
// series — it returns null for anything else. Two consequences:
//   * coordinateToTime() (used to record where the mouse went) returns null
//     the moment the pointer is anywhere right of the last candle, so any
//     drag that ended in the empty space at the right of the chart was
//     silently discarded and no drawing was ever created;
//   * an order block or zone whose origin bar had scrolled out of the
//     loaded window projected to null and the whole rectangle disappeared.
//
// Logical indices are continuous floats that extend past both ends of the
// data, so logicalToCoordinate/coordinateToLogical work everywhere on the
// canvas. Times are still what gets PERSISTED (a logical index would shift
// every time older history is prepended); these two helpers convert.
function timeToLogical(candles: OHLCV[], timeSec: number): number | null {
  const n = candles.length;
  if (n === 0) return null;
  const first = Math.floor(candles[0].time / 1000);
  const last = Math.floor(candles[n - 1].time / 1000);
  const step = n > 1 ? (last - first) / (n - 1) : 60;
  if (step <= 0) return null;
  if (timeSec <= first) return (timeSec - first) / step;
  if (timeSec >= last) return n - 1 + (timeSec - last) / step;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (Math.floor(candles[mid].time / 1000) <= timeSec) lo = mid; else hi = mid;
  }
  const tLo = Math.floor(candles[lo].time / 1000);
  const tHi = Math.floor(candles[hi].time / 1000);
  return tHi === tLo ? lo : lo + (timeSec - tLo) / (tHi - tLo);
}
function logicalToTime(candles: OHLCV[], logical: number): number | null {
  const n = candles.length;
  if (n === 0) return null;
  const first = Math.floor(candles[0].time / 1000);
  const last = Math.floor(candles[n - 1].time / 1000);
  const step = n > 1 ? (last - first) / (n - 1) : 60;
  if (logical <= 0) return Math.round(first + logical * step);
  if (logical >= n - 1) return Math.round(last + (logical - (n - 1)) * step);
  const lo = Math.floor(logical);
  const frac = logical - lo;
  const tLo = Math.floor(candles[lo].time / 1000);
  const tHi = Math.floor(candles[Math.min(lo + 1, n - 1)].time / 1000);
  return Math.round(tLo + (tHi - tLo) * frac);
}

type Indicator =
  | "ema20" | "ema50" | "bb" | "volume" | "rsi" | "macd" | "sr" | "ob" | "sd" | "pat"
  | "fvg" | "structure" | "sweep" | "poi" | "retest" | "mtf";
type DrawingTool = "none" | "hline" | "line" | "ray" | "box";
interface Drawing { id: string; tool: "hline" | "line" | "ray" | "box"; t1: number; p1: number; t2: number; p2: number }

export default function ProChart({
  candles, trades, symbol, timeframe, timeframes = DEFAULT_TIMEFRAMES,
  onTimeframeChange, onTradeClick, onUpdateTpSl, orderBook, signalOverlay, backtestOverlay, height = 520,
  loading = false, onRequestMoreHistory, bots = [], onBotClick, token,
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
  // BUG FIX ("arrow duplicates when new candles arrive"): createSeriesMarkers()
  // attaches a brand-new markers plugin instance to the series every time
  // it's called — it does NOT replace whatever was attached before. The
  // trade-marker effect below re-runs on every `candles` change (i.e. every
  // new live candle / poll tick), so calling createSeriesMarkers() there
  // each time stacked a fresh, fully-overlapping set of arrows on top of
  // the old ones on every update — same arrows, drawn again and again.
  // The fix: create the plugin instance ONCE (lazily, on first run) and
  // call .setMarkers() on that same instance for every subsequent update,
  // which replaces its markers instead of layering a new set on top.
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // Tracks what's already on the chart so the candle-update effect can tell
  // "just the newest bar changed/ticked" apart from "different symbol or
  // timeframe, reload everything" — see that effect for why this matters.
  const lastRenderedRef = useRef<{ symbol: string; timeframe: string; lastTime: number | null }>({ symbol: "", timeframe: "", lastTime: null });

  // trade_id -> { sl?: IPriceLine, tp?: IPriceLine }
  const priceLinesRef = useRef<Map<string, { sl?: IPriceLine; tp?: IPriceLine }>>(new Map());
  const dragRef = useRef<{ tradeId: string; kind: "sl" | "tp"; from: number | null } | null>(null);
  const signalLinesRef = useRef<IPriceLine[]>([]);
  const srLinesRef = useRef<IPriceLine[]>([]);
  const clickCandidateRef = useRef<{ x: number; y: number; time: number | null } | null>(null);

  // Indicator toggles persist across reloads ("make indicators persist if
  // I toggle, save my settings even when reload") — stored once globally
  // rather than per-symbol, since which studies someone likes to see is a
  // chart preference, not something tied to one pair.
  // Storage key bumped to v3. Every SMC overlay (OB, FVG, MS, SWEEP, POI,
  // S/D, RETEST) and the candle-pattern labels now default to ON — they used
  // to default to off, so a fresh chart showed no order blocks/FVGs/swings/
  // sweeps at all, and anyone who had ever visited the page had those
  // "off" values saved and re-applied on every reload. A new key means
  // everyone starts from the new defaults; toggles still persist from
  // there. (v1 -> v2 was for the same kind of reason: an older payload
  // missing keys leaves them undefined instead of falling back.)
  const INDICATOR_STORAGE_KEY = "chart_indicators_v3";
  const DEFAULT_INDICATORS: Record<Indicator, boolean> = {
    ema20: true, ema50: true, bb: false, volume: true, rsi: false, macd: false,
    sr: false, ob: true, sd: true, pat: true,
    fvg: true, structure: true, sweep: true, poi: true, retest: true, mtf: false,
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
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const drawStartRef = useRef<{ time: number; price: number } | null>(null);
  const [, forceRedraw] = useState(0);

  // "the pop up currently shows after user to confirm and approve" —
  // dragging an SL/TP line used to fire the PATCH the instant you let go of
  // the mouse, so the trade was already modified server-side by the time
  // any dialog appeared. The drag now only moves the line locally and parks
  // the result here; nothing is sent until the user approves it, and
  // cancelling snaps the line back to where it was.
  const [pendingTpSl, setPendingTpSl] = useState<
    { tradeId: string; kind: "sl" | "tp"; from: number | null; to: number; side: string; entry: number } | null
  >(null);

  // The mouse handlers are attached once on mount, so they can't close over
  // `candles` directly — they read it through this ref instead.
  const candlesRef = useRef<OHLCV[]>(candles);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

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

  // Keep the SVG overlay (zones, structure, sweeps, retests, hand drawings)
  // glued to the candles. The chart only notifies us when the TIME axis
  // moves (pan / zoom / new bar), but the overlay is also positioned by the
  // PRICE axis — which changes whenever the auto-scale range shifts (a new
  // high, dragging the price scale, a resize, toggling an indicator pane).
  // None of those fire an event we were listening to, so zones would sit at
  // stale heights, or look missing, until the next pan. This watches the
  // mapping itself (two reference prices + two reference bars + pane size)
  // once per animation frame and re-renders ONLY when it actually changed.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const chart = chartRef.current, series = candleSeriesRef.current, box = containerRef.current;
      if (chart && series && box) {
        const cs = candlesRef.current;
        const ref = cs.length ? cs[cs.length - 1].close : 1;
        const ts = chart.timeScale();
        const sig = [
          series.priceToCoordinate(ref), series.priceToCoordinate(ref * 1.05),
          ts.logicalToCoordinate(0 as Logical), ts.logicalToCoordinate(50 as Logical),
          box.clientWidth, box.clientHeight,
        ].join("|");
        if (sig !== last) {
          last = sig;
          forceRedrawRef.current();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => { addDrawingRef.current = (d: Drawing) => saveDrawings([...drawings, d]); }, [drawings]);
  useEffect(() => { onUpdateTplRef.current = onUpdateTpSl; }, [onUpdateTpSl]);
  useEffect(() => { onTradeClickRef.current = onTradeClick; }, [onTradeClick]);
  useEffect(() => { symbolTradesRef.current = symbolTrades; }, [symbolTrades]);

  const setPendingTpSlRef = useRef(setPendingTpSl);
  useEffect(() => { setPendingTpSlRef.current = setPendingTpSl; }, []);
  const drawingsRef = useRef<Drawing[]>(drawings);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  const setSelectedDrawingRef = useRef(setSelectedDrawing);
  useEffect(() => { setSelectedDrawingRef.current = setSelectedDrawing; }, []);

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
    // BUG FIX: was chart.timeScale().coordinateToTime(x), which returns null
    // for any x that isn't over an existing bar — i.e. the whole empty area
    // to the right of the newest candle, and anywhere past the data on
    // either side. Every drag that ended there produced a null time, and the
    // mouseup handler below simply threw the drawing away. Going through the
    // logical index instead resolves every x on the canvas.
    const timeAtX = (x: number): number | null => {
      const logical = chart.timeScale().coordinateToLogical(x);
      if (logical == null) return null;
      return logicalToTime(candlesRef.current, logical as number);
    };

    const onMouseDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (drawToolRef.current !== "none") {
        const time = timeAtX(x);
        const price = priceAtY(y);
        // BUG FIX: pan/zoom was only disabled when both time and price
        // resolved. When they didn't (which, before the timeAtX fix above,
        // was most of the canvas) the drag fell through to the chart's own
        // pan handler — so the chart scrolled under the cursor and nothing
        // was drawn. Lock the chart on any mousedown while a tool is armed.
        chart.applyOptions({ handleScroll: false, handleScale: false });
        if (time != null && price != null) {
          // A horizontal line needs no drag at all — one click sets the
          // price and it spans the full width. Commit it immediately so
          // "straight line" behaves the way it does in every other charting
          // tool instead of requiring a meaningless sideways drag.
          if (drawToolRef.current === "hline") {
            addDrawingRef.current({
              id: `d_${Date.now()}`, tool: "hline",
              t1: time, p1: price, t2: time, p2: price,
            });
            chart.applyOptions({ handleScroll: true, handleScale: true });
            forceRedrawRef.current();
            return;
          }
          drawStartRef.current = { time, price };
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
            dragRef.current = { tradeId, kind, from: line.options().price };
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
        const start = drawStartRef.current;
        const time = timeAtX(x);
        const price = priceAtY(y);
        const tool = drawToolRef.current;
        // A near-zero drag produces a line with no length / a box with no
        // area — invisible on screen, and previously the most common reason
        // a user thought "drawing isn't working" after a stray click.
        // Require a few pixels of actual movement before committing.
        const startLogical = timeToLogical(candlesRef.current, start.time);
        const startX = startLogical == null
          ? null
          : chart.timeScale().logicalToCoordinate(startLogical as Logical);
        const startY = yAtPrice(start.price);
        const draggedFarEnough =
          startX == null || startY == null ? true : Math.hypot(x - startX, y - startY) > 4;

        if (time != null && price != null && tool !== "none" && tool !== "hline" && draggedFarEnough) {
          addDrawingRef.current({
            id: `d_${Date.now()}`, tool,
            t1: start.time, p1: start.price, t2: time, p2: price,
          });
        }
        drawStartRef.current = null;
        previewRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        forceRedrawRef.current();
        return;
      }

      if (dragRef.current) {
        const { tradeId, kind, from } = dragRef.current;
        const lines = priceLinesRef.current.get(tradeId);
        const line = lines?.[kind];
        const finalPrice = line?.options().price;
        dragRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        // Unchanged (or a mis-click rather than a real drag) — nothing to
        // confirm, don't bother the user with a dialog.
        if (finalPrice == null || (from != null && Math.abs(finalPrice - from) < 1e-9)) return;
        const trade = symbolTradesRef.current.find(t => t.id === tradeId);
        // Park the proposed level and let the confirmation UI decide. The
        // PATCH is NOT sent here any more — see pendingTpSl.
        setPendingTpSlRef.current({
          tradeId, kind, from: from ?? null, to: finalPrice,
          side: trade?.side ?? "BUY", entry: trade?.price ?? finalPrice,
        });
        return;
      }

      const start = clickCandidateRef.current;
      clickCandidateRef.current = null;
      if (!start) return;
      const movedPx = Math.hypot(x - start.x, y - start.y);
      if (movedPx > 4) return; // treat as a pan, not a click

      // Click-to-select a drawing (cursor tool only) so it can be deleted
      // individually — previously the ONLY way to remove anything was
      // "Clear", which wiped every drawing on the chart at once.
      const hitDrawing = (() => {
        const pt = (t: number, p: number) => {
          const l = timeToLogical(candlesRef.current, t);
          if (l == null) return null;
          const px = chart.timeScale().logicalToCoordinate(l as Logical);
          const py = yAtPrice(p);
          return px == null || py == null ? null : { x: px, y: py };
        };
        for (const d of drawingsRef.current) {
          if (d.tool === "hline") {
            const py = yAtPrice(d.p1);
            if (py != null && Math.abs(py - y) <= 6) return d.id;
            continue;
          }
          const a = pt(d.t1, d.p1), b = pt(d.t2, d.p2);
          if (!a || !b) continue;
          if (d.tool === "box") {
            const inX = x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4;
            const inY = y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4;
            const nearEdge =
              Math.abs(x - a.x) <= 6 || Math.abs(x - b.x) <= 6 ||
              Math.abs(y - a.y) <= 6 || Math.abs(y - b.y) <= 6;
            if (inX && inY && nearEdge) return d.id;
            continue;
          }
          // line / ray: perpendicular distance to the segment
          const dx = b.x - a.x, dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) continue;
          let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
          if (d.tool === "line") t = Math.max(0, Math.min(1, t));
          else t = Math.max(0, t); // a ray extends forward without limit
          const dist = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
          if (dist <= 6) return d.id;
        }
        return null;
      })();
      if (hitDrawing) { setSelectedDrawingRef.current(hitDrawing); return; }
      setSelectedDrawingRef.current(null);

      if (!onTradeClickRef.current) return;
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
    // BUG FIX: only the TIME range was subscribed. Zooming with the scroll
    // wheel or pinching changes the LOGICAL range (bar spacing) without
    // necessarily changing the visible time range's endpoints, so drawings
    // and order-block rectangles stayed frozen at their old pixel positions
    // while the candles underneath them moved — they looked misplaced until
    // you panned. Also fires on price-scale changes.
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => forceRedrawRef.current());
    const onWindowResize = () => forceRedrawRef.current();
    window.addEventListener("resize", onWindowResize);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onWindowResize);
      chart.remove();
      chartRef.current = null;
      // The markers plugin instance dies with the series/chart it was
      // attached to — drop the ref so a remount creates a fresh one
      // instead of calling .setMarkers() on a disposed instance.
      seriesMarkersRef.current = null;
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
    // See seriesMarkersRef declaration above for why this is setMarkers()
    // on a reused instance rather than a fresh createSeriesMarkers() call.
    if (seriesMarkersRef.current) {
      seriesMarkersRef.current.setMarkers(markers);
    } else {
      seriesMarkersRef.current = createSeriesMarkers(series, markers);
    }

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

  // ── Smart-money-concepts overlay data ────────────────────────────────────
  // Order blocks, FVGs, structure, sweeps and POI are fetched from
  // /market/smc, which computes them with the EXACT SAME functions
  // (backend/app/services/smc.py) the "Smart Money Concepts" bot strategy
  // trades off of — so what's drawn here is provably what a bot running
  // that strategy actually saw, not a separate client-side approximation
  // of it. The local findOrderBlocks/findFairValueGaps/findMarketStructure/
  // findLiquiditySweeps functions above are kept as a fallback ONLY for
  // when the backend request fails (e.g. a brief network hiccup) — this
  // chart still needs to show something useful rather than blanking these
  // overlays out the moment one poll fails.
  const smcEnabled = indicators.ob || indicators.sd || indicators.fvg || indicators.structure || indicators.sweep || indicators.poi || indicators.retest;
  const [smcData, setSmcData] = useState<SMCResponse | null>(null);
  // Re-read the moment a new bar opens (not just on the timer), so zones,
  // sweeps and retests appear on the bar that made them.
  const newestBarTime = candles.length ? candles[candles.length - 1].time : 0;
  useEffect(() => {
    if (!smcEnabled) return;
    let cancelled = false;
    const load = () => {
      marketApi.smc(symbol, timeframe, 300).then(data => {
        if (!cancelled) setSmcData(data);
      }).catch(() => { /* keep last good data / fall through to local calc below */ });
    };
    load();
    // Poll rather than recompute on every candle tick — an order block or
    // FVG's mitigated/filled status only meaningfully changes bar to bar,
    // not tick to tick, so this stays current without hammering the API.
    const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [smcEnabled, symbol, timeframe, newestBarTime]);
  // Reset to "no server data yet" whenever the symbol/timeframe changes so
  // the fallback local calc (still correct for the NEW candles) covers the
  // gap instead of briefly showing the previous pair/timeframe's zones.
  useEffect(() => { setSmcData(null); }, [symbol, timeframe]);

  // Order blocks are drawn as time/price-anchored rectangles in the same
  // SVG overlay used for hand-drawn lines/boxes (below), since
  // lightweight-charts' price lines are horizontal-only and can't express
  // a block's left/right time bounds.
  const orderBlocks = useMemo(
    () => (indicators.ob ? (smcData?.orderBlocks ?? findOrderBlocks(candles)) : []),
    [candles, indicators.ob, smcData]
  );

  const sdZones = useMemo(
    () => (indicators.sd ? (smcData?.sdZones ?? findSupplyDemandZones(candles)) : []),
    [candles, indicators.sd, smcData]
  );

  const fvgs = useMemo(
    () => (indicators.fvg || indicators.poi ? (smcData?.fvgs ?? findFairValueGaps(candles)) : []),
    [candles, indicators.fvg, indicators.poi, smcData]
  );

  // Structure feeds both the "structure" overlay (HH/HL/LH/LL labels +
  // trend badge) and the sweep detector (a sweep is defined relative to
  // swing points), so it's computed whenever either is on.
  const marketStructure = useMemo(
    () => (indicators.structure || indicators.sweep
      ? (smcData?.structure ?? findMarketStructure(candles))
      : { swings: [], trend: "ranging" as const }),
    [candles, indicators.structure, indicators.sweep, smcData]
  );

  const sweeps = useMemo(
    () => (indicators.sweep ? (smcData?.sweeps ?? findLiquiditySweeps(candles, marketStructure.swings)) : []),
    [candles, indicators.sweep, marketStructure, smcData]
  );

  // Retests: price coming back into a still-live OB / FVG / S-D zone. Server
  // only — there's no local fallback, so this is empty until /market/smc
  // answers (or if the backend predates it).
  const retests = useMemo(
    () => (indicators.retest ? (smcData?.retests ?? []) : []),
    [indicators.retest, smcData]
  );

  // Several zones can be retested by the very same bar (stacked order
  // blocks, an OB inside an FVG). One marker per bar+direction, not a pile
  // of identical pills on top of each other: "RT·OB/FVG ×3".
  const retestMarkers = useMemo(() => {
    const g = new Map<string, {
      time: number; kind: "bullish" | "bearish"; sources: string[]; n: number;
      confirmed: boolean; active: boolean; top: number; bottom: number;
    }>();
    for (const r of retests) {
      const key = `${r.time}-${r.kind}`;
      const cur = g.get(key);
      if (!cur) {
        g.set(key, { time: r.time, kind: r.kind, sources: [r.source], n: 1, confirmed: r.confirmed, active: r.active, top: r.top, bottom: r.bottom });
      } else {
        if (!cur.sources.includes(r.source)) cur.sources.push(r.source);
        cur.n += 1;
        cur.confirmed = cur.confirmed || r.confirmed;
        cur.active = cur.active || r.active;
      }
    }
    return [...g.values()];
  }, [retests]);

  // Points of Interest: the single closest unmitigated/fresh/unfilled zone
  // above price and the single closest one below it, pooled across order
  // blocks, supply/demand zones and fair value gaps — "highlight
  // everything" produces noise; POI is deliberately the opposite: just the
  // one or two zones actually worth watching right now.
  interface POI { top: number; bottom: number; time: number; kind: "bullish" | "bearish"; source: string }
  const pois = useMemo<POI[]>(() => {
    if (!indicators.poi || candles.length === 0) return [];
    if (smcData) return smcData.poi;
    const lastPrice = candles[candles.length - 1].close;
    const candidates: POI[] = [
      ...orderBlocks.filter(b => !b.mitigated).map(b => ({ top: b.top, bottom: b.bottom, time: b.time, kind: b.kind, source: "OB" })),
      ...findSupplyDemandZones(candles).filter(z => z.fresh).map(z => ({
        top: z.top, bottom: z.bottom, time: z.time, kind: (z.kind === "demand" ? "bullish" : "bearish") as "bullish" | "bearish", source: "S/D",
      })),
      ...fvgs.filter(g => !g.filled).map(g => ({ top: g.top, bottom: g.bottom, time: g.time, kind: g.kind, source: "FVG" })),
    ];
    const below = candidates.filter(c => c.top <= lastPrice).sort((a, b) => (lastPrice - a.top) - (lastPrice - b.top))[0];
    const above = candidates.filter(c => c.bottom >= lastPrice).sort((a, b) => (a.bottom - lastPrice) - (b.bottom - lastPrice))[0];
    return [below, above].filter((p): p is POI => !!p);
  }, [indicators.poi, candles, orderBlocks, fvgs, smcData]);

  // ── Multi-timeframe bias ("multi timeframe charts higher and lower") ────
  // Fetches a modest window on the timeframe one step up and one step down
  // the ladder from whatever's currently displayed, and reads the trend off
  // each with the same market-structure logic used for the main chart —
  // so "MTF" shows whether the higher timeframe actually agrees with what
  // the lower timeframe/entry chart is doing, which is the whole point of
  // checking multiple timeframes before taking a signal.
  const [mtfBias, setMtfBias] = useState<{ lower: { tf: string; trend: string } | null; higher: { tf: string; trend: string } | null }>({ lower: null, higher: null });
  useEffect(() => {
    if (!indicators.mtf) return;
    const { lower, higher } = neighborTimeframes(timeframe);
    let cancelled = false;
    (async () => {
      const [lowerCandles, higherCandles] = await Promise.all([
        lower ? marketApi.klines(symbol, lower, 150).catch(() => null) : Promise.resolve(null),
        higher ? marketApi.klines(symbol, higher, 150).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setMtfBias({
        lower: lower && lowerCandles ? { tf: lower, trend: findMarketStructure(lowerCandles).trend } : null,
        higher: higher && higherCandles ? { tf: higher, trend: findMarketStructure(higherCandles).trend } : null,
      });
    })();
    return () => { cancelled = true; };
    // Re-fetch on symbol/timeframe change or when the toggle turns on; not
    // on every `candles` tick — MTF bias doesn't need to refresh every
    // second, just often enough to stay roughly current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.mtf, symbol, timeframe]);

  const trendColor = (t: string) => t === "bullish" ? "#00d084" : t === "bearish" ? "#ff4757" : "var(--text-dim)";

  // Pattern labels are only drawn for the most recent stretch of bars —
  // labelling 800 candles would bury the chart under text and cost a
  // pointless amount of layout work every redraw.
  const candlePatterns = useMemo(() => {
    if (!indicators.pat || candles.length < 2) return [];
    const from = Math.max(1, candles.length - 60);
    const out: { time: number; type: CandleType; high: number; low: number }[] = [];
    for (let i = from; i < candles.length; i++) {
      const type = classifyCandle(candles[i], candles[i - 1]);
      if (!type.notable) continue;
      out.push({ time: Math.floor(candles[i].time / 1000), type, high: candles[i].high, low: candles[i].low });
    }
    return out;
  }, [candles, indicators.pat]);

  // "show which bot is active in charts" — the bots trading THIS pair.
  const pairBots = useMemo(
    () => bots.filter(b => b.pair === symbol),
    [bots, symbol]
  );
  const botById = useMemo(() => {
    const m = new Map<string, ChartBot>();
    for (const b of bots) m.set(b.id, b);
    return m;
  }, [bots]);

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
  // "highlight type of candle in chart" — whatever bar the crosshair is on
  // (or the newest bar at rest) gets named in the legend, always, whether
  // or not the PAT overlay is toggled on.
  const legendCandleType = useMemo(() => {
    if (!legendBar) return null;
    const idx = candles.findIndex(c => c.time === legendBar.time);
    return classifyCandle(legendBar, idx > 0 ? candles[idx - 1] : undefined);
  }, [legendBar, candles]);

  // Delete / Backspace removes the selected drawing. Escape deselects, and
  // also disarms the drawing tool — previously the only way back to the
  // cursor was clicking the ↖ button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Escape") { setSelectedDrawing(null); setDrawTool("none"); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawing) {
        e.preventDefault();
        saveDrawings(drawings.filter(d => d.id !== selectedDrawing));
        setSelectedDrawing(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDrawing, drawings]);

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
  // One switch for the whole Smart Money set (OB, S/D, FVG, MS, SWEEP, POI,
  // RETEST). On if any is off; off only if all are already on.
  const SMC_KEYS: Indicator[] = ["ob", "sd", "fvg", "structure", "sweep", "poi", "retest"];
  const allSmcOn = SMC_KEYS.every(k => indicators[k]);
  const toggleSmc = () => setIndicators(p => {
    const turnOn = !SMC_KEYS.every(k => p[k]);
    const next = { ...p };
    for (const k of SMC_KEYS) next[k] = turnOn;
    return next;
  });

  // Converts a stored {time, price} point to pixel coordinates for the SVG
  // drawing overlay. Returns null if the point is off-screen or the chart
  // isn't ready yet — callers skip rendering that point.
  const projectPoint = (time: number, price: number): { x: number; y: number } | null => {
    const chart = chartRef.current, series = candleSeriesRef.current;
    if (!chart || !series) return null;
    // BUG FIX: was timeToCoordinate(time), which only resolves exact bar
    // times that are currently in the series — so anything anchored to a
    // bar that had scrolled out of the loaded window, or to a point in the
    // empty space right of the newest candle, returned null and the whole
    // shape silently disappeared. This is why order blocks would show once
    // and then vanish, and why boxes drawn near the right edge never
    // appeared at all.
    const logical = timeToLogical(candles, time);
    if (logical == null) return null;
    const x = chart.timeScale().logicalToCoordinate(logical as Logical);
    const y = series.priceToCoordinate(price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  // Projects an x for a point N bars past the newest candle — used to give
  // order blocks and supply/demand zones a right edge that extends into the
  // empty space ahead of price, the way they're drawn in every charting
  // tool, instead of stopping dead on the last bar.
  const projectFutureX = (barsAhead: number): number | null => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return null;
    const x = chart.timeScale().logicalToCoordinate((candles.length - 1 + barsAhead) as Logical);
    return x ?? null;
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
      {/* "show which bot is active in charts" — every bot configured on this
          pair, with its live status and what it's currently reading, so you
          can see at a glance who's trading the chart you're looking at. */}
      {pairBots.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "4px 4px 0" }}>
          <span style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>BOTS ON {symbol}</span>
          {pairBots.map(b => {
            const running = b.status === "RUNNING";
            const dot = running ? "#00d084" : b.status === "PAUSED" ? "#ffd700" : "var(--text-mute)";
            const sig = b.market_signal;
            const sigColor = sig === "BUY" ? "#00d084" : sig === "SELL" ? "#ff4757" : "var(--text-dim)";
            return (
              <button key={b.id} onClick={() => onBotClick?.(b.id)}
                title={`${b.name} — ${b.strategy} • ${b.status}${b.timeframe ? ` • ${b.timeframe}` : ""}`}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 20,
                  fontSize: 10, cursor: onBotClick ? "pointer" : "default", fontFamily: "inherit",
                  background: running ? "#00d0840f" : "var(--surface)",
                  border: `1px solid ${running ? "#00d08444" : "var(--border2)"}`,
                  color: "var(--text-dim)",
                }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0,
                  animation: running ? "pcPulse 1.6s ease-in-out infinite" : undefined,
                }} />
                <span style={{ color: "var(--text)", fontWeight: 700 }}>{b.name}</span>
                {b.mode === "LIVE" && (
                  <span style={{ color: "#ffd700", fontWeight: 800, fontSize: 8, letterSpacing: 0.5 }}>LIVE</span>
                )}
                {sig && (
                  <span style={{ color: sigColor, fontWeight: 700 }}>
                    {sig}{b.market_confidence != null ? ` ${b.market_confidence.toFixed(0)}%` : ""}
                  </span>
                )}
              </button>
            );
          })}
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
        <button onClick={toggleSmc} title="Smart Money Concepts — turn every overlay (OB, S/D, FVG, MS, SWEEP, POI, RETEST) on or off at once"
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 700,
            background: allSmcOn ? "#00d08422" : "var(--surface)",
            color: allSmcOn ? "#00d084" : "var(--text-dim)",
            border: `1px solid ${allSmcOn ? "#00d084" : "var(--border2)"}`,
          }}>SMC</button>
        {([
          ["ema20", "EMA20", "20-period EMA"],
          ["ema50", "EMA50", "50-period EMA"],
          ["bb", "BB", "Bollinger Bands"],
          ["volume", "VOL", "Volume"],
          ["rsi", "RSI", "RSI pane"],
          ["macd", "MACD", "MACD pane"],
          ["sr", "S/R", "Support & resistance levels"],
          ["ob", "OB", "Order blocks"],
          ["sd", "S/D", "Supply & demand zones"],
          ["pat", "PAT", "Candlestick pattern labels"],
          ["fvg", "FVG", "Fair value gaps / imbalance"],
          ["structure", "MS", "Market structure — HH/HL/LH/LL swing labels + trend"],
          ["sweep", "SWEEP", "Liquidity sweeps (stop hunts)"],
          ["poi", "POI", "Points of interest — closest live zones above/below price"],
          ["retest", "RETEST", "Retests — price coming back into a live order block / FVG / supply-demand zone"],
          ["mtf", "MTF", "Multi-timeframe bias — trend on a higher and a lower timeframe"],
        ] as [Indicator, string, string][]).map(([k, label, title]) => (
          <button key={k} onClick={() => toggle(k)} title={title}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
              background: indicators[k] ? "#0094ff22" : "var(--surface)",
              color: indicators[k] ? "#0094ff" : "var(--text-dim)",
              border: `1px solid ${indicators[k] ? "#0094ff" : "var(--border2)"}`,
            }}>{label}</button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border2)", margin: "0 4px" }} />
        {([
          ["none", "↖", "Cursor — pan/zoom, click a drawing to select it"],
          ["hline", "─ Horizontal", "Horizontal line — single click, no drag needed"],
          ["line", "╱ Trend", "Trend line — drag from start to end"],
          ["ray", "➚ Ray", "Ray — drag to set the angle; extends forward forever"],
          ["box", "▭ Box", "Rectangle / zone — drag a corner to the opposite corner"],
        ] as [DrawingTool, string, string][]).map(([tool, label, title]) => (
          <button key={tool} onClick={() => { setDrawTool(tool); setSelectedDrawing(null); }} title={title}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
              background: drawTool === tool ? "#ffd70022" : "var(--surface)",
              color: drawTool === tool ? "#ffd700" : "var(--text-dim)",
              border: `1px solid ${drawTool === tool ? "#ffd700" : "var(--border2)"}`,
            }}>{label}</button>
        ))}
        {selectedDrawing && (
          <button
            onClick={() => { saveDrawings(drawings.filter(d => d.id !== selectedDrawing)); setSelectedDrawing(null); }}
            title="Delete the selected drawing (or press Delete)"
            style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: "#ff475718", color: "#ff4757", border: "1px solid #ff475744" }}>
            ✕ Delete
          </button>
        )}
        {drawings.length > 0 && (
          <button onClick={() => { saveDrawings([]); setSelectedDrawing(null); }} title="Clear all drawings on this pair/timeframe"
            style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: "transparent", color: "#ff4757", border: "1px solid #ff475744" }}>
            Clear
          </button>
        )}
        {indicators.structure && (
          <span style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "monospace",
            color: trendColor(marketStructure.trend), border: `1px solid ${trendColor(marketStructure.trend)}44`,
          }}>
            Trend: {marketStructure.trend[0].toUpperCase() + marketStructure.trend.slice(1)}
          </span>
        )}
        {indicators.mtf && (
          <>
            {mtfBias.higher && (
              <span title="Higher timeframe bias" style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "monospace",
                color: trendColor(mtfBias.higher.trend), border: `1px solid ${trendColor(mtfBias.higher.trend)}44`,
              }}>
                {mtfBias.higher.tf} ↑ {mtfBias.higher.trend}
              </span>
            )}
            {mtfBias.lower && (
              <span title="Lower timeframe bias" style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: "monospace",
                color: trendColor(mtfBias.lower.trend), border: `1px solid ${trendColor(mtfBias.lower.trend)}44`,
              }}>
                {mtfBias.lower.tf} ↓ {mtfBias.lower.trend}
              </span>
            )}
          </>
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

      {/* The strategy's own verdict + working for the newest bar — the same
          evaluate_entry() the Smart Money bot runs, so it's what a bot on
          this pair would decide right now. */}
      {smcEnabled && <SmcDecisionPanel decision={smcData?.decision} />}

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
              {legendCandleType && (
                <span style={{
                  color: legendCandleType.bias === "bullish" ? "#00d084" : legendCandleType.bias === "bearish" ? "#ff4757" : "#ffd700",
                  fontWeight: 700, borderLeft: "1px solid var(--border2)", paddingLeft: 10,
                }}>{legendCandleType.name}</span>
              )}
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

          {/* Confirm/approve a dragged SL or TP BEFORE it is sent. Dragging
              only moves the line locally now; this is what actually commits
              it. Cancel snaps the line back to where it was. */}
          {pendingTpSl && (() => {
            const isBuy = pendingTpSl.side === "BUY";
            const { kind, to, entry } = pendingTpSl;
            // Mirrors the server-side direction rules in routers/trades.py
            // so an impossible level is caught here, with an explanation,
            // instead of coming back as a bare 400 after the fact.
            const invalid =
              kind === "sl"
                ? (isBuy ? to >= entry : to <= entry)
                : (isBuy ? to <= entry : to >= entry);
            const label = kind === "sl" ? "Stop loss" : "Take profit";
            const color = kind === "sl" ? "#ff4757" : "#00d084";
            const revert = () => {
              const lines = priceLinesRef.current.get(pendingTpSl.tradeId);
              const line = lines?.[kind];
              if (line && pendingTpSl.from != null) line.applyOptions({ price: pendingTpSl.from });
              setPendingTpSl(null);
            };
            return (
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                zIndex: 10, background: "var(--surface)", border: `1px solid ${color}55`,
                borderRadius: 10, padding: 14, minWidth: 260,
                boxShadow: "0 8px 30px rgba(0,0,0,0.55)", fontSize: 12,
              }}>
                <div style={{ fontWeight: 800, marginBottom: 8, color }}>Confirm {label}</div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", marginBottom: 4 }}>
                  <span>Entry</span><b style={{ color: "var(--text)" }}>{entry.toFixed(4)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", marginBottom: 4 }}>
                  <span>Current {label.toLowerCase()}</span>
                  <b style={{ color: "var(--text)" }}>{pendingTpSl.from != null ? pendingTpSl.from.toFixed(4) : "—"}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", marginBottom: 10 }}>
                  <span>New {label.toLowerCase()}</span><b style={{ color }}>{to.toFixed(4)}</b>
                </div>
                {invalid && (
                  <div style={{ color: "#ff4757", fontSize: 10, lineHeight: 1.5, marginBottom: 10 }}>
                    {kind === "sl"
                      ? `A ${pendingTpSl.side} stop loss must sit ${isBuy ? "below" : "above"} the entry price — this one would trigger immediately.`
                      : `A ${pendingTpSl.side} take profit must sit ${isBuy ? "above" : "below"} the entry price.`}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={revert} style={{
                    flex: 1, padding: "7px 0", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                    background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border2)", fontSize: 11,
                  }}>Cancel</button>
                  <button disabled={invalid}
                    onClick={() => {
                      onUpdateTpSl?.(pendingTpSl.tradeId, kind === "sl" ? { stop_loss: to } : { take_profit: to });
                      setPendingTpSl(null);
                    }}
                    style={{
                      flex: 1, padding: "7px 0", borderRadius: 6, cursor: invalid ? "not-allowed" : "pointer",
                      fontFamily: "inherit", background: color, color: "#000", border: "none",
                      fontWeight: 800, fontSize: 11, opacity: invalid ? 0.45 : 1,
                    }}>Approve</button>
                </div>
              </div>
            );
          })()}

          {/* Drawing overlay — pure visual, pointer-events disabled so all
              mouse interaction still goes through the chart container's
              own handlers (which do the actual time/price math). */}
          <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", width: "100%", height: "100%" }}>
            {/* Supply & demand zones — drawn first so order blocks and
                hand-drawn shapes sit on top of them. */}
            {indicators.sd && sdZones.map((z, i) => {
              const a = projectPoint(z.time, z.top);
              const yBottom = candleSeriesRef.current?.priceToCoordinate(z.bottom);
              const rightX = projectFutureX(6);
              if (!a || yBottom == null || rightX == null) return null;
              const color = z.kind === "demand" ? "#00d084" : "#ff4757";
              const h = Math.max(2, yBottom - a.y);
              return (
                <g key={`sd_${i}`}>
                  <rect x={a.x} y={a.y} width={Math.max(0, rightX - a.x)} height={h}
                    fill={`${color}${z.fresh ? "22" : "10"}`} stroke={color}
                    strokeWidth={z.fresh ? 1.4 : 1} strokeDasharray={z.fresh ? undefined : "4 3"} />
                  <text x={rightX - 4} y={a.y + 11} textAnchor="end"
                    fill={color} fontSize={9} fontFamily="monospace" opacity={0.9}>
                    {z.kind === "demand" ? "DEMAND" : "SUPPLY"}{z.fresh ? " • fresh" : ` • ${z.touches}x`}
                  </text>
                </g>
              );
            })}

            {/* Order blocks */}
            {indicators.ob && orderBlocks.map((b, i) => {
              const a = projectPoint(b.time, b.top);
              const yBottom = candleSeriesRef.current?.priceToCoordinate(b.bottom);
              const rightX = projectFutureX(4);
              if (!a || yBottom == null || rightX == null) return null;
              const color = b.kind === "bullish" ? "#00d084" : "#ff4757";
              const h = Math.max(2, yBottom - a.y);
              return (
                <g key={`ob_${i}`} opacity={b.mitigated ? 0.4 : 1}>
                  <rect x={a.x} y={a.y} width={Math.max(0, rightX - a.x)} height={h}
                    fill={`${color}16`} stroke={color} strokeWidth={1} strokeDasharray="3 3" />
                  <text x={a.x + 4} y={a.y - 3} fill={color} fontSize={9} fontFamily="monospace" opacity={0.9}>
                    {b.kind === "bullish" ? "OB+" : "OB−"} {b.strength.toFixed(1)}x{b.mitigated ? " (mitigated)" : ""}
                  </text>
                </g>
              );
            })}

            {/* Fair value gaps / imbalance ("gap", "fair value") */}
            {indicators.fvg && fvgs.map((g, i) => {
              const a = projectPoint(g.time, g.top);
              const yBottom = candleSeriesRef.current?.priceToCoordinate(g.bottom);
              const rightX = projectFutureX(4);
              if (!a || yBottom == null || rightX == null) return null;
              const color = g.kind === "bullish" ? "#00d084" : "#ff4757";
              const h = Math.max(2, yBottom - a.y);
              return (
                <g key={`fvg_${i}`} opacity={g.filled ? 0.35 : 0.95}>
                  <rect x={a.x} y={a.y} width={Math.max(0, rightX - a.x)} height={h}
                    fill={`${color}12`} stroke={color} strokeWidth={1} strokeDasharray="2 4" />
                  <text x={a.x + 4} y={a.y - 3} fill={color} fontSize={9} fontFamily="monospace" opacity={0.9}>
                    FVG{g.filled ? " (filled)" : g.fillPct > 0 ? ` ${g.fillPct.toFixed(0)}%` : ""}
                  </text>
                </g>
              );
            })}

            {/* Points of interest — the one or two zones (pooled across OB/
                S/D/FVG) actually closest to price right now, drawn with a
                heavier highlight than the base overlays so they stand out
                as "watch this" rather than just more zones on the pile. */}
            {indicators.poi && pois.map((p, i) => {
              const a = projectPoint(p.time, p.top);
              const yBottom = candleSeriesRef.current?.priceToCoordinate(p.bottom);
              const rightX = projectFutureX(6);
              if (!a || yBottom == null || rightX == null) return null;
              const color = p.kind === "bullish" ? "#00d084" : "#ff4757";
              const h = Math.max(2, yBottom - a.y);
              return (
                <g key={`poi_${i}`}>
                  <rect x={a.x} y={a.y} width={Math.max(0, rightX - a.x)} height={h}
                    fill={`${color}22`} stroke={color} strokeWidth={2} />
                  <text x={a.x + 4} y={a.y - 4} fill={color} fontSize={10} fontFamily="monospace" fontWeight={700}>
                    ★ POI ({p.source})
                  </text>
                </g>
              );
            })}

            {/* Trend line — the confirmed swing highs/lows joined in order,
                coloured by the current trend (green = bullish HH/HL,
                red = bearish LH/LL, grey = ranging). */}
            {indicators.structure && (() => {
              const pts = marketStructure.swings
                .map(sw => projectPoint(sw.time, sw.price))
                .filter((pt): pt is { x: number; y: number } => !!pt);
              if (pts.length < 2) return null;
              return (
                <polyline points={pts.map(pt => `${pt.x},${pt.y}`).join(" ")} fill="none"
                  stroke={trendColor(marketStructure.trend)} strokeWidth={1.3} strokeOpacity={0.75}
                  strokeLinejoin="round" />
              );
            })()}

            {/* Market structure: swing highs/lows labelled HH / LH / HL / LL */}
            {indicators.structure && marketStructure.swings.map((s, i) => {
              const anchor = projectPoint(s.time, s.price);
              if (!anchor || !s.label) return null;
              const bullishLabel = s.label === "HH" || s.label === "HL";
              const color = bullishLabel ? "#00d084" : "#ff4757";
              const above = s.kind === "high";
              const ty = anchor.y + (above ? -8 : 16);
              return (
                <g key={`struct_${i}`}>
                  <circle cx={anchor.x} cy={anchor.y} r={2.5} fill={color} />
                  <rect x={anchor.x - 12} y={ty - 9} width={24} height={12} rx={2}
                    fill="rgba(8,14,24,0.82)" stroke={`${color}55`} strokeWidth={1} />
                  <text x={anchor.x} y={ty} textAnchor="middle" fill={color} fontSize={8} fontFamily="monospace" fontWeight={700}>
                    {s.label}
                  </text>
                </g>
              );
            })}

            {/* Liquidity sweeps — the swing level that was raided (dashed
                line from the swing that formed it), the wick that poked
                through it, and a label. Closed back on the origin side =
                stop hunt / rejection rather than a breakout. */}
            {indicators.sweep && sweeps.map((s, i) => {
              const wick = projectPoint(s.time, s.wick);
              const levelY = candleSeriesRef.current?.priceToCoordinate(s.level);
              if (!wick || levelY == null) return null;
              const color = s.kind === "bullish" ? "#00d084" : "#ff4757";
              const src = marketStructure.swings.find(w => w.price === s.level && w.kind === (s.kind === "bullish" ? "low" : "high"));
              const from = src ? projectPoint(src.time, src.price) : null;
              const x1 = from ? from.x : wick.x - 60;
              const ty = wick.y + (s.kind === "bullish" ? 16 : -8);
              return (
                <g key={`sweep_${i}`}>
                  <line x1={x1} y1={levelY} x2={wick.x + 8} y2={levelY} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
                  <line x1={wick.x} y1={levelY} x2={wick.x} y2={wick.y} stroke={color} strokeWidth={2} />
                  <circle cx={wick.x} cy={wick.y} r={3} fill={color} />
                  <rect x={wick.x - 19} y={ty - 9} width={38} height={12} rx={2}
                    fill="rgba(8,14,24,0.82)" stroke={`${color}55`} strokeWidth={1} />
                  <text x={wick.x} y={ty} textAnchor="middle" fill={color} fontSize={8} fontFamily="monospace" fontWeight={700}>
                    SWEEP
                  </text>
                </g>
              );
            })}

            {/* Candlestick pattern labels. BUG FIX ("pattern labels not
                showing"): bare <text> with no background reads as
                invisible over a candle of a similar colour — a bearish
                label in red sitting right above a red candle, for
                instance. Every label now sits on a small pill so it's
                legible regardless of what's underneath it. */}
            {indicators.pat && candlePatterns.map((p, i) => {
              const above = p.type.bias === "bearish";
              const anchor = projectPoint(p.time, above ? p.high : p.low);
              if (!anchor) return null;
              const color = p.type.bias === "bullish" ? "#00d084" : p.type.bias === "bearish" ? "#ff4757" : "#ffd700";
              const ty = anchor.y + (above ? -10 : 16);
              const w = Math.max(28, p.type.name.length * 5.4);
              return (
                <g key={`pat_${i}`}>
                  <rect x={anchor.x - w / 2} y={ty - 9} width={w} height={13} rx={3}
                    fill="rgba(8,14,24,0.82)" stroke={`${color}55`} strokeWidth={1} />
                  <text x={anchor.x} y={ty} textAnchor="middle" fill={color} fontSize={8} fontFamily="monospace" fontWeight={700}>
                    {p.type.name}
                  </text>
                </g>
              );
            })}

            {/* Drawn after the candle-pattern pills so a retest marker is never buried under one. */}
            {/* Retests — price coming back into a live zone. ✓ = it closed
                back out of the zone (a rejection, not just a touch); a
                heavier outline marks the one happening on the newest bar. */}
            {indicators.retest && retestMarkers.map((r, i) => {
              const bar = candles.find(c => Math.floor(c.time / 1000) === r.time);
              const bull = r.kind === "bullish";
              const anchor = projectPoint(r.time, bar ? (bull ? bar.low : bar.high) : (bull ? r.top : r.bottom));
              if (!anchor) return null;
              const dir = bull ? "#00d084" : "#ff4757";
              const label = `${bull ? "▲" : "▼"} RT·${r.sources.join("/")}${r.n > 1 ? ` ×${r.n}` : ""}${r.confirmed ? " ✓" : ""}${r.active ? " NOW" : ""}`;
              const w = Math.max(44, label.length * 5.6 + 8);
              const ty = anchor.y + (bull ? 44 : -38);
              return (
                <g key={`retest_${i}`}>
                  <line x1={anchor.x} y1={anchor.y + (bull ? 3 : -3)} x2={anchor.x} y2={ty + (bull ? -9 : 4)}
                    stroke="#ffb020" strokeWidth={1} strokeDasharray="2 2" />
                  <rect x={anchor.x - w / 2} y={ty - 9} width={w} height={13} rx={3}
                    fill="rgba(8,14,24,0.88)" stroke="#ffb020" strokeWidth={r.active ? 2 : 1} />
                  <text x={anchor.x} y={ty + 1} textAnchor="middle" fill={dir} fontSize={8} fontFamily="monospace" fontWeight={700}>
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Hand-drawn shapes */}
            {drawings.map(d => {
              const selected = d.id === selectedDrawing;
              const stroke = selected ? "#ffffff" : "#ffd700";
              const width = selected ? 2.5 : 2;

              // A horizontal line has no meaningful second point — it spans
              // the full chart at one price, so it only needs a y.
              if (d.tool === "hline") {
                const y = candleSeriesRef.current?.priceToCoordinate(d.p1);
                if (y == null) return null;
                return (
                  <g key={d.id}>
                    <line x1={0} y1={y} x2="100%" y2={y} stroke={stroke} strokeWidth={width} />
                    <text x={6} y={y - 4} fill={stroke} fontSize={9} fontFamily="monospace">{d.p1.toFixed(4)}</text>
                  </g>
                );
              }

              const a = projectPoint(d.t1, d.p1), b = projectPoint(d.t2, d.p2);
              if (!a || !b) return null;

              if (d.tool === "line") {
                return (
                  <g key={d.id}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={width} />
                    {selected && <>
                      <circle cx={a.x} cy={a.y} r={3.5} fill={stroke} />
                      <circle cx={b.x} cy={b.y} r={3.5} fill={stroke} />
                    </>}
                  </g>
                );
              }

              if (d.tool === "ray") {
                // Extend far past the right edge; the SVG clips it for us.
                const dx = b.x - a.x, dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const scale = 10000 / len;
                return (
                  <g key={d.id}>
                    <line x1={a.x} y1={a.y} x2={a.x + dx * scale} y2={a.y + dy * scale}
                      stroke={stroke} strokeWidth={width} />
                    {selected && <circle cx={a.x} cy={a.y} r={3.5} fill={stroke} />}
                  </g>
                );
              }

              const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
              return (
                <rect key={d.id} x={x} y={y} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
                  fill="#ffd70014" stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
              );
            })}

            {/* Live preview while dragging a new shape out */}
            {drawStartRef.current && previewRef.current && (() => {
              const a = projectPoint(drawStartRef.current.time, drawStartRef.current.price);
              const b = projectPoint(previewRef.current.time, previewRef.current.price);
              if (!a || !b) return null;
              if (drawTool === "line") {
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd700" strokeWidth={2} strokeDasharray="4 3" />;
              }
              if (drawTool === "ray") {
                const dx = b.x - a.x, dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const scale = 10000 / len;
                return <line x1={a.x} y1={a.y} x2={a.x + dx * scale} y2={a.y + dy * scale} stroke="#ffd700" strokeWidth={2} strokeDasharray="4 3" />;
              }
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
              {/* Which bot (if any) owns this position — a manual order and a
                  bot's order looked identical here before. */}
              <span style={{
                color: t.bot_id ? "#0094ff" : "var(--text-mute)", fontSize: 9,
                border: `1px solid ${t.bot_id ? "#0094ff44" : "var(--border2)"}`,
                borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap",
              }}>
                {t.bot_id ? (botById.get(t.bot_id)?.name ?? "Bot") : "Manual"}
              </span>
              <span style={{ color: "var(--text-dim)" }}>Entry {t.price.toFixed(4)}</span>
              <span style={{ color: "var(--text-dim)" }}>Now {currentPrice.toFixed(4)}</span>
              <span style={{ color: pnl >= 0 ? "#00d084" : "#ff4757", fontWeight: 700, marginLeft: "auto" }}>
                {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Live log of what each bot on this pair looked at and decided. */}
      {token && pairBots.length > 0 && (
        <BotActivityPanel token={token} pair={symbol} bots={pairBots} defaultOpen={fullscreen} height={fullscreen ? 260 : 170} />
      )}
    </div>
  );
}
