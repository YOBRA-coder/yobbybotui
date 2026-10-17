import { useState } from "react";
import { useApp } from "../App";
import TopBar from "../components/TopBar";
import { useMtf } from "../hooks/useMtf";
import ChartArea, { ChipBar, DEFAULT_CHIPS, LayerBar, TfSeg, layersFromChips } from "../components/ChartArea";
import { Card, Err } from "../components/ui";
import type { LayerKey } from "../layers";

export default function Charts() {
  const { symbol, entryTf, settings } = useApp();
  const [tf, setTf] = useState("15m");
  const [view, setView] = useState<"single" | "topdown">("single");
  const [chips, setChips] = useState({ ...DEFAULT_CHIPS, setup1h: true, sessions: true });
  const [custom, setCustom] = useState<Record<LayerKey, boolean> | null>(null);
  const tfs = view === "single" ? Array.from(new Set([tf, "4h", "1h"])) : Array.from(new Set(["4h", "1h", entryTf]));
  const { data, error, updated, reload } = useMtf(symbol, tfs, entryTf, settings?.mode);
  const layers = custom ?? layersFromChips(chips);
  return (
    <>
      <TopBar price={data?.price} changePct={data?.changePct} updated={updated} lag={data?.staleMinutes} onRefresh={reload} demo={data?.demo} />
      <div className="page">
        <Card>
          <div className="row" style={{ marginBottom: 12 }}>
            <TfSeg tf={tf} setTf={(t) => { setTf(t); setView("single"); }} />
            <span className="spacer" />
            <div className="seg">
              <button className={view === "single" ? "on" : ""} onClick={() => setView("single")}>▢ Single</button>
              <button className={view === "topdown" ? "on" : ""} onClick={() => setView("topdown")}>▦ Top-down</button>
            </div>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <ChipBar chips={chips} setChips={(c) => { setChips(c); setCustom(null); }} bias={data?.decision.bias_tf ?? "4h"} setup={data?.decision.setup_tf ?? "1h"} />
          </div>
          <details style={{ marginBottom: 12 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>Fine-tune every layer {custom ? "(custom)" : ""}</summary>
            <div style={{ marginTop: 8 }}><LayerBar layers={layers} setLayers={setCustom} /></div>
          </details>
          {error && !data && <Err msg={error} />}
          {data ? <ChartArea res={data} tf={tf} view={view} layers={layers} chips={chips} height={640} /> : <div className="empty">Loading…</div>}
          <div className="mute2" style={{ fontSize: 11, marginTop: 8 }}>Drag to pan · wheel to zoom · double-click to reset · ⤢ for full screen</div>
        </Card>
      </div>
    </>
  );
}
