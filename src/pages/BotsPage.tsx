// pages/BotsPage.tsx
import { useEffect, useState } from "react";
import type { PageProps } from "./shared";
import { PAIR_DISPLAY, PAIRS, TIMEFRAMES, TIMEFRAME_LABEL } from "../types";
import { botsApi, accountApi, strategiesApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { S } from "./styles";
import { useNavigate } from "react-router-dom";

const PRESET_STRATEGIES = ["RSI Scalper", "EMA Cross", "Grid Trading", "MACD Divergence", "Bollinger Squeeze", "Smart Money Concepts"];

// "CONFLUENCE" is an internal marker, not something to show the user
// as-is — render it as what it actually means instead.
const strategyLabel = (bot: { strategy: string; confluence_strategies?: string[] | null }) =>
  bot.strategy === "CONFLUENCE" && bot.confluence_strategies?.length
    ? `Confluence (${bot.confluence_strategies.join(" + ")})`
    : bot.strategy;

export default function BotsPage({ bots, setBots, tickers, trades, notify }: PageProps) {
  const { auth } = useAuth();
  const navigation =  useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: "", pair: "BTCUSDT", strategy: "RSI Scalper", capital: "1000", mode: "DEMO" as "DEMO" | "LIVE",
    maxHoldMinutes: "",
    // "add extra config/settings to ensure ultimate bot and profit" — these
    // used to be one hardcoded global shared by every bot; now each bot
    // picks its own.
    timeframe: "15m", confidenceThreshold: "65", cooldownMinutes: "0", autoPauseAfterLosses: "4",
    // "stop after how many trades" — lifetime trade-count cap, separate
    // from the loss-streak circuit breaker above.
    maxTrades: "",
    maxOpenPositions: "1",
  });
  // "can i create a bot that confirms from all or selected strategies" —
  // Confluence mode: bot evaluates every checked strategy each cycle and
  // only enters once `confluenceMinAgree` of them agree in the same
  // cycle. Kept as separate state from `form` since it only applies when
  // confluenceMode is on and has its own multi-select shape.
  const [confluenceMode, setConfluenceMode] = useState(false);
  const [confluenceSelected, setConfluenceSelected] = useState<string[]>([]);
  const [confluenceMinAgree, setConfluenceMinAgree] = useState("");
  const toggleConfluenceStrategy = (name: string) => {
    setConfluenceSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    setConfluenceBacktestResult(null); // stale once the combo changes
  };
  // "which strategy is the best" — lets a combo be checked against real
  // history before actually creating (and funding) the bot.
  const [confluenceBacktesting, setConfluenceBacktesting] = useState(false);
  const [confluenceBacktestResult, setConfluenceBacktestResult] = useState<Awaited<ReturnType<typeof botsApi.confluenceBacktest>> | null>(null);
  const runConfluenceBacktest = async () => {
    if (!auth.token || confluenceSelected.length < 2) { notify("Pick at least 2 strategies first", "error"); return; }
    setConfluenceBacktesting(true);
    setConfluenceBacktestResult(null);
    try {
      const result = await botsApi.confluenceBacktest(auth.token, {
        pair: form.pair, timeframe: form.timeframe,
        confluence_strategies: confluenceSelected,
        confluence_min_agree: confluenceMinAgree ? parseInt(confluenceMinAgree, 10) : undefined,
      });
      setConfluenceBacktestResult(result);
    } catch (e: any) { notify(e.message, "error"); }
    setConfluenceBacktesting(false);
  };
  const [brokerConnected, setBrokerConnected] = useState(false);
  // BUG FIX: this dropdown was hardcoded to the 5 built-in presets only —
  // there was no way to ever select a strategy you'd built yourself on the
  // Strategy page, even though the backend has always accepted any
  // strategy name/id here. Now pulls the user's own strategies in too, so
  // "add own strategy and add a bot to run" actually connects end to end.
  const [customStrategies, setCustomStrategies] = useState<string[]>([]);
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  // Inline per-bot max-hold-time editing — previously the only way to set
  // this was at creation time, so an existing bot's hold time couldn't be
  // tuned individually without deleting and recreating it.
  const [editingHold, setEditingHold] = useState<string | null>(null);
  const [holdValue, setHoldValue] = useState("");

  useEffect(() => {
    if (!auth.token) return;
    accountApi.summary(auth.token).then(s => setBrokerConnected(s.broker_connected)).catch(() => {});
    strategiesApi.list(auth.token).then(list => setCustomStrategies(list.map(s => s.name))).catch(() => {});
  }, [auth.token]);

  // A backtest result belongs to the pair/timeframe it was run against —
  // clear it once either changes so a stale result can't be misread as
  // still describing the current selection.
  useEffect(() => { setConfluenceBacktestResult(null); }, [form.pair, form.timeframe]);

  const customOnly = customStrategies.filter(n => !PRESET_STRATEGIES.includes(n));

  // Same fix as Dashboard: bot.profit only reflects realized (closed)
  // trades — a bot with an open position showed stale/zero P&L until it
  // actually closed. Add the open position's mark-to-market P&L.
  const unrealizedPnl = (botId: string): number => {
    const open = trades.find(t => t.bot_id === botId && t.status === "FILLED");
    if (!open) return 0;
    const ticker = tickers.find(t => t.symbol === open.pair);
    if (!ticker) return 0;
    return open.side === "BUY"
      ? (ticker.price - open.price) * open.amount
      : (open.price - ticker.price) * open.amount;
  };
  const displayProfit = (bot: typeof bots[0]) => bot.profit + unrealizedPnl(bot.id);

  const toggle = async (id: string, current: string) => {
    if (!auth.token) return;
    const newStatus = current === "RUNNING" ? "STOPPED" : "RUNNING";
    try {
      const updated = await botsApi.update(auth.token, id, { status: newStatus });
      setBots(prev => prev.map(b => b.id === id ? updated : b));
      notify(`Bot ${newStatus.toLowerCase()}`, "success");
    } catch (e: any) { notify(e.message, "error"); }
  };

  const create = async () => {
    if (!auth.token || !form.name) { notify("Bot name required", "error"); return; }
    if (confluenceMode && confluenceSelected.length < 2) {
      notify("Pick at least 2 strategies for Confluence mode", "error");
      return;
    }
    try {
      const bot = await botsApi.create(auth.token, {
        name: form.name, pair: form.pair, strategy: confluenceMode ? "CONFLUENCE" : form.strategy,
        capital: parseFloat(form.capital) || 1000, mode: form.mode,
        max_hold_minutes: form.maxHoldMinutes ? parseInt(form.maxHoldMinutes, 10) : undefined,
        timeframe: form.timeframe,
        confidence_threshold: parseFloat(form.confidenceThreshold) || 65,
        cooldown_minutes: parseInt(form.cooldownMinutes, 10) || 0,
        auto_pause_after_losses: form.autoPauseAfterLosses !== "" ? parseInt(form.autoPauseAfterLosses, 10) : 4,
        max_trades: form.maxTrades ? parseInt(form.maxTrades, 10) : undefined,
        max_open_positions: parseInt(form.maxOpenPositions, 10) || 1,
        confluence_strategies: confluenceMode ? confluenceSelected : undefined,
        confluence_min_agree: confluenceMode && confluenceMinAgree ? parseInt(confluenceMinAgree, 10) : undefined,
      });
      setBots(prev => [...prev, bot]);
      setShowNew(false);
      setForm({ name: "", pair: "BTCUSDT", strategy: "RSI Scalper", capital: "1000", mode: "DEMO", maxHoldMinutes: "", timeframe: "15m", confidenceThreshold: "65", cooldownMinutes: "0", autoPauseAfterLosses: "4", maxTrades: "", maxOpenPositions: "1" });
      setConfluenceMode(false); setConfluenceSelected([]); setConfluenceMinAgree(""); setConfluenceBacktestResult(null);
      notify(`Bot "${bot.name}" launched${form.mode === "LIVE" ? " — LIVE trading" : ""}!`, "success");
    } catch (e: any) { notify(e.message, "error"); }
  };

  const remove = async (id: string, name: string) => {
    if (!auth.token || !confirm(`Remove bot "${name}"?`)) return;
    try {
      await botsApi.delete(auth.token, id);
      setBots(prev => prev.filter(b => b.id !== id));
      notify("Bot removed", "info");
    } catch (e: any) { notify(e.message, "error"); }
  };

  const saveHold = async (id: string) => {
    if (!auth.token) return;
    try {
      const updated = await botsApi.update(auth.token, id, { max_hold_minutes: holdValue ? parseInt(holdValue, 10) : 0 });
      setBots(prev => prev.map(b => b.id === id ? updated : b));
      setEditingHold(null);
      notify("Max hold time updated", "success");
    } catch (e: any) { notify(e.message, "error"); }
  };

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 13, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ l: "Running", c: "#00d084", n: bots.filter(b => b.status === "RUNNING").length },
            { l: "Paused", c: "#ffd700", n: bots.filter(b => b.status === "PAUSED").length },
            { l: "Stopped", c: "var(--text-mute)", n: bots.filter(b => b.status === "STOPPED").length }].map(s => (
            <div key={s.l} style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 11px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.c }} />
              <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 12 }}>{s.n}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{s.l}</span>
            </div>
          ))}
        </div>
        <button style={{ ...S.btn, width: "auto", padding: "9px 16px" }} onClick={() => setShowNew(x => !x)}>+ New Bot</button>
      </div>

      {showNew && (
        <div style={{ ...S.card, marginBottom: 13, border: "1px solid #00d08444" }}>
          <div style={S.ch}>Create Bot</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 9, alignItems: "end" }}>
            {[{ k: "name" as const, l: "Bot Name", t: "text", ph: "Alpha Scalper" },
              { k: "capital" as const, l: "Capital (USDT)", t: "number", ph: "1000" }].map(f2 => (
              <div key={f2.k} style={S.fg}><label style={S.lbl}>{f2.l}</label><input style={S.inp} type={f2.t} value={form[f2.k]} onChange={f(f2.k)} placeholder={f2.ph} /></div>
            ))}
            <div style={S.fg}>
              <label style={S.lbl}>Pair</label>
              <select style={S.inp} value={form.pair} onChange={f("pair")}>{PAIRS.map(p => <option key={p} value={p}>{PAIR_DISPLAY[p]}</option>)}</select>
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Strategy</label>
              <select style={S.inp} value={form.strategy} onChange={f("strategy")} disabled={confluenceMode}>
                <optgroup label="Built-in presets">
                  {PRESET_STRATEGIES.map(s => <option key={s}>{s}</option>)}
                </optgroup>
                {customOnly.length > 0 && (
                  <optgroup label="Your strategies">
                    {customOnly.map(s => <option key={s}>{s}</option>)}
                  </optgroup>
                )}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11, color: "var(--text-dim)", cursor: "pointer" }}>
                <input type="checkbox" checked={confluenceMode} onChange={e => { setConfluenceMode(e.target.checked); setConfluenceBacktestResult(null); }} />
                Confluence mode — confirm from multiple strategies instead of one
              </label>
              {confluenceMode && (
                <div style={{ marginTop: 8, padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
                    {PRESET_STRATEGIES.map(s => (
                      <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer" }}>
                        <input type="checkbox" checked={confluenceSelected.includes(s)} onChange={() => toggleConfluenceStrategy(s)} />
                        {s}
                      </label>
                    ))}
                  </div>
                  <label style={{ ...S.lbl, fontSize: 10 }} title="How many of the strategies you checked must independently agree in the same cycle before the bot enters. Leave blank to require ALL of them (fewer, higher-conviction trades). Set to 1 for 'any of these' — trades more often since it enters the moment a single one fires.">
                    Min. strategies required to agree
                  </label>
                  <input
                    style={{ ...S.inp, maxWidth: 140 }}
                    type="number" min={1} max={Math.max(confluenceSelected.length, 1)}
                    value={confluenceMinAgree}
                    onChange={e => { setConfluenceMinAgree(e.target.value); setConfluenceBacktestResult(null); }}
                    placeholder={confluenceSelected.length ? `All ${confluenceSelected.length}` : "All selected"}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button" style={{ ...S.btn, width: "auto", padding: "7px 14px", fontSize: 11 }}
                      onClick={runConfluenceBacktest} disabled={confluenceBacktesting || confluenceSelected.length < 2}
                    >
                      {confluenceBacktesting ? "Backtesting…" : "Backtest this combo"}
                    </button>
                    <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-mute)" }}>
                      Checks this combo against real {form.pair} history on {TIMEFRAME_LABEL[form.timeframe as keyof typeof TIMEFRAME_LABEL] || form.timeframe} before you commit capital to it.
                    </span>
                  </div>
                  {confluenceBacktestResult && (
                    <div style={{ marginTop: 10, padding: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 11 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                        <span>Trades: <b>{confluenceBacktestResult.trades}</b></span>
                        <span>Win rate: <b style={{ color: confluenceBacktestResult.winRate >= 50 ? "#2ed573" : "#ff4757" }}>{confluenceBacktestResult.winRate.toFixed(1)}%</b></span>
                        <span>Profit (on $1000): <b style={{ color: confluenceBacktestResult.profit >= 0 ? "#2ed573" : "#ff4757" }}>${confluenceBacktestResult.profit.toFixed(2)}</b></span>
                        <span>Max drawdown: <b>{confluenceBacktestResult.maxDrawdown.toFixed(1)}%</b></span>
                        <span>Sharpe: <b>{confluenceBacktestResult.sharpeRatio.toFixed(2)}</b></span>
                      </div>
                      <div style={{ marginTop: 4, color: "var(--text-mute)" }}>
                        {confluenceBacktestResult.candleCount} candles tested • requires {confluenceBacktestResult.requiredAgree}/{confluenceSelected.length} to agree
                        {confluenceBacktestResult.trades === 0 && " — no matching setups in this window; try a looser min-agree, a different pair, or a wider timeframe"}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Max Hold Time (min)</label>
              <input style={S.inp} type="number" min={0} value={form.maxHoldMinutes} onChange={f("maxHoldMinutes")} placeholder="No limit" />
            </div>
            <div style={S.fg}>
              <label style={S.lbl} title="How often this bot's market read updates. Shorter = more trade opportunities but noisier; longer = smoother but slower to react.">Signal Timeframe</label>
              <select style={S.inp} value={form.timeframe} onChange={f("timeframe")}>
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{TIMEFRAME_LABEL[tf]}</option>)}
              </select>
            </div>
            <div style={S.fg}>
              <label style={S.lbl} title="Minimum confidence score (0-95) required before this bot will enter a trade.">Min Confidence %</label>
              <input style={S.inp} type="number" min={50} max={95} value={form.confidenceThreshold} onChange={f("confidenceThreshold")} placeholder="65" />
            </div>
            <div style={S.fg}>
              <label style={S.lbl} title="Minimum minutes between this bot's trades, even if a fresh high-confidence signal appears sooner.">Cooldown (min)</label>
              <input style={S.inp} type="number" min={0} value={form.cooldownMinutes} onChange={f("cooldownMinutes")} placeholder="0 = none" />
            </div>
            <div style={S.fg}>
              <label style={S.lbl} title="Auto-pauses this bot after this many losing trades in a row, so it stops trading into conditions its strategy isn't handling well instead of grinding through the whole streak. 0 disables it.">Pause After N Losses</label>
              <input style={S.inp} type="number" min={0} value={form.autoPauseAfterLosses} onChange={f("autoPauseAfterLosses")} placeholder="4 (0 = never)" />
            </div>
            <div style={S.fg}>
              <label style={S.lbl} title="Auto-pauses this bot once its total trade count reaches this number, regardless of performance — a session/plan limit rather than a performance reaction. Leave blank for no limit.">Stop After N Trades</label>
              <input style={S.inp} type="number" min={0} value={form.maxTrades} onChange={f("maxTrades")} placeholder="No limit" />
            </div>
            <div style={S.fg}>
              <label style={S.lbl} title="How many positions this bot may hold at the same time. Previously every bot was hard-limited to one, so its trade count over a week was really just a function of how long its average trade stayed open rather than how many setups its strategy found. Each position draws from the same capital pool, so raising this splits capital across trades rather than multiplying your exposure.">Concurrent Positions</label>
              <input style={S.inp} type="number" min={1} max={10} value={form.maxOpenPositions} onChange={f("maxOpenPositions")} placeholder="1" />
            </div>
            <div style={S.fg}>
              <label style={S.lbl}>Mode</label>
              <select style={S.inp} value={form.mode} onChange={f("mode")} disabled={!brokerConnected}>
                <option value="DEMO">Demo (virtual funds)</option>
                {brokerConnected && <option value="LIVE">Live (real Binance account)</option>}
              </select>
              {!brokerConnected && (
                <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 3 }}>Connect Binance in Settings to unlock Live mode</div>
              )}
            </div>
            <button style={{ ...S.btn, width: "auto", padding: "9px 18px" }} onClick={create}>Launch Bot</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 11 }}>
        {bots.map(bot => {
          const t = tickers.find(t => t.symbol === bot.pair);
          // "highlight the bot with diff colors if buy or sell" — beyond the
          // small badge below, the whole card now glows green/red when this
          // bot's current market read is actionable, so a scan down the
          // grid immediately shows which bots are sitting on a live
          // opportunity vs quietly holding.
          const highlightColor = bot.market_signal === "BUY" ? "#00d084" : bot.market_signal === "SELL" ? "#ff4757" : null;
          return (
            <div
              key={bot.id}
              style={{
                background: "var(--surface)",
                border: `1px solid ${highlightColor ? highlightColor + "77" : "var(--border)"}`,
                boxShadow: highlightColor ? `0 0 0 1px ${highlightColor}22, 0 0 16px ${highlightColor}22` : "none",
                borderRadius: 12, padding: 15, cursor: "pointer",
              }}
              onClick={() => navigation(`/bot/${bot.id}`)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
                <div>
                  <div style={{ color: "var(--text)", fontWeight: 800, fontSize: 14 }}>{bot.name}</div>
                  <div style={{ color: "var(--text-mute)", fontSize: 10, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                    <span>{PAIR_DISPLAY[bot.pair] || bot.pair} • {strategyLabel(bot)}</span>
                    {editingHold === bot.id ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }} onClick={e => e.stopPropagation()}>
                        <input
                          type="number" min={0} autoFocus value={holdValue}
                          onChange={e => setHoldValue(e.target.value)}
                          placeholder="No limit"
                          style={{ width: 60, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontSize: 10, padding: "2px 5px", fontFamily: "inherit" }}
                        />
                        <span style={{ color: "#00d084", cursor: "pointer", fontSize: 11 }} onClick={() => saveHold(bot.id)}>✓</span>
                        <span style={{ color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }} onClick={() => setEditingHold(null)}>✕</span>
                      </span>
                    ) : (
                      <span
                        style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                        onClick={e => { e.stopPropagation(); setEditingHold(bot.id); setHoldValue(bot.max_hold_minutes ? String(bot.max_hold_minutes) : ""); }}
                        title="Click to set this bot's own max hold time"
                      >
                        {bot.max_hold_minutes ? `• max ${bot.max_hold_minutes}m` : "• set max hold"}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                  {bot.mode === "LIVE" && (
                    <span style={{ background: "#ff475718", border: "1px solid #ff4757", color: "#ff4757", fontSize: 8, padding: "2px 5px", borderRadius: 3, fontWeight: 700 }}>LIVE</span>
                  )}
                  {bot.current_position && (
                    <span style={{
                  background: bot.current_position === "LONG" ? "#00d08418" : bot.current_position === "SHORT" ? "#ff475718" : "#ffd70018",
                  border: `1px solid ${bot.current_position === "LONG" ? "#00d084" : bot.current_position === "SHORT" ? "#ff4757" : "#ffd700"}`,
                  color: bot.current_position === "LONG" ? "#00d084" : bot.current_position === "SHORT" ? "#ff4757" : "#ffd700",
                  fontSize: 8, padding: "2px 5px", borderRadius: 3, fontWeight: 700,
                }}>{bot.current_position}</span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 3, background: bot.status === "RUNNING" ? "#00d08418" : bot.status === "PAUSED" ? "#ffd70018" : "#2e406018", border: `1px solid ${bot.status === "RUNNING" ? "#00d08444" : bot.status === "PAUSED" ? "#ffd70044" : "#2e406044"}`, borderRadius: 20, padding: "2px 7px" }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: bot.status === "RUNNING" ? "#00d084" : bot.status === "PAUSED" ? "#ffd700" : "var(--text-mute)" }} />
                    <span style={{ color: bot.status === "RUNNING" ? "#00d084" : bot.status === "PAUSED" ? "#ffd700" : "var(--text-mute)", fontSize: 8, fontWeight: 700 }}>{bot.status}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5, marginBottom: 11 }}>
                {[{ l: "P&L", v: `${displayProfit(bot) >= 0 ? "+" : ""}$${displayProfit(bot).toFixed(2)}`, c: displayProfit(bot) >= 0 ? "#00d084" : "#ff4757" },
                  { l: "WIN %", v: `${(bot.win_rate || 0).toFixed(1)}%`, c: "var(--text)" },
                  { l: "TRADES", v: bot.trades.toString(), c: "var(--text)" },
                  { l: "CAPITAL", v: `$${bot.capital >= 1000 ? (bot.capital / 1000).toFixed(1) + "K" : bot.capital}`, c: "var(--text)" }].map(m => (
                  <div key={m.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 7px", textAlign: "center" }}>
                    <div style={{ color: "var(--text-mute)", fontSize: 7, fontWeight: 700, letterSpacing: 1 }}>{m.l}</div>
                    <div style={{ color: m.c, fontWeight: 800, fontSize: 12, marginTop: 2 }}>{m.v}</div>
                  </div>
                ))}
              </div>
              {t && <div style={{ color: "var(--text-mute)", fontSize: 10, marginBottom: 8 }}>
                Price: <span style={{ color: "var(--text)" }}>${t.price < 1 ? t.price.toFixed(4) : t.price.toFixed(2)}</span>
                <span style={{ color: t.changePct >= 0 ? "#00d084" : "#ff4757", marginLeft: 8 }}>{t.changePct >= 0 ? "▲" : "▼"}{Math.abs(t.changePct).toFixed(2)}%</span>
              </div>}
              {bot.market_signal && (
                <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                  <span
                    title={bot.reason_log || undefined}
                    style={{ background: bot.market_signal === "BUY" ? "#00d08418" : bot.market_signal === "SELL" ? "#ff475718" : "#2e406018", border: `1px solid ${bot.market_signal === "BUY" ? "#00d08444" : bot.market_signal === "SELL" ? "#ff475744" : "#2e406044"}`, color: bot.market_signal === "BUY" ? "#00d084" : bot.market_signal === "SELL" ? "#ff4757" : "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9, fontWeight: 800, cursor: bot.reason_log ? "help" : "default" }}
                  >
                    Market: {bot.market_signal}{bot.market_confidence ? ` ${bot.market_confidence.toFixed(0)}%` : ""}
                  </span>
                  {bot.volatility_pct != null && (
                    <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9 }}>
                      Volatility {bot.volatility_pct.toFixed(2)}%
                    </span>
                  )}
                  {bot.rr_ratio != null && (
                    <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9 }}>
                      R:R {bot.rr_ratio.toFixed(2)}
                    </span>
                  )}
                  <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9 }}>
                    {bot.timeframe || "15m"} • min {bot.confidence_threshold ?? 65}%
                  </span>
                </div>
              )}
              {bot.reason_log && (
                <div style={{ color: "var(--text-mute)", fontSize: 9, marginBottom: 8, lineHeight: 1.5 }}>
                  {bot.reason_log}
                </div>
              )}
              <div style={{ display: "flex", gap: 5 }}>
                <button style={{ flex: 1, padding: "7px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, background: bot.status === "RUNNING" ? "#ff475718" : "#00d08418", border: `1px solid ${bot.status === "RUNNING" ? "#ff4757" : "#00d084"}`, color: bot.status === "RUNNING" ? "#ff4757" : "#00d084" }} onClick={() => toggle(bot.id, bot.status)}>
                  {bot.status === "RUNNING" ? "⏹ Stop" : "▶ Start"}
                </button>
                <button style={{ padding: "7px 11px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-mute)", fontFamily: "inherit" }} onClick={() => remove(bot.id, bot.name)}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
