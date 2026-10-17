import { useMemo } from "react";
import MtfChart from "./MtfChart";
import type { MtfResponse } from "../types";
import { CHART_TFS, tfLabel } from "../types";
import { ALL_OFF, LAYERS, LayerKey, STRUCTURE, withLayers } from "../layers";

export interface Chips { thisTf: boolean; map4h: boolean; setup1h: boolean; trigger: boolean; levels: boolean; sessions: boolean }
export const DEFAULT_CHIPS: Chips = { thisTf: true, map4h: true, setup1h: false, trigger: true, levels: true, sessions: false };

export function layersFromChips(c: Chips): Record<LayerKey, boolean> {
  const on: LayerKey[] = [];
  if (c.thisTf) on.push(...STRUCTURE.filter((k) => k !== "poi" && k !== "retest"));
  if (c.trigger) on.push("plan", "sweep", "bos", "choch", "retest");
  if (c.levels) on.push("levels");
  if (c.sessions) on.push("sessions", "amd");
  return withLayers(on);
}

export function ChipBar({ chips, setChips, bias, setup }: { chips: Chips; setChips: (c: Chips) => void; bias: string; setup: string }) {
  const items: [keyof Chips, string][] = [["thisTf", "This TF"], ["map4h", `${tfLabel(bias)} map`], ["setup1h", `${tfLabel(setup)} setup`], ["trigger", "Trigger"], ["levels", "Levels"], ["sessions", "Sessions · AMD"]];
  return (
    <div className="chips">
      {items.map(([k, l]) => <button key={k} className={`chip ${chips[k] ? "on" : ""}`} onClick={() => setChips({ ...chips, [k]: !chips[k] })}>{l}</button>)}
    </div>
  );
}

export function LayerBar({ layers, setLayers }: { layers: Record<LayerKey, boolean>; setLayers: (l: Record<LayerKey, boolean>) => void }) {
  return (
    <div className="layer-bar">
      {LAYERS.map((l) => (
        <button key={l.key} title={l.hint} className={`layer ${layers[l.key] ? "on" : ""}`} onClick={() => setLayers({ ...layers, [l.key]: !layers[l.key] })}>
          <i style={{ background: l.color }} />{l.label}
        </button>
      ))}
    </div>
  );
}

export function TfSeg({ tf, setTf }: { tf: string; setTf: (t: string) => void }) {
  return <div className="seg">{CHART_TFS.map((t) => <button key={t} className={t === tf ? "on" : ""} onClick={() => setTf(t)}>{t === "1w" ? "1W" : t === "1d" ? "1D" : t.toLowerCase()}</button>)}</div>;
}

/** The chart(s): one panel on the chosen timeframe, or the 4H | 1H | entry top-down trio. */
export default function ChartArea({ res, tf, view, layers, chips, height = 460 }: {
  res: MtfResponse; tf: string; view: "single" | "topdown"; layers: Record<LayerKey, boolean>; chips?: Chips; height?: number;
}) {
  const d = res.decision;
  const panel = (t: string) => res.panels.find((p) => p.tf === t);
  const amdExtra = useMemo(() => [d.amd?.session], [d]);
  const common = { levels: res.levels, amdExtra, plan: d.plan, planTime: d.time };

  if (view === "topdown") {
    const tfs = [d.bias_tf, d.setup_tf, res.entry_tf].filter((t, i, a) => a.indexOf(t) === i);
    const shown = tfs.map(panel).filter(Boolean);
    return (
      <div style={{ display: "grid", gap: 14 }}>
        {shown.map((p) => p && (
          <MtfChart key={p.tf} panel={p} layers={layers} {...common} plan={p.tf === res.entry_tf ? d.plan : null}
            title={`${tfLabel(p.tf)} ${p.tf === d.bias_tf ? "· direction" : p.tf === d.setup_tf ? "· setup" : "· trigger"}`}
            subtitle={`bias ${p.bias}`} height={Math.round(height * 0.78)} />
        ))}
      </div>
    );
  }
  const main = panel(tf);
  if (!main) return <div className="empty">Loading {tfLabel(tf)} candles…</div>;
  const overlays = [chips?.map4h && d.bias_tf !== tf ? panel(d.bias_tf) : null, chips?.setup1h && d.setup_tf !== tf ? panel(d.setup_tf) : null]
    .filter((p): p is NonNullable<typeof p> => !!p);
  return <MtfChart panel={main} layers={layers} overlays={overlays} {...common} title={`${pairName(res.symbol)} · ${tfLabel(tf)}`} subtitle={`bias ${main.bias}`} height={height} />;
}
const pairName = (s: string) => (s.endsWith("USDT") ? `${s.slice(0, -4)}/USDT` : s);
export { ALL_OFF };
