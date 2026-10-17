import { useCallback, useEffect, useState } from "react";
import { settingsApi, strategyApi } from "../api/client";
import { useApp } from "../App";
import TopBar from "../components/TopBar";
import { Card, Err, Pill, Switch, VerdictPill, pair, rfmt } from "../components/ui";
import type { ConfirmStrategy, CoreStrategy } from "../types";

export default function Strategies() {
  const { isAdmin, settings, reloadSettings } = useApp();
  const [core, setCore] = useState<CoreStrategy[]>([]);
  const [conf, setConf] = useState<ConfirmStrategy[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => strategyApi.list().then((r) => { setCore(r.core); setConf(r.confirmations); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);
  const guard = (p: Promise<unknown>) => p.then(() => { load(); reloadSettings(); setErr(null); }).catch((e) => setErr(e.message));
  return (
    <>
      <TopBar showEntry={false} />
      <div className="page">
        <Err msg={err} />
        {!isAdmin && <div className="blocked">Only the admin (first registered account) can approve or disable strategies. You can see their state here.</div>}
        <Card title="1 · Core setups — the only things allowed to start a signal">
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>A signal can only come from an approved core setup. Switch one off and the scanner stops signalling from it immediately.</div>
          {core.map((s) => (
            <div key={s.key} style={{ borderTop: "1px solid var(--border)", padding: "14px 0" }}>
              <div className="row">
                <b style={{ fontSize: 16 }}>{s.label}</b><Pill tone="blue">{s.bias_tf.toUpperCase()} → {s.setup_tf.toUpperCase()} → {s.entry_tfs.join(" / ")}</Pill><Pill>{s.rr}R target</Pill>
                <span className="spacer" /><span className="muted" style={{ fontSize: 12 }}>{s.approved ? "approved" : "off"}</span><Switch on={s.approved} disabled={!isAdmin} onChange={(v) => guard(strategyApi.approveCore(s.key, v))} />
              </div>
              <div className="muted" style={{ margin: "6px 0 10px" }}>{s.desc}</div>
              <div className="row" style={{ gap: 6 }}>
                {s.verdicts.length === 0 && <span className="mute2" style={{ fontSize: 12 }}>Backtests are running — verdicts appear here.</span>}
                {s.verdicts.map((v) => (
                  <span key={v.symbol + v.entry_tf} title={(v.why ?? []).join("\n")}><Pill tone={v.verdict === "APPROVED" ? "green" : v.verdict === "REJECTED" ? "red" : undefined}>{pair(v.symbol)} · {v.verdict.toLowerCase()}{v.net_r != null ? ` ${rfmt(v.net_r)}` : ""}</Pill></span>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <Card title="2 · Confirmation strategies — must agree before a signal fires" right={<span className="mute2" style={{ textTransform: "none", letterSpacing: 0 }}>the old bot strategies, now voting on trades instead of placing them</span>}>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="muted" style={{ fontSize: 13 }}>Net votes required (supports − opposes):</span>
            <select className="select" disabled={!isAdmin} value={settings?.min_confirms ?? 1} onChange={(e) => guard(settingsApi.patch({ min_confirms: +e.target.value }))}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select>
          </div>
          {conf.map((c) => (
            <div key={c.key} className="row" style={{ borderTop: "1px solid var(--border)", padding: "12px 0", alignItems: "flex-start", flexWrap: "nowrap" }}>
              <div style={{ flex: 1 }}><b>{c.key}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{c.desc}</div></div>
              <Switch on={c.approved} disabled={!isAdmin} onChange={(v) => guard(strategyApi.approveConfirm(c.key, v))} />
            </div>
          ))}
        </Card>
        <Card title="3 · Safety gates">
          <Gate title="Backtest approval required" desc="Only fire where the pair + strategy backtest is approved (profit factor, net result and recent-third checks). Strongly recommended." on={settings?.require_backtest ?? true} disabled={!isAdmin} onChange={(v) => guard(settingsApi.patch({ require_backtest: v }))} />
          <Gate title="Long-only (spot)" desc="Never signal shorts — for spot traders who cannot sell what they do not own." on={settings?.long_only ?? false} disabled={!isAdmin} onChange={(v) => guard(settingsApi.patch({ long_only: v }))} />
        </Card>
      </div>
    </>
  );
}
function Gate({ title, desc, on, onChange, disabled }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <div className="row" style={{ borderTop: "1px solid var(--border)", padding: "12px 0", flexWrap: "nowrap" }}><div style={{ flex: 1 }}><b>{title}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{desc}</div></div><Switch on={on} onChange={onChange} disabled={disabled} /></div>;
}
void VerdictPill;
