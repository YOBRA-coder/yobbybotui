import { useState } from "react";
import { useApp } from "../App";
import TopBar from "../components/TopBar";
import { useMtf } from "../hooks/useMtf";
import ChartArea, { ChipBar, DEFAULT_CHIPS, TfSeg, layersFromChips } from "../components/ChartArea";
import { AmdCard, ChecksCard, LevelsCard, SessionsCard, SignalCard, VotesCard } from "../components/Panels";
import { Card, Err, Icon } from "../components/ui";

export default function Dashboard() {
  const { symbol, entryTf, settings } = useApp();
  const [tf, setTf] = useState("5m");
  const [view, setView] = useState<"single" | "topdown">("single");
  const [chips, setChips] = useState(DEFAULT_CHIPS);
  const tfs = view === "single" ? Array.from(new Set([tf, "4h", "1h"])) : Array.from(new Set(["4h", "1h", entryTf]));
  const { data, error, loading, updated, reload } = useMtf(symbol, tfs, entryTf, settings?.mode);

  return (
    <>
      <TopBar price={data?.price} changePct={data?.changePct} updated={updated} lag={data?.staleMinutes} onRefresh={reload} demo={data?.demo} />
      <div className="page">
        {error && !data && <Err msg={error} />}
        {!data && !error && <div className="empty">Reading {symbol}…</div>}
        {data && (
          <div className="grid-dash">
            <div className="col">
              <Card>
                <div className="row" style={{ marginBottom: 12 }}>
                  <TfSeg tf={tf} setTf={(t) => { setTf(t); setView("single"); }} />
                  <span className="spacer" />
                  <div className="seg">
                    <button className={view === "single" ? "on" : ""} onClick={() => setView("single")}>▢ Single</button>
                    <button className={view === "topdown" ? "on" : ""} onClick={() => setView("topdown")}>▦ Top-down</button>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <ChipBar chips={chips} setChips={setChips} bias={data.decision.bias_tf} setup={data.decision.setup_tf} />
                </div>
                {error && <Err msg={`Refresh failed: ${error} — showing the last good read`} />}
                <ChartArea res={data} tf={tf} view={view} layers={layersFromChips(chips)} chips={chips} height={500} />
                {loading && <div className="mute2" style={{ fontSize: 11, marginTop: 6 }}>updating…</div>}
              </Card>
              <ChecksCard d={data.decision} />
            </div>
            <div className="col">
              <SignalCard d={data.decision} res={data} />
              <SessionsCard sessions={data.sessions} />
              <LevelsCard levels={data.levels} price={data.price} />
              <AmdCard d={data.decision} />
              <VotesCard d={data.decision} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
void Icon;
