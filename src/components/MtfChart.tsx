// components/MtfChart.tsx — one self-contained SVG chart panel for the top-down view.
//
// WHY A DEDICATED CHART: the dashboard needs to show, on ANY timeframe, every
// smart-money concept the engine detected — order blocks, FVGs, supply/demand,
// POI, BOS / CHoCH, HH-HL-LH-LL, equal highs/lows, sweeps, retests, trendlines,
// premium/discount and the trade plan — straight from /market/mtf, so what is
// drawn is exactly what the engine reasoned over. It is plain SVG (no charting
// library): candles + overlays share one coordinate system, so nothing can drift
// out of alignment on zoom/pan, and it renders the same everywhere.
//
// Interaction: drag to pan, the page scrolls normally over the chart; Ctrl/⌘+wheel (pinch) or the +/- buttons zoom, double-click
// to reset, ⤢ for a full-screen view (Esc closes). Zoom/pan survive the live
// refresh — the chart only snaps back to "latest" if you were already there.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStored } from "../context/MtfContext";
import type { LayerKey, MtfCandle, MtfPanel, MtfPlan } from "../types/mtf";

const ML = 8, MR = 66, MT = 10, MB = 22;
const UP = "#00d084", DOWN = "#ff4757";
const BLUE = "#3b9dff", ORANGE = "#ff9f43", PURPLE = "#b78bff", GOLD = "#ffd700", PINK = "#ff7bd5", TEAL = "#35e0d0";

