// Dashboard side panels: signal, checklist, key levels, AMD, strategy votes, sessions.
import { useEffect, useState } from "react";
import type { Amd, Decision, KeyLevel, MtfResponse, SessionInfo } from "../types";
import { Card, fmt, hm, Pill, VerdictPill, rfmt } from "./ui";
import { Icon } from "./ui";

const label = (tf: string) => tf.toUpperCase();

export function SignalCard({ d, res }: { d: Decision; res: MtfResponse }) {
  const chk = (id: string) => d.checks.find((c) => c.id === id);
  const bias = chk("bias")?.ok === true;
  const map = bias && chk("pd")?.ok !== false && chk("levels")?.ok !== false;
  const setup = chk("align")?.ok === true && chk("zone")?.ok === true;
  const trig = chk("trigger")?.ok === true && chk("confirm")?.ok !== false;
  const flags = [bias, map, setup, trig];
  const firstOpen = flags.findIndex((f) => !f);
  const fired = d.type === "BUY" || d.type === "SELL";
  const color = fired ? (d.type === "BUY" ? "var(--green)" : "var(--red)") : "var(--gold)";
  const panelBias = (tf: string) => res.panels.find((p) => p.tf === tf)?.bias ?? "neutral";
  const bTone = (b: string) => (b === "bullish" ? "up" : b === "bearish" ? "down" : "muted");
  const names = [`${label(d.bias_tf)} direction`, `${label(d.bias_tf)} map`, `${label(d.setup_tf)} setup`, "Entry trigger"];
  const nowTxt = ["", "STEP 2", "STEP 3", "STEP 4"];
  return (
    <Card title={<>◎ SIGNAL</>} right={<Pill>{d.label} · {label(d.entry_tf)}</Pill>}>
      <div className="sig-head">
        <div className="ring" style={{ ["--p" as string]: d.agreement, ["--c" as string]: color }}><div><div><b>{Math.round(d.agreement)}%</b><br /><small>AGREE</small></div></div></div>
        <div style={{ minWidth: 0 }}>
          <div className="big-state" style={{ color: fired ? color : "var(--text)" }}>
            {fired ? d.type : "WAIT"} <Pill tone={fired ? "gold" : undefined}>Grade {d.grade}</Pill>
          </div>
        </div>
      </div>
      <p style={{ margin: "12px 0 0", lineHeight: 1.45 }}>{d.watch}</p>
      <div className="steps">
        {names.map((n, i) => (
          <div key={n} className={`step ${flags[i] ? "ok" : i === firstOpen ? "now" : ""}`}>
            <b>{flags[i] ? "✓" : i === firstOpen ? `STEP ${i + 1}` : `STEP ${i + 1}`}</b>{n}
          </div>
        ))}
      </div>
      <div className="kv">
        <div><span>{label(d.bias_tf)} bias</span><b className={bTone(panelBias(d.bias_tf))}>{cap(panelBias(d.bias_tf))}</b></div>
        <div><span>{label(d.setup_tf)} bias</span><b className={bTone(panelBias(d.setup_tf))}>{cap(panelBias(d.setup_tf))}</b></div>
        <div><span>Agreement</span><b>{d.agreement.toFixed(1)}% <span className="mute2">(min {res.min_agree}%)</span></b></div>
        <div><span>Price</span><b className="mono">{fmt(res.price)}</b></div>
      </div>
      {d.plan && (
        <div style={{ marginTop: 14 }}>
          <div className="kv">
            <div><span>Entry</span><b className="mono">{fmt(d.plan.entry)}</b></div>
            <div><span>Stop</span><b className="mono down">{fmt(d.plan.sl)}</b></div>
            <div><span>Target</span><b className="mono up">{fmt(d.plan.tp)}</b></div>
            <div><span>Reward : risk</span><b>{d.plan.rr}R · risk {d.plan.risk_pct.toFixed(2)}%</b></div>
          </div>
          {d.plan.ladder && d.plan.ladder.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Liquidity ahead: {d.plan.ladder.map((l) => `${l.label} ${fmt(l.price)} (${l.rr}R)`).join(" → ")}</div>
          )}
        </div>
      )}
      {d.blocked && <div className="blocked">⛔ {d.blocked}</div>}
      {d.approval && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>Approval</span>
          <Pill tone={d.approval.style_ok ? "green" : "red"}>{d.label} {d.approval.style_ok ? "approved" : "not approved"}</Pill>
          <VerdictPill v={d.approval.backtest} />
        </div>
      )}
      <div className="mute2" style={{ fontSize: 11, marginTop: 12 }}>
        {nowTxt[Math.max(0, firstOpen)] && firstOpen > 0 ? `${nowTxt[firstOpen]} next · ` : ""}last closed {label(d.entry_tf)} candle {d.time ? new Date(d.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–"}
      </div>
    </Card>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ChecksCard({ d }: { d: Decision }) {
  return (
    <Card title="Checklist" right={<span className="mute2" style={{ textTransform: "none", letterSpacing: 0 }}>gate = must pass</span>}>
      {d.checks.map((c) => (
        <div key={c.id} className="check">
          <span className={`ic ${c.ok === true ? "ok" : c.ok === false ? "no" : "na"}`}>{c.ok === true ? "✓" : c.ok === false ? "✕" : "–"}</span>
          <div><b style={{ fontWeight: 600 }}>{c.label}</b>{c.gate && <span className="gate-tag">GATE</span>}<small>{c.detail}</small></div>
          <span className="mute2" style={{ fontSize: 11 }}>{c.weight}</span>
        </div>
      ))}
    </Card>
  );
}

const GROUP_TONE: Record<string, string> = { daily: "gold", weekly: "blue", monthly: "purple", session: "green", open: "", vwap: "gold", round: "" };
export function LevelsCard({ levels, price }: { levels: KeyLevel[]; price: number }) {
  const list = levels.filter((l) => l.group !== "round").sort((a, b) => b.price - a.price);
  const above = list.filter((l) => l.price >= price), below = list.filter((l) => l.price < price);
  const row = (l: KeyLevel) => (
    <div className="lvl-row" key={l.id} style={{ opacity: l.swept ? 0.45 : 1 }}>
      <span><Pill tone={GROUP_TONE[l.group] as never}>{l.label}</Pill>{l.swept && <span className="mute2"> swept</span>}</span>
      <span className="mono">{fmt(l.price)} <span className="mute2" style={{ fontSize: 11 }}>{(((l.price - price) / price) * 100).toFixed(2)}%</span></span>
    </div>
  );
  return (
    <Card title="Key levels" right={<span className="mute2" style={{ textTransform: "none", letterSpacing: 0 }}>swept = spent liquidity</span>}>
      {list.length === 0 && <div className="empty">No levels yet</div>}
      {above.map(row)}
      <div className="lvl-row" style={{ color: "var(--gold)", fontWeight: 700 }}><span>● Price</span><span className="mono">{fmt(price)}</span></div>
      {below.map(row)}
    </Card>
  );
}

const PH_TONE: Record<string, "purple" | "gold" | "green" | undefined> = { ACCUMULATION: "gold", MANIPULATION: "purple", DISTRIBUTION: "green", NONE: undefined };
export function AmdCard({ d }: { d: Decision }) {
  const rows: [string, Amd | null | undefined][] = [["Daily cycle (Asia → London/NY)", d.amd?.session], [`${label(d.entry_tf)} entry TF`, d.amd?.entry], [`${label(d.setup_tf)} setup TF`, d.amd?.setup]];
  const amdCheck = d.checks.find((c) => c.id === "amd");
  return (
    <Card title="AMD · power of 3" right={amdCheck && <Pill tone={amdCheck.ok ? "green" : amdCheck.ok === false ? "red" : undefined}>{amdCheck.ok ? "aligned" : amdCheck.ok === false ? "against trade" : "no read"}</Pill>}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <Pill tone="gold">A · accumulate</Pill>→<Pill tone="purple">M · manipulate</Pill>→<Pill tone="green">D · distribute</Pill>
      </div>
      {rows.map(([name, a]) => (
        <div key={name} className="lvl-row" style={{ display: "block" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted" style={{ fontSize: 12 }}>{name}</span>
            <Pill tone={PH_TONE[a?.phase ?? "NONE"]}>{a?.phase && a.phase !== "NONE" ? `${a.phase.toLowerCase()}${a.direction ? ` · ${a.direction}` : ""}` : "none"}</Pill>
          </div>
          {a && a.phase !== "NONE" && <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{a.text}</div>}
        </div>
      ))}
    </Card>
  );
}

export function VotesCard({ d }: { d: Decision }) {
  const c = d.confirmations;
  return (
    <Card title="Approved strategies" right={c && <Pill tone={c.net > 0 ? "green" : c.net < 0 ? "red" : undefined}>{c.supports} for · {c.opposes} against</Pill>}>
      {!c && <div className="empty">No confirmation strategy is approved — enable some on the Strategies page.</div>}
      {c?.votes.map((v) => (
        <div key={v.name} className="check">
          <span className={`ic ${v.vote === "support" ? "ok" : v.vote === "oppose" ? "no" : "na"}`}>{v.vote === "support" ? "✓" : v.vote === "oppose" ? "✕" : "–"}</span>
          <div><b style={{ fontWeight: 600 }}>{v.name}</b><small>{v.detail}</small></div><span />
        </div>
      ))}
    </Card>
  );
}

export function SessionsCard({ sessions }: { sessions: SessionInfo[] }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const local = (h: number) => { const d = new Date(); d.setUTCHours(Math.floor(h), (h % 1) * 60, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
  const nowOut = !sessions.some((s) => s.open && s.kill_zone);
  return (
    <Card title={<><span style={{ width: 16, height: 16, display: "inline-block" }}>{Icon.clock}</span> SESSIONS</>}
      right={nowOut ? <Pill tone="red">Outside London/NY</Pill> : <Pill tone="green">Kill zone live</Pill>}>
      {sessions.map((s) => (
        <div className="sess" key={s.name}>
          <span className={`d ${s.open ? "open" : ""}`} />
          <div style={{ flex: 1 }}>
            <b>{s.name}</b> {s.kill_zone && <Pill tone="gold">SIGNALS</Pill>}
            <div className="mute2" style={{ fontSize: 12 }}>{local(s.start_utc)}–{local(s.end_utc)} your time</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <b className={s.open ? "up" : "muted"}>{s.open ? "OPEN" : "CLOSED"}</b>
            <div className="mute2" style={{ fontSize: 12 }}>{s.open ? "closes" : "opens"} in {hm(s.changes_in_s)}</div>
          </div>
        </div>
      ))}
      <div className="mute2" style={{ fontSize: 11, marginTop: 6 }}>Crypto trades 24/7; sessions are UTC windows. Weekend liquidity is thinner.</div>
    </Card>
  );
}

export { rfmt };
