// pages/BotsDetails.tsx — "view bot" page
import { useEffect, useState } from "react";
import type { PageProps } from "./shared";
import { PAIR_DISPLAY, PAIRS, TIMEFRAMES, TIMEFRAME_LABEL, type Trade } from "../types";
import { botsApi, accountApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { S } from "./styles";
import { useParams, useNavigate } from "react-router-dom";

const STRATEGIES = ["RSI Scalper", "EMA Cross", "Grid Trading", "MACD Divergence", "Bollinger Squeeze"];

// "CONFLUENCE" is an internal marker, not something to show the user
// as-is — render it as what it actually means instead.
const strategyLabel = (bot: { strategy: string; confluence_strategies?: string[] | null }) =>
  bot.strategy === "CONFLUENCE" && bot.confluence_strategies?.length
    ? `Confluence (${bot.confluence_strategies.join(" + ")})`
    : bot.strategy;

export default function BotDetails({
  bots, setBots, tickers, notify
}: PageProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const bot = bots.find((b: any) => String(b.id) === id);
  const { auth } = useAuth();
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(true);
  const [editForm, setEditForm] = useState({
    name: "", strategy: "", pair: "", mode: "DEMO" as "DEMO" | "LIVE",
    timeframe: "15m", confidenceThreshold: "65", cooldownMinutes: "0", autoPauseAfterLosses: "4",
    maxTrades: "", maxOpenPositions: "1",
  });
  const [saving, setSaving] = useState(false);
  const [brokerConnected, setBrokerConnected] = useState(false);

  useEffect(() => {
    if (!auth.token) return;
    accountApi.summary(auth.token).then(s => setBrokerConnected(s.broker_connected)).catch(() => {});
  }, [auth.token]);

  // Load the bot's actual trade history — previously this page showed
  // nothing about trades at all, just a duplicate of the bot card.
  useEffect(() => {
    if (!auth.token || !id) return;
    setLoadingTrades(true);
    botsApi.get(auth.token, id)
      .then(detail => {
        setRecentTrades(detail.recent_trades || []);
        setEditForm({
          name: detail.name, strategy: detail.strategy, pair: detail.pair, mode: (detail.mode as any) || "DEMO",
          timeframe: detail.timeframe || "15m",
          confidenceThreshold: String(detail.confidence_threshold ?? 65),
          cooldownMinutes: String(detail.cooldown_minutes ?? 0),
          autoPauseAfterLosses: String(detail.auto_pause_after_losses ?? 4),
          maxTrades: detail.max_trades ? String(detail.max_trades) : "",
          maxOpenPositions: String(detail.max_open_positions ?? 1),
        });
        // BUG FIX: this fetch returns the freshest copy of the bot —
        // including market_signal/market_confidence/volatility_pct/
        // rr_ratio/reason_log, which only otherwise arrive via the
        // BOTS_UPDATE websocket push — but it was only ever used to fill
        // recentTrades/editForm above and then thrown away. The card
        // rendered on this page reads from the shared `bots` list instead
        // (via `bots.find(...)` below), so if that list's copy of this
        // bot predated the last WS push (e.g. you navigated straight to
        // this URL, or the socket briefly dropped), the "Market Analysis"
        // section just silently never appeared — not because there was no
        // data, but because the data that WAS fetched here never reached
        // the object actually being rendered. Merging it in fixes that.
        const { recent_trades, ...botFields } = detail;
        setBots(prev => {
          const exists = prev.some(b => b.id === botFields.id);
          return exists
            ? prev.map(b => (b.id === botFields.id ? { ...b, ...botFields } : b))
            : [...prev, botFields];
        });
      })
      .catch(e => notify(e.message, "error"))
      .finally(() => setLoadingTrades(false));
  }, [auth.token, id]);

  const toggle = async (botId: string, current: string) => {
    if (!auth.token) return;
    const newStatus = current === "RUNNING" ? "STOPPED" : "RUNNING";
    try {
      const updated = await botsApi.update(auth.token, botId, { status: newStatus });
      setBots(prev => prev.map(b => b.id === botId ? updated : b));
      notify(`Bot ${newStatus.toLowerCase()}`, "success");
    } catch (e: any) { notify(e.message, "error"); }
  };

  const remove = async (botId: string, name: string) => {
    if (!auth.token || !confirm(`Remove bot "${name}"?`)) return;
    try {
      await botsApi.delete(auth.token, botId);
      setBots(prev => prev.filter(b => b.id !== botId));
      notify("Bot removed", "info");
      navigate("/bots");
    } catch (e: any) { notify(e.message, "error"); }
  };

  const saveEdits = async () => {
    if (!auth.token || !bot) return;
    setSaving(true);
    try {
      // FIX: this form previously only called setBots(...) directly — pure
      // local state, nothing was ever sent to the backend, so any change
      // reverted on refresh. Now calls the real PATCH /bots/{id}.
      const updated = await botsApi.update(auth.token, bot.id, {
        name: editForm.name,
        strategy: editForm.strategy,
        timeframe: editForm.timeframe,
        confidence_threshold: parseFloat(editForm.confidenceThreshold) || 65,
        cooldown_minutes: parseInt(editForm.cooldownMinutes, 10) || 0,
        auto_pause_after_losses: editForm.autoPauseAfterLosses !== "" ? parseInt(editForm.autoPauseAfterLosses, 10) : 4,
        max_trades: editForm.maxTrades ? parseInt(editForm.maxTrades, 10) : 0,
        max_open_positions: parseInt(editForm.maxOpenPositions, 10) || 1,
        ...(editForm.pair !== bot.pair ? { pair: editForm.pair } : {}),
        ...(editForm.mode !== bot.mode ? { mode: editForm.mode } : {}),
      });
      setBots(prev => prev.map(b => b.id === bot.id ? updated : b));
      notify("Bot updated", "success");
    } catch (e: any) {
      // Surfaces backend validation, e.g. "Stop the bot before changing its trading pair"
      notify(e.message, "error");
    }
    setSaving(false);
  };

  if (!bot) {
    return (
      <div style={{ color: "white" }}>
        Bot not found
      </div>
    );
  }
  const t = tickers.find(t => t.symbol === bot.pair);

  const active = recentTrades.filter(tr => tr.status === "FILLED");
  const closed = recentTrades.filter(tr => tr.status === "CLOSED");
  const closedWins = closed.filter(tr => (tr.pnl || 0) >= 0);
  const closedLosses = closed.filter(tr => (tr.pnl || 0) < 0);

  // Same fix as Dashboard/BotsPage: bot.profit only reflects realized
  // (closed) trades, so a bot mid-position showed stale/zero P&L.
  const openTrade = active[0];
  const unrealizedPnl = openTrade && t
    ? (openTrade.side === "BUY" ? (t.price - openTrade.price) * openTrade.amount : (openTrade.price - t.price) * openTrade.amount)
    : 0;
  const displayProfit = bot.profit + unrealizedPnl;

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 13, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ l: "Active", c: "#0094ff", n: active.length },
            { l: "Wins", c: "#00d084", n: closedWins.length },
            { l: "Losses", c: "#ff4757", n: closedLosses.length }].map(s => (
            <div key={s.l} style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 11px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.c }} />
              <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 12 }}>{s.n}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{s.l}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 11 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 15 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
            <div>
              <div style={{ color: "var(--text)", fontWeight: 800, fontSize: 14 }}>{bot.name}</div>
              <div style={{ color: "var(--text-mute)", fontSize: 10, marginTop: 2 }}>{PAIR_DISPLAY[bot.pair] || bot.pair} • {strategyLabel(bot)}</div>
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
            {[{ l: "P&L", v: `${displayProfit >= 0 ? "+" : ""}$${displayProfit.toFixed(2)}`, c: displayProfit >= 0 ? "#00d084" : "#ff4757" },
              { l: "WIN %", v: `${(bot.win_rate || 0).toFixed(1)}%`, c: "var(--text)" },
              { l: "TRADES", v: bot.trades.toString(), c: "var(--text)" },
              { l: "CAPITAL", v: `$${bot.capital >= 1000 ? (bot.capital / 1000).toFixed(1) + "K" : bot.capital}`, c: "var(--text)" }].map(m => (
              <div key={m.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 7px", textAlign: "center" }}>
                <div style={{ color: "var(--text-mute)", fontSize: 7, fontWeight: 700, letterSpacing: 1 }}>{m.l}</div>
                <div style={{ color: m.c, fontWeight: 800, fontSize: 12, marginTop: 2 }}>{m.v}</div>
              </div>
            ))}
          </div>
          {t && (
            <div style={{ color: "var(--text-mute)", fontSize: 10, marginBottom: 6 }}>
              Price: <span style={{ color: "var(--text)" }}>${t.price < 1 ? t.price.toFixed(4) : t.price.toFixed(2)}</span>
              <span style={{ color: t.changePct >= 0 ? "#00d084" : "#ff4757", marginLeft: 8 }}>{t.changePct >= 0 ? "▲" : "▼"}{Math.abs(t.changePct).toFixed(2)}%</span>
            </div>
          )}
          {bot.status === "PAUSED" && (
            <div style={{ color: "#ffd700", fontSize: 10, marginBottom: 6, background: "#ffd70012", border: "1px solid #ffd70044", borderRadius: 7, padding: "6px 9px" }}>
              ⏸ Paused — still reading the market below, but won't open new trades until you hit Start.
            </div>
          )}
          {bot.market_signal && (
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ background: bot.market_signal === "BUY" ? "#00d08418" : bot.market_signal === "SELL" ? "#ff475718" : "#2e406018", border: `1px solid ${bot.market_signal === "BUY" ? "#00d08444" : bot.market_signal === "SELL" ? "#ff475744" : "#2e406044"}`, color: bot.market_signal === "BUY" ? "#00d084" : bot.market_signal === "SELL" ? "#ff4757" : "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9, fontWeight: 800 }}>
                Market: {bot.market_signal}{bot.market_confidence ? ` ${bot.market_confidence.toFixed(0)}%` : ""}
              </span>
              {bot.volatility_pct != null && (
                <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9 }}>Volatility {bot.volatility_pct.toFixed(2)}%</span>
              )}
              {bot.rr_ratio != null && (
                <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9 }}>R:R {bot.rr_ratio.toFixed(2)}</span>
              )}
              <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", borderRadius: 5, padding: "3px 8px", fontSize: 9 }}>
                {bot.timeframe || "15m"} • min {bot.confidence_threshold ?? 65}% • cooldown {bot.cooldown_minutes ?? 0}m
                {bot.max_trades ? ` • trades ${bot.trades}/${bot.max_trades}` : ""}
              </span>
            </div>
          )}
          {bot.reason_log && (
            <div style={{ color: "var(--text-mute)", fontSize: 10, marginBottom: 11, lineHeight: 1.5, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 9px" }}>
              <span style={{ color: "var(--text-dim)", fontWeight: 700, fontSize: 9, letterSpacing: 1 }}>LATEST READ — </span>{bot.reason_log}
            </div>
          )}
          <div style={{ display: "flex", gap: 5 }}>
            <button style={{ flex: 1, padding: "7px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, background: bot.status === "RUNNING" ? "#ff475718" : "#00d08418", border: `1px solid ${bot.status === "RUNNING" ? "#ff4757" : "#00d084"}`, color: bot.status === "RUNNING" ? "#ff4757" : "#00d084" }} onClick={() => toggle(bot.id, bot.status)}>
              {bot.status === "RUNNING" ? "⏹ Stop" : "▶ Start"}
            </button>
            <button style={{ padding: "7px 11px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-mute)", fontFamily: "inherit" }} onClick={() => navigate(`/trading?pair=${bot.pair}`)}>📈 Chart</button>
            <button style={{ padding: "7px 11px", borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-mute)", fontFamily: "inherit" }} onClick={() => remove(bot.id, bot.name)}>🗑</button>
          </div>
        </div>
      </div>

      <div style={{ height: 11 }} />

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 15 }}>
        <div style={{ color: "var(--text)", fontWeight: 800, fontSize: 14, marginBottom: 11 }}>Edit Bot</div>
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap", alignItems: "end" }}>
          <div style={S.fg}>
            <label style={S.lbl}>Name</label>
            <input style={S.inp} value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div style={S.fg}>
            <label style={S.lbl}>Pair {bot.status === "RUNNING" && <span style={{ color: "#ff4757" }}>(stop bot to change)</span>}</label>
            <select style={S.inp} value={editForm.pair} disabled={bot.status === "RUNNING"} onChange={e => setEditForm(p => ({ ...p, pair: e.target.value }))}>
              {PAIRS.map(p => <option key={p} value={p}>{PAIR_DISPLAY[p]}</option>)}
            </select>
          </div>
          <div style={S.fg}>
            <label style={S.lbl}>Strategy</label>
            {bot.strategy === "CONFLUENCE" ? (
              // Confluence bots aren't editable inline here yet (changing
              // the checked-strategy set needs the create form's
              // multi-select) — showing a normal single-strategy dropdown
              // here would misrepresent what this bot is actually running.
              // Delete and recreate it via the Bots page to change its
              // strategy set.
              <div style={{ ...S.inp, display: "flex", alignItems: "center", color: "var(--text-dim)", fontSize: 12 }} title={bot.confluence_strategies?.join(", ")}>
                {strategyLabel(bot)}
              </div>
            ) : (
              <select style={S.inp} value={editForm.strategy} onChange={e => setEditForm(p => ({ ...p, strategy: e.target.value }))}>
                {STRATEGIES.map(s => <option key={s}>{s}</option>)}
              </select>
            )}
          </div>
          <div style={S.fg}>
            <label style={S.lbl}>Mode {bot.status === "RUNNING" && <span style={{ color: "#ff4757" }}>(stop bot to change)</span>}</label>
            <select style={S.inp} value={editForm.mode} disabled={bot.status === "RUNNING" || !brokerConnected} onChange={e => setEditForm(p => ({ ...p, mode: e.target.value as any }))}>
              <option value="DEMO">Demo</option>
              {brokerConnected && <option value="LIVE">Live</option>}
            </select>
          </div>
          <div style={S.fg}>
            <label style={S.lbl} title="How often this bot's market read updates. Shorter = more trade opportunities but noisier.">Signal Timeframe</label>
            <select style={S.inp} value={editForm.timeframe} onChange={e => setEditForm(p => ({ ...p, timeframe: e.target.value }))}>
              {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{TIMEFRAME_LABEL[tf]}</option>)}
            </select>
          </div>
          <div style={S.fg}>
            <label style={S.lbl} title="Minimum confidence score required before this bot enters a trade.">Min Confidence %</label>
            <input style={S.inp} type="number" min={50} max={95} value={editForm.confidenceThreshold} onChange={e => setEditForm(p => ({ ...p, confidenceThreshold: e.target.value }))} />
          </div>
          <div style={S.fg}>
            <label style={S.lbl} title="Minimum minutes between this bot's trades.">Cooldown (min)</label>
            <input style={S.inp} type="number" min={0} value={editForm.cooldownMinutes} onChange={e => setEditForm(p => ({ ...p, cooldownMinutes: e.target.value }))} />
          </div>
          <div style={S.fg}>
            <label style={S.lbl} title="Auto-pauses this bot after this many losing trades in a row. 0 disables it.">Pause After N Losses</label>
            <input style={S.inp} type="number" min={0} value={editForm.autoPauseAfterLosses} onChange={e => setEditForm(p => ({ ...p, autoPauseAfterLosses: e.target.value }))} />
          </div>
          <div style={S.fg}>
            <label style={S.lbl} title="Auto-pauses this bot once its total trade count reaches this number, regardless of performance. Leave blank for no limit.">Stop After N Trades</label>
            <input style={S.inp} type="number" min={0} value={editForm.maxTrades} onChange={e => setEditForm(p => ({ ...p, maxTrades: e.target.value }))} placeholder="No limit" />
          </div>
          <div style={S.fg}>
            {/* This was the actual gap: creating a NEW bot let you set
                concurrent positions, but there was no way at all to change
                it on a bot you'd already created — which, for anyone
                testing this feature, is every bot they have. */}
            <label style={S.lbl} title="How many positions this bot may hold at the same time. Each position draws from the same capital pool, so raising this splits capital across trades rather than multiplying exposure.">Concurrent Positions</label>
            <input style={S.inp} type="number" min={1} max={10} value={editForm.maxOpenPositions} onChange={e => setEditForm(p => ({ ...p, maxOpenPositions: e.target.value }))} placeholder="1" />
          </div>
          <button style={{ ...S.btn, width: "auto", padding: "9px 18px" }} onClick={saveEdits} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div style={{ height: 11 }} />

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 15 }}>
        <div style={{ color: "var(--text)", fontWeight: 800, fontSize: 14, marginBottom: 11 }}>Trades Placed by This Bot</div>
        {loadingTrades && <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading trades...</div>}
        {!loadingTrades && recentTrades.length === 0 && (
          <div style={{ color: "var(--text-mute)", fontSize: 12 }}>No trades placed yet. Start the bot to begin trading.</div>
        )}
        {!loadingTrades && recentTrades.length > 0 && (
          <table style={{ width: "100%", fontSize: 12 }}>
            <thead style={{ color: "var(--text-dim)" }}>
              <tr>
                <th style={{ textAlign: "left" }}>Side</th>
                <th style={{ textAlign: "left" }}>Price</th>
                <th style={{ textAlign: "left" }}>Amount</th>
                <th style={{ textAlign: "left" }}>PnL</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Reason</th>
                <th style={{ textAlign: "left" }}>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map(tr => (
                <tr key={tr.id}>
                  <td style={{ color: tr.side === "BUY" ? "#00d084" : "#ff4757", padding: "6px 0" }}>
                    {tr.side} {tr.live ? <span style={{ fontSize: 8, color: "#ff4757", border: "1px solid #ff4757", borderRadius: 3, padding: "1px 4px", marginLeft: 4 }}>LIVE</span> : null}
                  </td>
                  <td>{tr.price.toFixed(4)}</td>
                  <td>{tr.amount}</td>
                  <td style={{ color: (tr.pnl || 0) >= 0 ? "#00d084" : "#ff4757" }}>{(tr.pnl || 0).toFixed(2)}</td>
                  <td>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: tr.status === "FILLED" ? "#0094ff18" : "#2e406018",
                      color: tr.status === "FILLED" ? "#0094ff" : "var(--text-dim)",
                    }}>{tr.status === "FILLED" ? "ACTIVE" : tr.status}</span>
                  </td>
                  <td style={{ color: "var(--text-dim)", fontSize: 10, maxWidth: 220 }} title={tr.reason || undefined}>
                    {tr.reason ? (tr.reason.length > 46 ? tr.reason.slice(0, 46) + "…" : tr.reason) : "—"}
                  </td>
                  <td style={{ color: "var(--text-dim)" }}>{new Date((tr.created_at ? tr.created_at * 1000 : tr.timestamp) || 0).toLocaleString()}</td>
                  <td>
                    <button style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: "var(--surface)", border: "1px solid var(--border2)", color: "#0094ff" }}
                      onClick={() => navigate(`/trading?pair=${tr.pair}`)}>
                      View Chart
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
