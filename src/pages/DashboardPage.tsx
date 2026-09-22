// pages/DashboardPage.tsx
import type { PageProps } from "./shared";
import { PAIR_DISPLAY, timeAgo } from "../types";
import { S } from "./styles";
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from "../hooks/useIsMobile";

export default function DashboardPage({ tickers, signals, bots, trades }: PageProps) {
  const navigate = useNavigate();
  // Bot P&L wasn't showing while a position was open: bot.profit only
  // updates when position_monitor_loop closes a trade (realized P&L), so a
  // bot sitting on an open position displayed stale/zero profit the whole
  // time it was open, even while genuinely up or down. Add the open
  // position's mark-to-market P&L on top of realized profit for display.
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

  // BUG FIX: this used to be bots.reduce(...) only — manual trades and
  // signal-copy trades (bot_id is null) have their own realized/unrealized
  // pnl but were never added in, so the dashboard total silently excluded
  // all non-bot trading activity.
  const manualPnl = trades
    .filter(t => !t.bot_id && (t.status === "FILLED" || t.status === "CLOSED"))
    .reduce((s, t) => s + (t.pnl || 0), 0);
  const totalProfit = bots.reduce((s, b) => s + displayProfit(b), 0) + manualPnl;
  const activeBots = bots.filter(b => b.status === "RUNNING").length;
  const activeSignals = signals.filter(s => s.status === "ACTIVE").length;
  const todayTrades = trades.filter(t => Date.now() - ((t.created_at || 0) * 1000 || t.timestamp || 0) < 86400000).length;
  const isMobile = useIsMobile();

  // "Market Pulse panel" — an honest breadth/sentiment summary computed
  // straight from the live tickers already on the page (no separate fake
  // "sentiment score" — same principle as the rest of this pass: real
  // data or nothing). Breadth = how many tracked pairs are green right
  // now; sentiment label follows breadth + the average move, not a
  // single pair's swing.
  const gainers = tickers.filter(t => t.changePct > 0).length;
  const losers = tickers.filter(t => t.changePct < 0).length;
  const avgChange = tickers.length ? tickers.reduce((s, t) => s + t.changePct, 0) / tickers.length : 0;
  const topMover = tickers.length
    ? tickers.reduce((a, b) => Math.abs(b.changePct) > Math.abs(a.changePct) ? b : a)
    : null;

  // Volatility = average ABSOLUTE move across tracked pairs. avgChange
  // alone can't distinguish a dead-flat market from a violent one where
  // gainers and losers cancel out — which is exactly the market state you
  // most want to know about before turning bots loose.
  const volatility = tickers.length
    ? tickers.reduce((s, t) => s + Math.abs(t.changePct), 0) / tickers.length
    : 0;

  // Bot consensus: what the RUNNING bots are actually reading right now
  // (bots.market_signal is refreshed every simulation cycle whether or not
  // the bot trades). This is the honest answer to "what does my system
  // think" — far more useful than a decorative sentiment score, because
  // it's the same number the bots make decisions on.
  const runningBots = bots.filter(b => b.status === "RUNNING");
  const botBuy = runningBots.filter(b => b.market_signal === "BUY").length;
  const botSell = runningBots.filter(b => b.market_signal === "SELL").length;
  const botHold = runningBots.filter(b => b.market_signal === "HOLD").length;

  // Live exposure — capital currently at risk in open positions, split by
  // whether it's real money or paper. "Total P&L" above nets everything
  // together, which hides the fact that some of it is real.
  const openTrades = trades.filter(t => t.status === "FILLED");
  const realExposure = openTrades.filter(t => t.live).reduce((s, t) => s + t.total, 0);
  const demoExposure = openTrades.filter(t => !t.live).reduce((s, t) => s + t.total, 0);

  // Breadth is a share, not a raw count — 6▲/4▼ and 60▲/40▼ are the same
  // market condition and should read the same.
  const breadthPct = tickers.length ? (gainers / tickers.length) * 100 : 0;

  const pulseLabel = tickers.length === 0 ? "—"
    : gainers > losers && avgChange > 0.2 ? "Bullish"
    : losers > gainers && avgChange < -0.2 ? "Bearish"
    : "Mixed";
  const pulseColor = pulseLabel === "Bullish" ? "#00d084" : pulseLabel === "Bearish" ? "#ff4757" : "#ffd700";
  const volLabel = volatility < 1 ? "Quiet" : volatility < 3 ? "Normal" : volatility < 6 ? "Active" : "Volatile";

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        {[
          { l: "Total P&L", v: `${totalProfit >= 0 ? "+" : ""}$${totalProfit.toFixed(2)}`, c: totalProfit >= 0 ? "#00d084" : "#ff4757", sub: "All bots" },
          { l: "Active Bots", v: activeBots.toString(), c: "#0094ff", sub: `${bots.length} total` },
          { l: "AI Signals", v: activeSignals.toString(), c: "#ffd700", sub: "Active" },
          { l: "Today Trades", v: todayTrades.toString(), c: "#ff6b8a", sub: "Executed" },
        ].map(s => (
          <div key={s.l} style={S.card}>
            <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{s.l}</div>
            <div style={{ color: s.c, fontSize: 26, fontWeight: 800, marginTop: 8, letterSpacing: -0.5 }}>{s.v}</div>
            <div style={{ color: "var(--text-mute)", fontSize: 10, marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Market Pulse */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={S.ch}>Market Pulse</div>
          <span style={{ background: `${pulseColor}18`, border: `1px solid ${pulseColor}44`, color: pulseColor, fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 20, letterSpacing: 1 }}>{pulseLabel.toUpperCase()}</span>
        </div>
        {tickers.length === 0 ? (
          <div style={{ color: "var(--text-mute)", fontSize: 11, padding: 10, textAlign: "center" }}>Connecting to market data...</div>
        ) : (
          <>
            {/* Breadth bar — the share of tracked pairs that are green,
                shown as a proportion rather than two raw counts. */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 4 }}>
                <span style={{ color: "#00d084", fontWeight: 700 }}>{gainers} up</span>
                <span style={{ color: "var(--text-mute)" }}>{breadthPct.toFixed(0)}% breadth</span>
                <span style={{ color: "#ff4757", fontWeight: 700 }}>{losers} down</span>
              </div>
              <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", background: "var(--border)" }}>
                <div style={{ width: `${breadthPct}%`, background: "#00d084", transition: "width .4s ease" }} />
                <div style={{ flex: 1, background: "#ff4757" }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12 }}>
              <div>
                <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Avg 24h Move</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: avgChange >= 0 ? "#00d084" : "#ff4757" }}>{avgChange >= 0 ? "+" : ""}{avgChange.toFixed(2)}%</div>
                <div style={{ color: "var(--text-mute)", fontSize: 9, marginTop: 2 }}>across {tickers.length} pairs</div>
              </div>

              <div title="Average absolute 24h move — how much the market is actually moving, regardless of direction">
                <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Volatility</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: "var(--text)" }}>{volatility.toFixed(2)}%</div>
                <div style={{ color: volatility >= 6 ? "#ff4757" : volatility >= 3 ? "#ffd700" : "var(--text-mute)", fontSize: 9, marginTop: 2, fontWeight: 700 }}>{volLabel}</div>
              </div>

              {topMover && (
                <div style={{ cursor: "pointer" }} onClick={() => navigate('/trading?pair=' + topMover.symbol)}>
                  <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Biggest Mover</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: "var(--text)" }}>{PAIR_DISPLAY[topMover.symbol] || topMover.symbol}</div>
                  <div style={{ fontSize: 10, marginTop: 2, color: topMover.changePct >= 0 ? "#00d084" : "#ff4757", fontWeight: 700 }}>{topMover.changePct >= 0 ? "▲" : "▼"}{Math.abs(topMover.changePct).toFixed(2)}%</div>
                </div>
              )}

              {/* What the running bots are currently reading — the same
                  signal they'd act on, not a decorative sentiment score. */}
              <div title="What your running bots are currently reading from the market">
                <div style={{ color: "var(--text-mute)", fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Bot Consensus</div>
                {runningBots.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: "var(--text-mute)" }}>No bots running</div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4, display: "flex", gap: 8 }}>
                      <span style={{ color: "#00d084" }}>{botBuy} buy</span>
                      <span style={{ color: "#ff4757" }}>{botSell} sell</span>
                      <span style={{ color: "var(--text-mute)" }}>{botHold} hold</span>
                    </div>
                    <div style={{ color: "var(--text-mute)", fontSize: 9, marginTop: 2 }}>{runningBots.length} of {bots.length} active</div>
                  </>
                )}
              </div>
            </div>

            {/* Exposure — real money and paper money kept visibly separate,
                since the headline P&L above nets them together. */}
            {(realExposure > 0 || demoExposure > 0) && (
              <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                <div style={{ fontSize: 10 }}>
                  <span style={{ color: "var(--text-mute)", fontWeight: 700, letterSpacing: 1 }}>OPEN EXPOSURE </span>
                  <span style={{ color: "var(--text)", fontWeight: 700 }}>{openTrades.length} position{openTrades.length === 1 ? "" : "s"}</span>
                </div>
                {realExposure > 0 && (
                  <div style={{ fontSize: 10 }}>
                    <span style={{ color: "#ffd700", fontWeight: 800, letterSpacing: 1 }}>LIVE </span>
                    <span style={{ color: "var(--text)", fontWeight: 700, fontFamily: "monospace" }}>${realExposure.toFixed(2)}</span>
                  </div>
                )}
                {demoExposure > 0 && (
                  <div style={{ fontSize: 10 }}>
                    <span style={{ color: "var(--text-mute)", fontWeight: 800, letterSpacing: 1 }}>DEMO </span>
                    <span style={{ color: "var(--text)", fontWeight: 700, fontFamily: "monospace" }}>${demoExposure.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
     
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {/* Live prices */}
        <div style={S.card}>
          <div style={S.ch}>Live Prices</div>
          {tickers.slice(0, 8).map(t => (
            <div key={t.symbol} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)",cursor: "pointer" }} onClick={() => navigate('/trading?pair=' + t.symbol)}>
              <div>
                <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 12 }}>{PAIR_DISPLAY[t.symbol] || t.symbol}</span>
                <span style={{ color: "var(--text-mute)", fontSize: 9, marginLeft: 8 }}>{(t.volume24h / 1e6).toFixed(1)}M</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "var(--text)", fontSize: 11, fontWeight: 600 }}>${t.price < 1 ? t.price.toFixed(4) : t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                <div style={{ color: t.changePct >= 0 ? "#00d084" : "#ff4757", fontSize: 10, fontWeight: 700 }}>{t.changePct >= 0 ? "▲" : "▼"}{Math.abs(t.changePct).toFixed(2)}%</div>
              </div>
            </div>
          ))}
          {tickers.length === 0 && <div style={{ color: "var(--text-mute)", fontSize: 11, padding: 16, textAlign: "center" }}>Connecting to market data...</div>}
        </div>

          {/* Bot performance */}
        <div style={S.card}>
          <div style={S.ch}>Bot Performance</div>
          {bots.map(bot => (
            <div key={bot.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => navigate(`/bot/${bot.id}`)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: bot.status === "RUNNING" ? "#00d084" : bot.status === "PAUSED" ? "#ffd700" : "var(--text-mute)", flexShrink: 0 }} />
                <div>
                  <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 600 }}>{bot.name}</div>
                  <div style={{ color: "var(--text-mute)", fontSize: 10 }}>{PAIR_DISPLAY[bot.pair] || bot.pair} • {bot.trades} trades</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: displayProfit(bot) >= 0 ? "#00d084" : "#ff4757", fontWeight: 700, fontSize: 13 }}>{displayProfit(bot) >= 0 ? "+" : ""}${displayProfit(bot).toFixed(2)}</div>
                <div style={{ color: "var(--text-mute)", fontSize: 10 }}>{(bot.win_rate || 0).toFixed(1)}% win</div>
              </div>
            </div>
          ))}
          {bots.length === 0 && <div style={{ color: "var(--text-mute)", fontSize: 11, padding: 16, textAlign: "center" }}>No bots yet — create in Bots tab</div>}
        </div>

      </div>

      {/* Signals */}
      <div style={S.card}>
        <div style={S.ch}>Recent Signals</div>
        {signals.length === 0 ? (
          <div style={{ color: "var(--text-mute)", fontSize: 11, padding: 20, textAlign: "center" }}>No signals — generate in Signals tab</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
            {signals.slice(0, 6).map(s => {
              const tp = s.target_price ?? s.targetPrice ?? s.price;
              const sl = s.stop_loss ?? s.stopLoss ?? s.price;
              return (
                <div key={s.id} style={{ background: "var(--surface)", border: `1px solid ${s.type === "BUY" ? "#00d08444" : s.type === "SELL" ? "#ff475744" : "#ffd70044"}`, borderRadius: 10, padding: 13, cursor: "pointer" }}  onClick={() => navigate('/trading?pair=' + s.pair)}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontWeight: 800, color: "var(--text)", fontSize: 13 }}>{PAIR_DISPLAY[s.pair] || s.pair}</span>
                      {(s.ai_generated || s.aiGenerated) && <span style={{ background: "#0094ff18", border: "1px solid #0094ff44", color: "#0094ff", fontSize: 8, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>AI</span>}
                    </div>
                    <span style={{ background: s.type === "BUY" ? "#00d084" : s.type === "SELL" ? "#ff4757" : "#ffd700", color: "#000", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 3 }}>{s.type}</span>
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: 10, marginBottom: 7, lineHeight: 1.5 }}>{s.reason?.slice(0, 70)}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                    <span style={{ color: "var(--text-dim)" }}>${s.price?.toFixed(4)}</span>
                    <span style={{ color: "#00d084" }}>{s.confidence?.toFixed(0)}% conf</span>
                  </div>
                  <div style={{ color: "var(--text-mute)", fontSize: 9, marginTop: 5, textAlign: "right" }}>
                    {timeAgo(s.created_at ?? s.timestamp)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