export function fmtPrice(p: number, step?: number): string {
  if (!isFinite(p)) return "–";
  const a = Math.abs(p);
  let d = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.1 ? 5 : 6;
  if (step && step > 0) d = Math.min(8, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function fmtTime(sec: number, barMs: number, full = false): string {
  const d = new Date(sec * 1000);
  const date = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (barMs >= 86_400_000) return full ? `${d.getFullYear()}-${date}` : date;
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export interface MtfChartProps {
  panel: MtfPanel;
  layers: Record<LayerKey, boolean>;
  plan?: MtfPlan | null;
  /** open time (s) of the bar the plan was produced on — where the position box starts */
  planTime?: number;
  title?: string;
  subtitle?: string;
  height?: number;
  /** header controls rendered on the right (e.g. a timeframe selector) */
  headerRight?: React.ReactNode;
  /** shown beside the chart in the full-screen view (log, news, levels…) */
  side?: React.ReactNode;
  /** called when the user asks for more candles than are loaded */
  onNeedMore?: (bars: number) => void;
  /** past signals drawn on the chart */
  marks?: ChartMark[];
  /** headlines drawn as flags along the bottom */
  news?: { time: number; title: string; link: string; source: string }[];
  /** extra controls shown under the header in the full-screen view (timeframe, concept toggles) */
  fullTools?: React.ReactNode;
  onExpandChange?: (expanded: boolean) => void;
}

export interface ChartMark { time: number; price: number; side: "BUY" | "SELL"; status: "OPEN" | "WIN" | "LOSS" | "EXPIRED"; r?: number | null }

export type ChartKind = "candles" | "line" | "area";
const COUNTS = [50, 100, 200, 300, 600, 1000, 1500];

export default function MtfChart({ panel, layers, plan, planTime, title, subtitle, height = 400, headerRight, side, onNeedMore, marks, news, fullTools, onExpandChange }: MtfChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const uid = useRef("mc" + Math.random().toString(36).slice(2, 8)).current;
  const [width, setWidth] = useState(640);
  const [expanded, setExpanded] = useState(false);
  const [winH, setWinH] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  const [count, setCount] = useStored<number>("cs_ccount", 110);          // bars on screen (remembered)
  const [kind, setKind] = useStored<ChartKind>("cs_ckind", "candles");   // candles | line | area (remembered)
  const [showSide, setShowSide] = useStored<boolean>("cs_side", true);     // full view: show / hide the log-news panel
  const [wheelZoom, setWheelZoom] = useStored<boolean>("cs_wheelzoom", false); // inline: wheel zooms instead of scrolling the page
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; count: number } | null>(null);
  const [winW, setWinW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [offset, setOffset] = useState(0);          // bars scrolled back from the newest
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; off: number } | null>(null);

  const cs = panel.candles;
  const n = cs.length;
  const H = expanded ? Math.max(360, winH - 64) : height;

  // width follows the container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  useEffect(() => { onExpandChange?.(expanded); }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset(0); }, [panel.tf]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    const onResize = () => { setWinH(window.innerHeight); setWinW(window.innerWidth); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, []);

  // Wheel: in the full view it always zooms (there is no page behind it). Inline, the page keeps scrolling unless
  // you switch "wheel zoom" on (🖱) or hold Ctrl/⌘ (also pinch on a trackpad). Sideways wheel / Shift+wheel pans.
  const zoomRef = useRef<(factor: number, fx: number) => void>(() => undefined);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const zooming = e.ctrlKey || e.metaKey || expanded || wheelZoom;
      const dx = e.shiftKey ? e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (dx) {
        e.preventDefault();
        setOffset(o => Math.max(0, Math.round(o - Math.sign(dx) * Math.max(1, Math.abs(dx) / 20))));
        return;
      }
      if (!zooming) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(e.deltaY > 0 ? 1.12 : 0.88, (e.clientX - r.left - ML) / Math.max(1, width - ML - MR));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [expanded, wheelZoom, width]);

  const vcount = Math.min(Math.max(20, count), Math.max(20, n));
  const maxOff = Math.max(0, n - vcount);
  const off = Math.min(offset, maxOff);
  const end = n - off;
  const start = Math.max(0, end - vcount);
  const padBars = off === 0 ? Math.max(3, Math.round(vcount * 0.07)) : 0;
  const plotW = width - ML - MR;
  const plotH = H - MT - MB;
  const barW = plotW / (vcount + padBars);
  const barSec = (panel.barMs || (n > 1 ? (cs[1].time - cs[0].time) * 1000 : 60_000)) / 1000;

  // zoom keeping the candle under the pointer (fx = 0..1 across the plot) where it is
  zoomRef.current = (factor: number, fx: number) => {
    const f = Math.min(1, Math.max(0, fx));
    const want = Math.round(Math.max(20, vcount * factor));
    if (want > n) { setCount(want); setOffset(0); onNeedMore?.(want); return; }   // ask for more history
    const nc = want;
    if (nc === vcount) return;
    const anchor = start + f * (vcount + padBars);
    const newStart = anchor - f * (nc + (off === 0 ? Math.max(3, Math.round(nc * 0.07)) : 0));
    setCount(nc);
    setOffset(Math.max(0, Math.min(Math.max(0, n - nc), Math.round(n - (newStart + nc)))));
  };
  const xi = (i: number) => ML + (i - start + 0.5) * barW;
  // fractional bar index for a timestamp (seconds); may be < 0 or > n-1
  const idxOfTime = (t: number): number => {
    if (n === 0) return 0;
    if (t >= cs[n - 1].time) return n - 1 + (t - cs[n - 1].time) / barSec;
    if (t <= cs[0].time) return (t - cs[0].time) / barSec;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cs[mid].time <= t) lo = mid; else hi = mid - 1;
    }
    return lo + (t - cs[lo].time) / barSec;
  };
  const xt = (t: number) => xi(idxOfTime(t));
  const xRight = width - MR;
  const clampX = (x: number) => Math.min(xRight, Math.max(ML, x));

  const vis: MtfCandle[] = cs.slice(start, end);
  const range = useMemo(() => {
    if (!vis.length) return { lo: 0, hi: 1 };
    let lo = Infinity, hi = -Infinity;
    for (const c of vis) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
    const span = hi - lo || hi * 0.01;
    if (layers.plan && plan) {
      for (const p of [plan.entry, plan.sl, plan.tp]) {
        if (Math.abs(p - (hi + lo) / 2) < span * 2.2) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
      }
    }
    const pad = (hi - lo) * 0.06 || hi * 0.002;
    return { lo: lo - pad, hi: hi + pad };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, n, panel.candles, layers.plan, plan]);

  const yp = (p: number) => MT + ((range.hi - p) / (range.hi - range.lo)) * plotH;
  const inView = (top: number, bottom: number) => yp(bottom) >= MT - 40 && yp(top) <= MT + plotH + 40;

  // axis ticks
  const step = niceStep((range.hi - range.lo) / 6);
  const ticks: number[] = [];
  for (let p = Math.ceil(range.lo / step) * step; p <= range.hi; p += step) ticks.push(p);
  const tEvery = Math.max(1, Math.ceil(100 / barW));
  const tTicks: number[] = [];
  for (let i = end - 1; i >= start; i -= tEvery) if (xi(i) > ML + 48) tTicks.push(i);

  const last = cs[n - 1];
  const hIdx = hover ? Math.min(end - 1, Math.max(start, start + Math.floor((hover.x - ML) / barW))) : null;
  const hc = hIdx != null ? cs[hIdx] : null;
  const hp = hover ? range.hi - ((hover.y - MT) / plotH) * (range.hi - range.lo) : null;

  const vmax = useMemo(() => Math.max(1e-9, ...vis.map(c => c.volume)), [vis]);

  // ── overlays ───────────────────────────────────────────────────────────────
  const tfTag = panel.tf.toUpperCase();
  const zoneEls: React.ReactNode[] = [];
  const usedLabelY: number[] = [];
  const lastPx = cs.length ? cs[cs.length - 1].close : 0;
  // keep the chart readable: only the zones nearest to price are drawn
  const nearest = <T extends { top: number; bottom: number }>(arr: T[], k: number): T[] =>
    [...arr].sort((a, b) => Math.abs((a.top + a.bottom) / 2 - lastPx) - Math.abs((b.top + b.bottom) / 2 - lastPx)).slice(0, k);
  const addZone = (key: string, top: number, bottom: number, t0: number, label: string, color: string, fill: number, dash?: string, bold?: boolean) => {
    if (!inView(top, bottom)) return;
    const x0 = clampX(xt(t0));
    if (x0 >= xRight - 2) return;
    const y0 = yp(top), y1 = yp(bottom);
    const h = Math.max(1.5, y1 - y0);
    zoneEls.push(
      <g key={key}>
        <rect x={x0} y={y0} width={xRight - x0} height={h} fill={color} fillOpacity={fill} stroke={color} strokeOpacity={bold ? 0.95 : 0.55} strokeWidth={bold ? 1.4 : 1} strokeDasharray={dash} />
        {h >= 11 && !usedLabelY.some(u => Math.abs(u - y0) < 11) && usedLabelY.push(y0) > 0 && <text x={x0 + 4} y={y0 + 10} fontSize={9} fontWeight={700} fill={color} fillOpacity={0.95} style={{ pointerEvents: "none" }}>{label}</text>}
      </g>,
    );
  };
  if (layers.pd && panel.pd) {
    const pd = panel.pd;
    const x0 = clampX(xt(pd.t_start));
    const yh = yp(pd.high), ye = yp(pd.eq), yl = yp(pd.low);
    zoneEls.push(
      <g key="pd" style={{ pointerEvents: "none" }}>
        <rect x={x0} y={yh} width={xRight - x0} height={Math.max(0, ye - yh)} fill={DOWN} fillOpacity={0.045} />
        <rect x={x0} y={ye} width={xRight - x0} height={Math.max(0, yl - ye)} fill={UP} fillOpacity={0.045} />
        <line x1={x0} x2={xRight} y1={ye} y2={ye} stroke="#6f86a8" strokeDasharray="2 4" strokeOpacity={0.8} />
        <text x={xRight - 4} y={ye - 3} textAnchor="end" fontSize={9} fill="#6f86a8">EQ 50%</text>
        <text x={xRight - 4} y={yh + 11} textAnchor="end" fontSize={9} fill={DOWN} fillOpacity={0.7}>PREMIUM</text>
        <text x={xRight - 4} y={yl - 4} textAnchor="end" fontSize={9} fill={UP} fillOpacity={0.7}>DISCOUNT</text>
      </g>,
    );
  }
  if (layers.sd) nearest(panel.sdZones, 4).forEach((z, i) =>
    addZone(`sd${i}`, z.top, z.bottom, z.time, `${tfTag} ${z.kind === "demand" ? "DEMAND" : "SUPPLY"}${z.fresh ? " ·fresh" : ""}`,
      z.kind === "demand" ? PURPLE : PINK, 0.1, "4 3"));
  if (layers.ob) nearest(panel.orderBlocks.filter(b => !b.mitigated), 4).forEach((b, i) =>
    addZone(`ob${i}`, b.top, b.bottom, b.time, `${tfTag} ${b.kind === "bullish" ? "BULL" : "BEAR"} OB ×${b.strength.toFixed(1)}`,
      b.kind === "bullish" ? UP : DOWN, 0.15));
  if (layers.fvg) nearest(panel.fvgs.filter(g => !g.filled), 5).forEach((g, i) =>
    addZone(`fvg${i}`, g.top, g.bottom, g.time, `${tfTag} ${g.kind === "bullish" ? "BULL" : "BEAR"} FVG${g.fillPct > 0 ? ` ${g.fillPct.toFixed(0)}%` : ""}`,
      g.kind === "bullish" ? BLUE : ORANGE, 0.13, "2 2"));
  if (layers.poi) panel.poi.forEach((p, i) =>
    addZone(`poi${i}`, p.top, p.bottom, p.time, `POI · ${p.source}`, GOLD, 0.0, "6 3", true));

  const lineEls: React.ReactNode[] = [];
  if (layers.trend) panel.trendlines.forEach((t, i) => {
    const xA = xt(t.t1), xB = xt(t.t2);
    const yA = yp(t.p1), yB = yp(t.p2);
    const slopePx = (yB - yA) / (xB - xA || 1);
    const xEnd = xRight;
    const yEnd = yB + slopePx * (xEnd - xB);
    const col = t.kind === "support" ? UP : DOWN;
    lineEls.push(
      <g key={`tl${i}`} style={{ pointerEvents: "none" }}>
        <line x1={xA} y1={yA} x2={xEnd} y2={yEnd} stroke={col} strokeWidth={1.3} strokeDasharray={t.broken ? "3 4" : undefined} strokeOpacity={t.broken ? 0.45 : 0.9} />
        <text x={Math.max(ML + 2, Math.min(xB, xRight - 40))} y={yB + (t.kind === "support" ? 12 : -5)} fontSize={9} fill={col}>
          {t.kind === "support" ? "TL support" : "TL resistance"}{t.broken ? " ✕" : ""}
        </text>
      </g>,
    );
  });
  if (layers.eq) panel.eq.forEach((e, i) => {
    const x0 = clampX(xt(e.t1));
    const x1 = e.swept ? clampX(xt(e.t2) + barW * 6) : xRight;
    const y = yp(e.price);
    if (y < MT - 5 || y > MT + plotH + 5) return;
    lineEls.push(
      <g key={`eq${i}`} style={{ pointerEvents: "none" }}>
        <line x1={x0} x2={x1} y1={y} y2={y} stroke={PINK} strokeDasharray="5 3" strokeOpacity={e.swept ? 0.35 : 0.95} />
        <text x={x0 + 3} y={y + (e.kind === "EQH" ? -3 : 10)} fontSize={9} fontWeight={700} fill={PINK} fillOpacity={e.swept ? 0.5 : 1}>
          {e.kind}{e.swept ? " swept" : ""}
        </text>
      </g>,
    );
  });
  panel.breaks.events.forEach((b, i) => {
    if (b.kind === "BOS" ? !layers.bos : !layers.choch) return;
    const x0 = clampX(xt(b.from_time)), x1 = clampX(xt(b.time));
    if (x1 <= ML) return;
    const y = yp(b.level);
    if (y < MT - 5 || y > MT + plotH + 5) return;
    const col = b.kind === "CHoCH" ? ORANGE : b.dir === "bullish" ? UP : DOWN;
    const up = b.dir === "bullish";
    lineEls.push(
      <g key={`br${i}`} style={{ pointerEvents: "none" }}>
        <line x1={x0} x2={x1} y1={y} y2={y} stroke={col} strokeDasharray={b.kind === "BOS" ? "6 3" : "2 2"} strokeWidth={b.kind === "CHoCH" ? 1.6 : 1.2} />
        <text x={(x0 + x1) / 2} y={up ? y - 4 : y + 11} textAnchor="middle" fontSize={9} fontWeight={800} fill={col}>
          {b.kind}{up ? " ▲" : " ▼"}
        </text>
      </g>,
    );
  });

  const markEls: React.ReactNode[] = [];
  if (layers.swings) panel.structure.swings.forEach((s, i) => {
    if (!s.label) return;
    const x = xt(s.time);
    if (x < ML || x > xRight) return;
    const y = yp(s.price);
    const good = s.label === "HH" || s.label === "HL";
    markEls.push(
      <text key={`sw${i}`} x={x} y={s.kind === "high" ? y - 5 : y + 12} textAnchor="middle" fontSize={10} fontWeight={800}
        fill={good ? UP : DOWN} style={{ pointerEvents: "none" }}>{s.label}</text>,
    );
  });
  if (layers.sweep) panel.sweeps.forEach((s, i) => {
    const x = xt(s.time);
    if (x < ML || x > xRight) return;
    const yl = yp(s.level), yw = yp(s.wick);
    markEls.push(
      <g key={`sp${i}`} style={{ pointerEvents: "none" }}>
        <line x1={x - barW * 5} x2={x + barW * 1.5} y1={yl} y2={yl} stroke={DOWN} strokeDasharray="3 2" strokeOpacity={0.8} />
        <circle cx={x} cy={yw} r={3.2} fill="none" stroke={DOWN} strokeWidth={1.4} />
        <text x={x} y={s.kind === "bullish" ? yw + 13 : yw - 6} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={DOWN}>
          SWEEP {s.kind === "bullish" ? "↑" : "↓"}
        </text>
      </g>,
    );
  });
  if (layers.retest) panel.retests.forEach((r, i) => {
    const x = xt(r.time);
    if (x < ML || x > xRight) return;
    const y = yp((r.top + r.bottom) / 2);
    markEls.push(
      <g key={`rt${i}`} style={{ pointerEvents: "none" }}>
        <circle cx={x} cy={y} r={4} fill={r.confirmed ? TEAL : "none"} stroke={TEAL} strokeWidth={1.4} />
        <text x={x + 7} y={y + 3} fontSize={8.5} fontWeight={700} fill={TEAL}>RT {r.source}{r.active ? " ●" : ""}</text>
      </g>,
    );
  });

  // earlier signals
  if (layers.signals) (marks ?? []).forEach((m, i) => {
    const x = xt(m.time);
    if (x < ML || x > xRight) return;
    const y = yp(m.price);
    if (y < MT || y > MT + plotH) return;
    const col = m.status === "WIN" ? UP : m.status === "LOSS" ? DOWN : m.status === "EXPIRED" ? "#6f86a8" : BLUE;
    const up = m.side === "BUY";
    const label = `${m.side}${m.status === "OPEN" ? " · fired" : m.status === "WIN" ? ` ✓ ${m.r != null ? (m.r > 0 ? "+" : "") + m.r + "R" : ""}` : m.status === "LOSS" ? " ✗ stopped" : " · expired"}`;
    markEls.push(
      <g key={`sg${i}`} style={{ pointerEvents: "none" }}>
        <polygon points={up ? `${x},${y - 2} ${x - 6},${y + 9} ${x + 6},${y + 9}` : `${x},${y + 2} ${x - 6},${y - 9} ${x + 6},${y - 9}`} fill={col} stroke="#000" strokeOpacity={0.35} />
        <text x={x} y={up ? y + 21 : y - 14} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={col}>{label}</text>
      </g>,
    );
  });

  // headlines (flags along the bottom of the plot; click to open)
  const newsEls: React.ReactNode[] = [];
  if (layers.news) (news ?? []).forEach((nw, i) => {
    const x = xt(nw.time);
    if (x < ML + 4 || x > xRight - 4) return;
    newsEls.push(
      <a key={`nw${i}`} href={nw.link} target="_blank" rel="noopener noreferrer" onPointerDown={e => e.stopPropagation()}>
        <title>{`${nw.source}: ${nw.title}`}</title>
        <line x1={x} x2={x} y1={MT + plotH - 16} y2={MT + plotH} stroke="#ffb86b" strokeOpacity={0.7} />
        <rect x={x - 6} y={MT + plotH - 28} width={12} height={12} rx={2} fill="#ffb86b" style={{ cursor: "pointer" }} />
        <text x={x} y={MT + plotH - 18.5} textAnchor="middle" fontSize={8} fontWeight={800} fill="#000" style={{ pointerEvents: "none" }}>N</text>
      </a>,
    );
  });

  // trade plan box
  const planEls: React.ReactNode[] = [];
  if (layers.plan && plan) {
    const x0 = clampX(xt(planTime ?? (last ? last.time : 0)));
    const yE = yp(plan.entry), yS = yp(plan.sl), yT = yp(plan.tp);
    const w = Math.max(6, xRight - x0);
    const axisBox = (y: number, label: string, col: string, key: string) => (
      <g key={key} style={{ pointerEvents: "none" }}>
        <rect x={xRight} y={y - 8} width={MR - 2} height={16} fill={col} rx={2} />
        <text x={xRight + 4} y={y + 3.5} fontSize={9} fontWeight={800} fill="#000">{label}</text>
      </g>
    );
    planEls.push(
      <g key="plan" style={{ pointerEvents: "none" }}>
        <rect x={x0} y={Math.min(yE, yT)} width={w} height={Math.abs(yT - yE)} fill={UP} fillOpacity={0.12} />
        <rect x={x0} y={Math.min(yE, yS)} width={w} height={Math.abs(yS - yE)} fill={DOWN} fillOpacity={0.12} />
        <line x1={x0} x2={xRight} y1={yE} y2={yE} stroke={BLUE} strokeWidth={1.5} />
        <line x1={x0} x2={xRight} y1={yS} y2={yS} stroke={DOWN} strokeWidth={1.2} strokeDasharray="5 3" />
        <line x1={x0} x2={xRight} y1={yT} y2={yT} stroke={UP} strokeWidth={1.2} strokeDasharray="5 3" />
        <text x={x0 + 4} y={yE - 4} fontSize={9} fontWeight={800} fill={BLUE}>{plan.side} {plan.rr}R · risk {plan.risk_pct.toFixed(2)}%</text>
      </g>,
      axisBox(yE, fmtPrice(plan.entry, step), BLUE, "pe"),
      axisBox(yS, fmtPrice(plan.sl, step), DOWN, "ps"),
      axisBox(yT, fmtPrice(plan.tp, step), UP, "pt"),
    );
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, count: vcount };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, off };
    }
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {          // two fingers: pinch to zoom
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const want = Math.round(Math.min(Math.max(20, n), Math.max(20, pinch.current.count * (pinch.current.dist / dist))));
      if (want !== vcount) zoomRef.current(want / vcount, ((a.x + b.x) / 2 - r.left - ML) / Math.max(1, plotW));
      return;
    }
    if (drag.current) {
      const d = Math.round((e.clientX - drag.current.x) / barW);
      setOffset(Math.min(maxOff, Math.max(0, drag.current.off + d)));
    }
    setHover(x >= ML && x <= xRight && y >= MT && y <= MT + plotH ? { x, y } : null);
  };
  const onUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    if (e) pointers.current.delete(e.pointerId); else pointers.current.clear();
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
    else if (pointers.current.size === 1) { const [p0] = [...pointers.current.values()]; drag.current = { x: p0.x, off }; }
  };
  const reset = () => { setCount(110); setOffset(0); };
  const pickCount = (v: number) => { setCount(v); setOffset(0); if (v > n) onNeedMore?.(v); };
  const kindBtn = (k: ChartKind, label: string, tip: string) => (
    <button key={k} style={{ ...btn, color: kind === k ? "var(--text)" : "var(--text-dim)", borderColor: kind === k ? "#0094ff" : "var(--border2)", background: kind === k ? "#0094ff22" : "transparent" }} title={tip} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
  );

  const btn: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--border2)", color: "var(--text-dim)", borderRadius: 5,
    padding: "2px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4,
  };

  const body = (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", ...(expanded ? { position: "fixed", inset: 0, zIndex: 2000, borderRadius: 0, background: "var(--bg)", overflowY: "auto" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: 1, color: "var(--text)" }}>{title ?? tfTag}</span>
        {subtitle && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{subtitle}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {headerRight}
          {kindBtn("candles", "▮", "Candles")}{kindBtn("line", "∿", "Line chart")}{kindBtn("area", "◭", "Area chart")}
          <select value={vcount} onChange={e => pickCount(+e.target.value)} style={{ ...btn, padding: "2px 4px" }} title="Candles on screen (more are loaded on demand)" aria-label="candles on screen">
            {(COUNTS.includes(vcount) ? COUNTS : [...COUNTS, vcount].sort((a, b) => a - b)).map(c => <option key={c} value={c}>{c} bars</option>)}
          </select>
          {!expanded && <button style={{ ...btn, color: wheelZoom ? "var(--text)" : "var(--text-dim)", borderColor: wheelZoom ? "#0094ff" : "var(--border2)" }} title={wheelZoom ? "Mouse wheel zooms the chart (click: wheel scrolls the page again)" : "Mouse wheel scrolls the page (click: wheel zooms the chart). Ctrl+wheel always zooms."} aria-pressed={wheelZoom} onClick={() => setWheelZoom(!wheelZoom)}>🖱 {wheelZoom ? "zoom" : "scroll"}</button>}
          {expanded && side && <button style={{ ...btn, color: showSide ? "var(--text)" : "var(--text-dim)", borderColor: showSide ? "#0094ff" : "var(--border2)" }} title={showSide ? "Hide the log / news panel (chart only)" : "Show the log / news panel"} aria-pressed={showSide} onClick={() => setShowSide(!showSide)}>◧ {showSide ? "Hide panel" : "Panel"}</button>}
          <button style={btn} title="Zoom out" onClick={() => zoomRef.current(1.25, 0.5)}>−</button>
          <button style={btn} title="Zoom in" onClick={() => zoomRef.current(0.8, 0.5)}>+</button>
          <button style={btn} title="Reset zoom, jump to latest" onClick={reset}>⟲</button>
          <button style={btn} title={expanded ? "Close (Esc)" : "Expand"} onClick={() => setExpanded(x => !x)}>{expanded ? "✕" : "⤢"}</button>
        </span>
      </div>
      {expanded && fullTools && <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>{fullTools}</div>}
      <div style={{ display: "flex", flexWrap: expanded && side && showSide && winW < 900 ? "wrap" : "nowrap" }}>
      <div ref={wrapRef} style={{ flex: 1, minWidth: 0, width: "100%", position: "relative" }}>
        <svg ref={svgRef} width={width} height={H} role="img" aria-label={`${tfTag} chart`}
          style={{ display: "block", touchAction: expanded ? "none" : "pan-y", cursor: drag.current ? "grabbing" : "crosshair", userSelect: "none" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={e => { if (e.pointerType === "mouse") { onUp(e); setHover(null); } }}
          onDoubleClick={reset}>
          <defs><clipPath id={uid}><rect x={ML} y={MT} width={plotW} height={plotH} /></clipPath></defs>
          {/* grid + price axis */}
          {ticks.map(p => (
            <g key={p}>
              <line x1={ML} x2={xRight} y1={yp(p)} y2={yp(p)} stroke="var(--border)" strokeOpacity={0.9} />
              <text x={xRight + 5} y={yp(p) + 3} fontSize={10} fill="var(--text-dim)">{fmtPrice(p, step)}</text>
            </g>
          ))}
          {tTicks.map(i => (
            <g key={i}>
              <line x1={xi(i)} x2={xi(i)} y1={MT} y2={MT + plotH} stroke="var(--border)" strokeOpacity={0.45} />
              <text x={xi(i)} y={H - 7} textAnchor="middle" fontSize={9.5} fill="var(--text-dim)">{fmtTime(cs[i].time, panel.barMs)}</text>
            </g>
          ))}
          <g clipPath={`url(#${uid})`}>
            {layers.volume && vis.map((c, k) => {
              const h = (c.volume / vmax) * plotH * 0.14;
              return <rect key={`v${k}`} x={xi(start + k) - barW * 0.35} y={MT + plotH - h} width={Math.max(1, barW * 0.7)} height={h} fill={c.close >= c.open ? UP : DOWN} fillOpacity={0.18} />;
            })}
            {zoneEls}
            {lineEls}
            {kind === "candles" && vis.map((c, k) => {
              const x = xi(start + k);
              const up = c.close >= c.open;
              const col = up ? UP : DOWN;
              const yo = yp(c.open), yc = yp(c.close);
              return (
                <g key={c.time}>
                  <line x1={x} x2={x} y1={yp(c.high)} y2={yp(c.low)} stroke={col} strokeWidth={1} />
                  <rect x={x - Math.max(1, barW * 0.36)} y={Math.min(yo, yc)} width={Math.max(2, barW * 0.72)} height={Math.max(1, Math.abs(yc - yo))} fill={col} />
                </g>
              );
            })}
            {kind !== "candles" && vis.length > 1 && (() => {
              const pts = vis.map((c, k) => `${xi(start + k)},${yp(c.close)}`);
              const col = vis[vis.length - 1].close >= vis[0].close ? UP : DOWN;
              return (
                <g>
                  {kind === "area" && <>
                    <defs><linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity={0.35} /><stop offset="100%" stopColor={col} stopOpacity={0.02} /></linearGradient></defs>
                    <polygon points={`${xi(start)},${MT + plotH} ${pts.join(" ")} ${xi(end - 1)},${MT + plotH}`} fill={`url(#${uid}g)`} />
                  </>}
                  <polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth={1.8} strokeLinejoin="round" />
                </g>
              );
            })()}
            {markEls}
            {planEls.filter((_, i) => i === 0)}
            {last && (
              <line x1={ML} x2={xRight} y1={yp(last.close)} y2={yp(last.close)} stroke={last.close >= last.open ? UP : DOWN} strokeDasharray="2 3" strokeOpacity={0.7} />
            )}
            {hover && <>
              <line x1={hover.x} x2={hover.x} y1={MT} y2={MT + plotH} stroke="var(--text-dim)" strokeDasharray="3 3" strokeOpacity={0.7} />
              <line x1={ML} x2={xRight} y1={hover.y} y2={hover.y} stroke="var(--text-dim)" strokeDasharray="3 3" strokeOpacity={0.7} />
            </>}
          </g>
          {newsEls}
          {planEls.filter((_, i) => i > 0)}
          {last && (
            <g style={{ pointerEvents: "none" }}>
              <rect x={xRight} y={yp(last.close) - 8} width={MR - 2} height={16} fill={last.close >= last.open ? UP : DOWN} rx={2} />
              <text x={xRight + 4} y={yp(last.close) + 3.5} fontSize={9.5} fontWeight={800} fill="#000">{fmtPrice(last.close, step)}</text>
            </g>
          )}
          {hover && hp != null && hc && (
            <g style={{ pointerEvents: "none" }}>
              <rect x={xRight} y={hover.y - 8} width={MR - 2} height={16} fill="#2a3b55" rx={2} />
              <text x={xRight + 4} y={hover.y + 3.5} fontSize={9.5} fill="#fff">{fmtPrice(hp, step)}</text>
              <rect x={Math.min(hover.x - 44, width - MR - 92)} y={H - MB + 1} width={88} height={15} fill="#2a3b55" rx={2} />
              <text x={Math.min(hover.x, width - MR - 48)} y={H - MB + 12} textAnchor="middle" fontSize={9.5} fill="#fff">{fmtTime(hc.time, panel.barMs, true)}</text>
            </g>
          )}
          {/* OHLC read-out */}
          {(() => {
            const c = hc ?? last;
            if (!c) return null;
            const chg = ((c.close - c.open) / c.open) * 100;
            return (
              <text x={ML + 6} y={MT + 12} fontSize={10} fill="var(--text-dim)" style={{ pointerEvents: "none" }}>
                <tspan fill="var(--text)" fontWeight={700}>{tfTag}</tspan>
                {"  O "}<tspan fill="var(--text)">{fmtPrice(c.open, step)}</tspan>
                {"  H "}<tspan fill="var(--text)">{fmtPrice(c.high, step)}</tspan>
                {"  L "}<tspan fill="var(--text)">{fmtPrice(c.low, step)}</tspan>
                {"  C "}<tspan fill={c.close >= c.open ? UP : DOWN}>{fmtPrice(c.close, step)} ({chg >= 0 ? "+" : ""}{chg.toFixed(2)}%)</tspan>
              </text>
            );
          })()}
          {n === 0 && <text x={width / 2} y={H / 2} textAnchor="middle" fill="var(--text-dim)" fontSize={12}>No candles yet</text>}
        </svg>
      </div>
      {expanded && side && showSide && (
        <aside style={{ flex: winW < 900 ? "1 1 100%" : "0 0 360px", width: winW < 900 ? "100%" : 360, borderLeft: winW < 900 ? "none" : "1px solid var(--border)", borderTop: winW < 900 ? "1px solid var(--border)" : "none", maxHeight: winW < 900 ? undefined : H, overflowY: "auto" }}>{side}</aside>
      )}
      </div>
    </div>
  );

  if (!expanded) return body;
  // keep the grid slot occupied while the expanded copy is fixed over the page
  return <div style={{ height }}>{body}</div>;
}
