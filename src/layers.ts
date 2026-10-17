export type LayerKey = "ob" | "fvg" | "sd" | "poi" | "bos" | "choch" | "swings" | "eq" | "sweep" | "retest" | "trend" | "pd" | "plan" | "volume" | "levels" | "sessions" | "amd";

export const LAYERS: { key: LayerKey; label: string; hint: string; color: string }[] = [
  { key: "levels", label: "Key levels", hint: "PDH/PDL/PDC, week & month highs/lows, opens, session highs/lows, VWAP, round numbers", color: "#e0a832" },
  { key: "sessions", label: "Sessions", hint: "Asia / London / New York windows shaded on the chart", color: "#35e0d0" },
  { key: "amd", label: "AMD", hint: "Accumulation → Manipulation → Distribution (power of 3)", color: "#c084fc" },
  { key: "ob", label: "Order blocks", hint: "Last opposite candle before an impulse — unmitigated only", color: "#00d084" },
  { key: "fvg", label: "FVG", hint: "Fair value gaps not yet filled", color: "#3b9dff" },
  { key: "sd", label: "Supply / Demand", hint: "Base-and-departure zones", color: "#b78bff" },
  { key: "poi", label: "POI", hint: "Nearest live zone above and below price", color: "#ffd700" },
  { key: "bos", label: "BOS", hint: "Break of structure", color: "#00d084" },
  { key: "choch", label: "CHoCH", hint: "Change of character", color: "#ff9f43" },
  { key: "swings", label: "HH HL LH LL", hint: "Swing structure labels", color: "#8aa4c8" },
  { key: "eq", label: "EQH / EQL", hint: "Equal highs / lows — resting liquidity", color: "#ff7bd5" },
  { key: "sweep", label: "Sweeps", hint: "Liquidity sweeps", color: "#ff4757" },
  { key: "retest", label: "Retests", hint: "Price returning into a live zone", color: "#35e0d0" },
  { key: "trend", label: "Trendlines", hint: "Support / resistance through the last two swings", color: "#c0c8d8" },
  { key: "pd", label: "Premium / Discount", hint: "Dealing range, equilibrium at 50%", color: "#6f86a8" },
  { key: "plan", label: "Trade plan", hint: "Entry, stop and target of the current setup", color: "#0094ff" },
  { key: "volume", label: "Volume", hint: "Volume bars", color: "#4a6080" },
];

export const ALL_OFF = Object.fromEntries(LAYERS.map((l) => [l.key, false])) as Record<LayerKey, boolean>;
export const withLayers = (on: LayerKey[]): Record<LayerKey, boolean> => ({ ...ALL_OFF, ...Object.fromEntries(on.map((k) => [k, true])) } as Record<LayerKey, boolean>);

// Chips above the dashboard chart
export const STRUCTURE: LayerKey[] = ["ob", "fvg", "sd", "bos", "choch", "swings", "eq", "sweep", "pd", "trend", "poi", "retest"];
