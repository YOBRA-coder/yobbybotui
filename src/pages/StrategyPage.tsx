// pages/StrategyPage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PageProps } from "./shared";
import type { Strategy, BacktestResult } from "../types";
import { PAIR_DISPLAY, PAIRS, TIMEFRAMES, TIMEFRAME_LABEL } from "../types";
import { strategiesApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { S } from "./styles";

const PRESETS = ["RSI Scalper", "EMA Cross", "MACD Divergence", "Bollinger Squeeze", "Grid Trading", "Smart Money Concepts"];

// Plain-language description of each preset's actual entry/exit rule —
// "list system strategy as execution logic" meant the create form and
// detail view should say what a strategy DOES, not just its name. These
// match the real logic in backend/app/services/backtest.py exactly, and
// the tunable numbers here are the defaults seeded into every new
// strategy's Parameters panel (editable afterward — see below).
const PRESET_INFO: Record<string, string> = {
  "RSI Scalper": "Buys when RSI drops below the oversold threshold (default 30), exits when RSI recovers above the exit threshold (default 55) or price drops past the stop.",
  "EMA Cross": "Buys when the fast EMA (default 12) crosses above the slow EMA (default 26), exits on the cross back below.",
  "MACD Divergence": "Buys when the MACD line crosses above its signal line, exits on the cross back below or the stop.",
  "Bollinger Squeeze": "Buys when price closes below the lower Bollinger band, exits at the middle band.",
  "Grid Trading": "Buys when price drops a set % (default 1.5%) below its 20-period average, sells when it recovers the same % above it.",
  "Smart Money Concepts": "Buys when price wicks below a recent confirmed swing low and closes back above it (a liquidity sweep/stop hunt) while market structure isn't in a confirmed downtrend, exits at target/stop.",
};

export default function StrategyPage({ strategies, setStrategies, notify }: PageProps) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sel, setSel] = useState<Strategy | null>(null);
  const [bt, setBt] = useState(false);
  const [br, setBr] = useState<BacktestResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", execution: PRESETS[0], pair: "BTCUSDT", timeframe: "15m" });
  const [creating, setCreating] = useState(false);

  const parseParams = (s: Strategy): Record<string, number> => {
    if (typeof s.parameters === "string") {
      try { return JSON.parse(s.parameters); } catch { return {}; }
    }
    return s.parameters as Record<string, number>;
  };

  const createStrategy = async () => {
    if (!auth.token || !form.name.trim()) return;
    setCreating(true);
    try {
      const created = await strategiesApi.create(auth.token, form);
      setStrategies(prev => [created, ...prev]);
      setSel(created);
      setShowCreate(false);
      setForm({ name: "", description: "", execution: PRESETS[0], pair: "BTCUSDT", timeframe: "15m" });
      notify(`Strategy "${created.name}" created`, "success");
    } catch (e: any) { notify(e.message, "error"); }
    setCreating(false);
  };

  const runBacktest = async () => {
    if (!sel || !auth.token) return;
    setBt(true); setBr(null);
    try {
      const result = await strategiesApi.backtest(auth.token, sel.id);
      const span = result.candleCount ? `${result.candleCount} × ${result.timeframe || sel.timeframe || "15m"} candles` : "the available history";
      notify(`Strategy "${sel.name}" finished backtesting — ${result.trades} trades over ${span} of ${result.pair || sel.pair}`, "success");
      setBr(result);
      // Backtest also updates win_rate/total_trades/etc. on the strategy row server-side — reflect that in the sidebar.
      setStrategies(prev => prev.map(s => s.id === sel.id
        ? { ...s, win_rate: result.winRate, total_trades: result.trades, max_drawdown: result.maxDrawdown }
        : s));
    } catch (e: any) { notify(e.message, "error"); }
    setBt(false);
  };

  const updateParam = async (k: string, v: number) => {
    if (!sel || !auth.token) return;
    const params = { ...parseParams(sel), [k]: v };
    const updated = { ...sel, parameters: params };
    setSel(updated);
    try {
      const result = await strategiesApi.update(auth.token, sel.id, { parameters: params });
      setStrategies(prev => prev.map(s => s.id === sel.id ? result : s));
    } catch {}
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "270px 1fr", gap: 12, animation: "fadeUp .3s ease" }}>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.ch}>Strategies</div>
          <button style={{ ...S.btnO, padding: "4px 10px", fontSize: 10 }} onClick={() => setShowCreate(s => !s)}>
            {showCreate ? "✕" : "+ New"}
          </button>
        </div>

        {showCreate && (
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <input style={S.inp} placeholder="Strategy name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <textarea style={{ ...S.inp, minHeight: 50, resize: "vertical" }} placeholder="Description — what is this strategy trying to do?"
              value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            <div>
              <label style={S.lbl}>Execution logic</label>
              <select style={S.inp} value={form.execution} onChange={e => setForm(p => ({ ...p, execution: e.target.value }))}>
                {PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div style={{ color: "var(--text-dim)", fontSize: 10, marginTop: 4, lineHeight: 1.5 }}>{PRESET_INFO[form.execution]}</div>
            </div>
            <div>
              <label style={S.lbl}>Pair to backtest against</label>
              <select style={S.inp} value={form.pair} onChange={e => setForm(p => ({ ...p, pair: e.target.value }))}>
                {PAIRS.map(p => <option key={p} value={p}>{PAIR_DISPLAY[p]}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl} title="This is also the timeframe a live bot running this strategy will evaluate on — keep backtest and live consistent.">Timeframe</label>
              <select style={S.inp} value={form.timeframe} onChange={e => setForm(p => ({ ...p, timeframe: e.target.value }))}>
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{TIMEFRAME_LABEL[tf]}</option>)}
              </select>
            </div>
            <button style={S.btn} onClick={createStrategy} disabled={creating || !form.name.trim()}>
              {creating ? "Creating..." : "Create Strategy"}
            </button>
          </div>
        )}

        {strategies.map(s => (
          <div key={s.id} style={{ padding: "10px", borderRadius: 7, cursor: "pointer", marginBottom: 3, border: `1px solid ${sel?.id === s.id ? "#00d084" : "transparent"}`, background: sel?.id === s.id ? "var(--border2)" : "transparent" }} onClick={() => { setSel(s); setBr(null); }}>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 12 }}>{s.name}</div>
            <div style={{ color: "var(--text-mute)", fontSize: 9, marginTop: 2 }}>{s.win_rate?.toFixed(1) ?? 0}% win • {s.total_trades} trades • {PAIR_DISPLAY[s.pair] || s.pair}</div>
          </div>
        ))}
        {strategies.length === 0 && !showCreate && <div style={{ color: "var(--text-mute)", fontSize: 11, padding: 12, textAlign: "center" }}>No strategies yet — click "+ New" to add one</div>}
      </div>

      {sel ? (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div>
              <div style={{ color: "var(--text)", fontWeight: 800, fontSize: 18 }}>{sel.name}</div>
              <div style={{ color: "var(--text-dim)", fontSize: 10, marginTop: 2 }}>{sel.execution} • {PAIR_DISPLAY[sel.pair] || sel.pair} • {sel.timeframe || "15m"} candles</div>
            </div>
            <button style={{ ...S.btn, width: "auto", padding: "8px 16px" }} onClick={runBacktest} disabled={bt}>{bt ? "⏳ Backtesting..." : "▶ Run Backtest"}</button>
          </div>
          {PRESET_INFO[sel.execution] && (
            <div style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 10, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 11px", lineHeight: 1.55 }}>
              <span style={{ color: "var(--text-mute)", fontWeight: 700, fontSize: 9, letterSpacing: 1 }}>RULE — </span>{PRESET_INFO[sel.execution]}
            </div>
          )}
          <p style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 18, lineHeight: 1.6 }}>{sel.description || "No description provided."}</p>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
            {[{ l: "Win Rate", v: `${(sel.win_rate ?? 0).toFixed(1)}%`, c: "#00d084" }, { l: "Profit Factor", v: (sel.profit_factor ?? 0).toFixed(2), c: "#0094ff" },
              { l: "Max DD", v: `${(sel.max_drawdown ?? 0).toFixed(1)}%`, c: "#ff4757" }, { l: "Trades", v: (sel.total_trades ?? 0).toString(), c: "#ffd700" }].map(m => (
              <div key={m.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 9, padding: 13 }}>
                <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{m.l}</div>
                <div style={{ color: m.c, fontSize: 20, fontWeight: 800, marginTop: 5 }}>{m.v}</div>
              </div>
            ))}
          </div>
          {Object.keys(parseParams(sel)).length > 0 && (
            <>
              <div style={S.ch}>Parameters</div>
              <div style={{ color: "var(--text-mute)", fontSize: 10, marginTop: -6, marginBottom: 9 }}>
                Tune these and re-run the backtest — this is what makes this strategy genuinely different from another one built on the same rule.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 9, marginBottom: 18 }}>
                {Object.entries(parseParams(sel)).map(([k, v]) => (
                  <div key={k} style={S.fg}>
                    <label style={S.lbl}>{k.replace(/([A-Z])/g, " $1").trim()}</label>
                    <input style={S.inp} type="number" value={v} onChange={e => updateParam(k, parseFloat(e.target.value) || 0)} />
                  </div>
                ))}
              </div>
            </>
          )}
          {br && (
            <div style={{ background: "var(--bg2)", border: "1px solid #00d08433", borderRadius: 9, padding: 14 }}>
              <div style={{ color: "#00d084", fontSize: 9, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>BACKTEST RESULTS</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr) repeat(2,1fr)", gap: 9, marginBottom: 14 }}>
                {[{ l: "Net Profit ($1K start)", v: `${br.profit >= 0 ? "+" : ""}$${br.profit.toFixed(2)}`, c: br.profit >= 0 ? "#00d084" : "#ff4757" },
                  { l: "Trades", v: br.trades.toString(), c: "var(--text)" },
                  { l: "Win Rate", v: `${br.winRate.toFixed(1)}%`, c: "#0094ff" },
                  { l: "Sharpe", v: br.sharpeRatio.toFixed(2), c: "#ffd700" },
                  { l: "Max DD", v: `${br.maxDrawdown.toFixed(1)}%`, c: "#ff4757" }].map(m => (
                  <div key={m.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: 11 }}>
                    <div style={{ color: "var(--text-mute)", fontSize: 9 }}>{m.l}</div>
                    <div style={{ color: m.c, fontSize: 18, fontWeight: 800, marginTop: 3 }}>{m.v}</div>
                  </div>
                ))}
              </div>

              {br.tradeLog && br.tradeLog.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 11 }}>
                  <thead style={{ color: "var(--text-dim)" }}>
                    <tr>
                      <th style={{ textAlign: "left" }}>Side</th>
                      <th style={{ textAlign: "left" }}>Entry</th>
                      <th style={{ textAlign: "left" }}>Exit</th>
                      <th style={{ textAlign: "left" }}>PnL %</th>
                      <th style={{ textAlign: "left" }}>Result</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {br.tradeLog.map((t, i) => (
                      <tr key={i}>
                        <td style={{ color: t.side === "BUY" ? "#00d084" : "#ff4757", padding: "5px 0" }}>{t.side}</td>
                        <td>{t.entry_price.toFixed(4)}</td>
                        <td>{t.exit_price.toFixed(4)}</td>
                        <td style={{ color: t.pnl_pct >= 0 ? "#00d084" : "#ff4757" }}>{t.pnl_pct.toFixed(2)}%</td>
                        <td>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                            background: t.result === "WIN" ? "#00d08418" : "#ff475718",
                            color: t.result === "WIN" ? "#00d084" : "#ff4757",
                          }}>{t.result}</span>
                        </td>
                        <td>
                          <button style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--surface)", border: "1px solid var(--border2)", color: "#0094ff" }}
                            onClick={() => navigate(`/trading?pair=${br.pair || sel.pair}`, { state: { backtestTrade: t } })}>
                            View Chart
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              {br.tradeLog && br.tradeLog.length === 0 && (
                <div style={{ color: "var(--text-mute)", fontSize: 11 }}>No trades triggered by this strategy's rules over the tested period.</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-mute)", padding: 60 }}>
          <div style={{ fontSize: 48 }}>◇</div>
          <div style={{ color: "var(--text-mute)", marginTop: 10, fontWeight: 600, fontSize: 13 }}>Select or create a strategy</div>
        </div>
      )}
    </div>
  );
}
