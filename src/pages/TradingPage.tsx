// pages/TradingPage.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import type { PageProps } from "./shared";
import { KlineUpdate, PAIR_DISPLAY, PAIRS, Trade, type OHLCV } from "../types";
import { marketApi, tradesApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import ProChart, { type OrderBookData } from "../components/ProChart";
import { S } from "./styles";
import { useLocation } from "react-router-dom";
import TradeModal from "../components/TradeModal";

// ── Technical Analysis ────────────────────────────────────────────────────────
function rsi(closes: number[], p = 14) {
  if (closes.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  return 100 - 100 / (1 + g / (l || 0.001));
}
function ema(d: number[], p: number) {
  const k = 2 / (p + 1); const e = [d[0]];
  for (let i = 1; i < d.length; i++) e.push(d[i] * k + e[i - 1] * (1 - k));
  return e;
}
function macd(closes: number[]) {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const ml = e12.map((v, i) => v - e26[i]);
  const sl = ema(ml, 9);
  return { macd: ml[ml.length - 1], signal: sl[sl.length - 1], hist: ml[ml.length - 1] - sl[sl.length - 1] };
}
function bb(closes: number[], p = 20) {
  const sl = closes.slice(-p); const mean = sl.reduce((a, b) => a + b, 0) / sl.length;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / sl.length);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

export default function TradingPage({ tickers, trades, setTrades, signals, notify }: PageProps) {
  const location = useLocation();
  const pair = new URLSearchParams(location.search).get("pair");
  const signalId = new URLSearchParams(location.search).get("signal");
  const backtestTrade = (location.state as any)?.backtestTrade as
    | { side: "BUY" | "SELL"; entry_price: number; exit_price: number; result: "WIN" | "LOSS"; pnl_pct: number }
    | undefined;
  const backtestOverlay = useMemo(() => {
    if (!backtestTrade) return null;
    return {
      side: backtestTrade.side, entryPrice: backtestTrade.entry_price, exitPrice: backtestTrade.exit_price,
      result: backtestTrade.result, pnlPct: backtestTrade.pnl_pct,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);
  const signalOverlay = useMemo(() => {
    const s = signals.find(sig => sig.id === signalId);
    if (!s) return null;
    return {
      id: s.id, type: s.type, price: s.price,
      targetPrice: s.target_price ?? s.targetPrice ?? s.price,
      stopLoss: s.stop_loss ?? s.stopLoss ?? s.price,
      confidence: s.confidence, reason: s.reason,
    };
  }, [signals, signalId]);
  const { auth, updateUser } = useAuth();
  const [sel, setSel] = useState(pair ? pair : (localStorage.getItem("last_pair") || "BTCUSDT"));
  useEffect(() => {
    if (pair && pair !== sel) setSel(pair);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair]);
  const [candles, setCandles] = useState<OHLCV[]>([]);
  // Shown as a small "Updating chart…" overlay in ProChart while true.
  // BUG FIX: switching pair/timeframe used to leave the OLD pair's candles
  // in state until the new fetch resolved, but ProChart's data-push effect
  // reacts to `symbol`/`timeframe` changing immediately — so for one render
  // it pushed the old pair's prices into the chart labeled as the new
  // symbol (e.g. BTCUSDT's ~$80k candles briefly rendered as "ETHUSDT"),
  // then the next update() call appended real ETHUSDT data on top of that
  // wrong price scale. That mismatch is what showed up as the chart
  // "getting malformed" right after a switch. `chartLoading` now gates
  // that: candles are only ever set once, straight to real data for the
  // new symbol/timeframe.
  const [chartLoading, setChartLoading] = useState(false);
  // Oldest loaded candle's time (ms) per symbol+timeframe — used to page
  // further back when the user scrolls near the left edge of the chart.
  const oldestLoadedRef = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);
  const [iv, setIv] = useState(localStorage.getItem("last_timeframe") || "1h");
  useEffect(() => { localStorage.setItem("last_pair", sel); }, [sel]);
  useEffect(() => { localStorage.setItem("last_timeframe", iv); }, [iv]);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("0.001");
  const [limitPrice, setLimitPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const ticker = tickers.find(t => t.symbol === sel);
  const ts = (t: typeof trades[0]) => t.created_at ? t.created_at * 1000 : t.timestamp || 0;
  // 1. Initial Load (REST)
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  // Price list stays hidden until the user explicitly asks for it (tapping
  // the symbol on mobile, or the "Prices" toggle on desktop) — it used to
  // default open on desktop and pop back open every time the window was
  // resized across the mobile/desktop breakpoint, even after the user had
  // closed it.
  const [showPrices, setShowPrices] = useState(false);
  const [showPairsModal, setShowPairsModal] = useState(false);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
useEffect(() => {
  const onResize = () => {
    const mobile = window.innerWidth < 992;
    setIsMobile(mobile);
    if (mobile) setShowPairsModal(false);
  };

  onResize();

  window.addEventListener("resize", onResize);

  return () => window.removeEventListener("resize", onResize);
}, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      setChartLoading(true);
      try {
        // Backend no longer fabricates candles when the market data source
        // is temporarily unreachable (see services/market.py) — it now
        // returns the last known REAL candles for this exact symbol+
        // timeframe if any exist, or [] only on a genuine cold start (this
        // exact pair/timeframe has never been fetched successfully by
        // anyone). An empty result here still gets swapped in (rather than
        // leaving the PREVIOUS pair's candles on screen under the new
        // pair's label, which is the "old data flashes as new symbol" bug
        // this effect exists to prevent) — chartLoading's overlay covers
        // that moment, and pollUpdates below is what actually implements
        // "keep the candles on screen while retrying" for this same pair.
        const data = await marketApi.klines(sel, iv, 300);
        if (!cancelled) {
          // Single atomic swap to the new symbol/timeframe's real data —
          // see the note on chartLoading above for why this can't be a
          // partial/staged update.
          setCandles(data);
          oldestLoadedRef.current = data[0]?.time ?? null;
        }
      } catch (err) {
        console.error("Failed to load candles", err);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    };

    const pollUpdates = async () => {
      try {
        const updates = await marketApi.klines(sel, iv, 3);

        if (!cancelled && updates.length) {
          setCandles(prev => {
            const map = new Map(prev.map(c => [c.time, c]));

            updates.forEach(c => map.set(c.time, c));

            // Keep however much history is currently loaded (scrolling
            // back can grow this well past 100) instead of clamping every
            // poll back down to the last 100 bars, which used to undo
            // "load more history" a few seconds after it happened.
            const keep = Math.max(100, prev.length);
            return Array
              .from(map.values())
              .sort((a, b) => a.time - b.time)
              .slice(-keep);
          });
        }
      } catch (err) {
        console.error("Candle update failed", err);
      }
    };

    loadInitial();

    const interval = setInterval(pollUpdates, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sel, iv]);

  // Fetch older candles and prepend them when the user scrolls back near
  // the start of what's currently loaded — "increase candles I view when I
  // move back". Guards against overlapping calls and against re-fetching
  // once Binance/the sim backend has no more history to give.
  // Bumped 150 -> 500 -> 800 per scroll-back across two rounds of the same
  // request (Binance's own cap is 1000 per request — left some headroom
  // under it rather than maxing out, since a single very slow request on
  // a weak connection is worse UX than one more scroll-back later).
  const loadMoreHistory = async () => {
    if (loadingMoreRef.current || oldestLoadedRef.current == null) return;
    loadingMoreRef.current = true;
    try {
      const before = oldestLoadedRef.current;
      const older = await marketApi.klines(sel, iv, 800, before);
      const fresh = older.filter(c => c.time < before);
      if (fresh.length) {
        oldestLoadedRef.current = fresh[0].time;
        setCandles(prev => {
          const map = new Map(fresh.map(c => [c.time, c]));
          prev.forEach(c => map.set(c.time, c));
          return Array.from(map.values()).sort((a, b) => a.time - b.time);
        });
      }
    } catch (err) {
      console.error("Failed to load older candles", err);
    } finally {
      loadingMoreRef.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadBook = async () => {
      try {
        const book = await marketApi.orderBook(sel, 15);
        if (!cancelled) setOrderBook(book);
      } catch (err) {
        console.error("Failed to load order book", err);
      }
    };
    loadBook();
    const bookInterval = setInterval(loadBook, 4000);
    return () => { cancelled = true; clearInterval(bookInterval); };
  }, [sel]);

  useEffect(() => {

    const price = candles[candles.length - 1]?.close
    if (!price) return

    setTrades(t =>
      t.map(trade => {

        // BUG FIX: this used to recompute PnL for every trade in the app
        // using the currently-viewed pair's price, silently corrupting the
        // PnL (and therefore dashboard totals) of trades on other pairs
        // every time the user switched symbols. Now scoped to `sel` only.
        if (trade.status !== "FILLED" || trade.pair !== sel) return trade

        const pnl =
          trade.side === "BUY"
            ? (price - trade.price) * trade.amount
            : (trade.price - price) * trade.amount


        return { ...trade, pnl }
      })
    )

  }, [candles])

  const closes = candles.map(c => c.close);
  const RSI = rsi(closes), MACD = macd(closes), BB = bb(closes);
  const fmt = (p: number) => p < 1 ? p.toFixed(4) : p < 10000 ? p.toFixed(2) : p.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const handleOrder = async () => {
    if (!auth.token) return;
    setLoading(true);
    try {
      const trade = await tradesApi.place(auth.token, {
        pair: sel, side, amount: parseFloat(amount),
        order_type: orderType,
        ...(orderType === "limit" && limitPrice ? { limit_price: parseFloat(limitPrice) } : {}),
      });
      setTrades(prev => [trade, ...prev]);
      if (typeof (trade as any).balance === "number") updateUser({ balance: (trade as any).balance });
      notify(`${side} filled: ${amount} ${PAIR_DISPLAY[sel]} @ $${trade.price.toFixed(2)}`, "success");
    } catch (e: any) {
      notify(e.message, "error");
    }
    setLoading(false);
  };

  const handleAI = async () => {
    console.log("start");
    if (!ticker) return;
    console.log("end");
    setAiLoading(true); setAiText("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 450,
          messages: [{ role: "user", content: `Professional crypto analysis for ${sel}:\nPrice: $${ticker.price.toFixed(4)}, RSI: ${RSI.toFixed(1)}, MACD hist: ${MACD.hist.toFixed(5)}, 24h: ${ticker.changePct.toFixed(2)}%, High: $${ticker.high24h.toFixed(2)}, Low: $${ticker.low24h.toFixed(2)}\n\nProvide:\n📊 SIGNAL: BUY/SELL/HOLD\n🎯 CONFIDENCE: X%\n💰 TARGET: $X\n🛑 STOP: $X\n📝 Analysis (3 sentences)` }],
        }),
      });
      const data = await res.json();
      setAiText(data.content?.[0]?.text || "Analysis unavailable");
    } catch {
      setAiText(`RSI at ${RSI.toFixed(1)} ${RSI < 40 ? "— oversold, potential reversal" : RSI > 65 ? "— overbought, caution advised" : "— neutral range"}. MACD hist ${MACD.hist > 0 ? "positive (bullish)" : "negative (bearish)"}.`);
    }
    setAiLoading(false);
  };

  function renderOrderPanel() {
    return (
      <>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Order</div>
        {ticker && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 13 }}>
            {[{ l: "BID", v: "$" + fmt(ticker.bid), c: "#00d084" }, { l: "ASK", v: "$" + fmt(ticker.ask), c: "#ff4757" },
            { l: "HIGH", v: "$" + fmt(ticker.high24h), c: "var(--text)" }, { l: "LOW", v: "$" + fmt(ticker.low24h), c: "var(--text)" }].map(s => (
              <div key={s.l} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 9px" }}>
                <div style={{ color: "var(--text-mute)", fontSize: 8, fontWeight: 700, letterSpacing: 1 }}>{s.l}</div>
                <div style={{ color: s.c, fontWeight: 700, fontSize: 11, marginTop: 1 }}>{s.v}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 5, marginBottom: 11 }}>
          {(["BUY", "SELL"] as const).map(s => (
            <button key={s} style={{ flex: 1, padding: 9, borderRadius: 7, cursor: "pointer", fontWeight: 800, fontSize: 12, fontFamily: "inherit", border: `1px solid ${side === s ? (s === "BUY" ? "#00d084" : "#ff4757") : "var(--border)"}`, background: side === s ? (s === "BUY" ? "#00d084" : "#ff4757") : "var(--surface)", color: side === s ? "#000" : "var(--text-dim)" }} onClick={() => setSide(s)}>{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 11 }}>
          {(["market", "limit"] as const).map(t => (
            <div key={t} style={{ flex: 1, padding: "6px", borderRadius: 6, cursor: "pointer", background: orderType === t ? "#0094ff22" : "var(--surface)", border: `1px solid ${orderType === t ? "#0094ff" : "var(--border)"}`, color: orderType === t ? "#0094ff" : "var(--text-dim)", textAlign: "center", fontSize: 10 }} onClick={() => setOrderType(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</div>
          ))}
        </div>
        <div style={S.fg}>
          <label style={S.lbl}>Amount</label>
          <input style={S.inp} value={amount} onChange={e => setAmount(e.target.value)} type="number" step="0.001" />
        </div>
        {orderType === "limit" && (
          <div style={S.fg}>
            <label style={S.lbl}>Limit Price</label>
            <input style={S.inp} value={limitPrice} onChange={e => setLimitPrice(e.target.value)} type="number" placeholder={ticker?.price.toFixed(2)} />
          </div>
        )}
        {ticker && <div style={{ color: "var(--text-mute)", fontSize: 10, marginBottom: 10 }}>Total ≈ <span style={{ color: "var(--text)" }}>${(parseFloat(amount) * ticker.price || 0).toFixed(2)}</span></div>}
        <button style={{ ...S.btn, background: side === "BUY" ? "#00d084" : "#ff4757", fontWeight: 800 }} onClick={handleOrder} disabled={loading}>
          {loading ? "Processing..." : `${side} ${PAIR_DISPLAY[sel]}`}
        </button>
      </>
    );
  }

 const styles = {
  page: {
    display: "flex",
    flexDirection: "column" as const,
    background: "var(--bg2)",
    // BUG FIX: this was "minHeight: 100vh" + "overflow: hidden" combined
    // with a fixed "calc(100vh - 170px)" height on the panels below. That
    // math assumed the top bar always renders as a single line; it wraps
    // to two lines on narrower desktop widths (it has flexWrap: "wrap"),
    // at which point the panels' calc'd height ran past the real
    // remaining space and "overflow: hidden" silently clipped whatever
    // didn't fit — the old Recent Trades table, or open positions/time —
    // rather than showing or scrolling to it. It looked fine on Android
    // only because a tall mobile viewport rarely hit the wrap case.
    // Fix: give the page a real fixed height (not min-height) so the
    // panels below can use flex:1 / height:100% to fill *whatever* space
    // the top bar actually leaves, instead of guessing its height in px.
    height: isMobile ? "auto" : "100vh",
    minHeight: "100vh",
    color: "#e6edf3",
    padding: 10,
    overflow: isMobile ? "visible" : "hidden"
  },

  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
    flexShrink: 0,
    padding: "12px 14px",
    background: "var(--surface2)",
    border: "1px solid var(--border2)",
    borderRadius: 10,
    marginBottom: 10
  },

  symbol: {
    fontWeight: 700,
    fontSize: isMobile ? 13 : 15,
    display: "flex",
    gap: 10,
    alignItems: "center",
    cursor: "pointer"
  },

  metrics: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap" as const,
    fontSize: isMobile ? 10 : 12,
    color: "var(--text-dim)"
  },

  grid: {
    display: "flex",
    flex: 1,
    gap: 10,
    width: "100%",
    minHeight: isMobile ? undefined : 0,
    overflow: isMobile ? "visible" : "hidden"
  },

  // These used to be a hardcoded "calc(100vh - 170px)", which assumed a
  // fixed top-bar height (see the note on `page` above). Now that `grid`
  // has flex:1 inside a page with a real height, "height: 100%" makes each
  // panel fill exactly whatever room the top bar actually left — correct
  // no matter how many lines the top bar wraps to.
  leftPanel: {
    width: 260,
    minWidth: 240,
    maxWidth: 280,
    background: "var(--surface2)",
    border: "1px solid var(--border2)",
    borderRadius: 10,
    overflowY: "auto" as const,
    padding: 8,
    height: "100%"
  },

  center: {
    flex: 1,
    minWidth: 0,
    background: "var(--surface2)",
    border: "1px solid var(--border2)",
    borderRadius: 10,
    padding: isMobile ? 0 : 10,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    height: isMobile ? 560 : "100%"
  },

  rightPanel: {
    width: isMobile ? "100%" : 320,
    minWidth: isMobile ? "100%" : 300,
    background: "var(--surface2)",
    border: "1px solid var(--border2)",
    borderRadius: 10,
    padding: 12,
    overflowY: "auto" as const,
    height: isMobile ? "auto" : "100%"
  },

  pair: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px",
    borderBottom: "1px solid var(--border2)",
    cursor: "pointer",
    fontSize: 12,
    borderRadius: 6
  },

  mobilePairsButton: {
    position: "fixed" as const,
    bottom: 20,
    left: 20,
    zIndex: 1000,
    background: "#0094ff",
    border: "none",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 12,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)"
  },

  mobileModal: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    zIndex: 2000,
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "stretch"
  },

  mobileModalContent: {
    width: 280,
    background: "var(--surface2)",
    borderRight: "1px solid var(--border2)",
    overflowY: "auto" as const,
    padding: 10
  }

};


  return (
    <>
      <div style={styles.page}>

        {/* TOP BAR */}
        <div style={styles.topBar}>
          <div style={styles.symbol} onClick={() => { isMobile ? setShowPairsModal(!showPairsModal) : setShowPrices(!showPrices);}}>
            {PAIR_DISPLAY[sel]}
            <span style={{ color: ticker?.changePct! >= 0 ? "#00d084" : "#ff4757", transition: "color 0.25s" }}>
              {ticker ? `$${fmt(ticker.price)}` : "—"}
            </span>
          </div>

          <div style={styles.metrics}>
            <span>RSI {RSI.toFixed(1)}</span>
            <span>MACD {MACD.hist.toFixed(3)}</span>
            <span>H {ticker ? fmt(ticker.high24h) : "—"}</span>
            <span>L {ticker ? fmt(ticker.low24h) : "—"}</span>
          </div>
        </div>

     <div
  style={{
    ...styles.grid,
    flexDirection: isMobile ? "column" : "row"
  }}
>
  {/* DESKTOP LEFT PANEL */}
  {!isMobile && showPrices && (
    <div style={styles.leftPanel}>
      {tickers.map(t => (
        <div
          key={t.symbol}
          onClick={() => setSel(t.symbol)}
          style={styles.pair}
        >
          <div>{PAIR_DISPLAY[t.symbol]}</div>

          <div
            style={{
              color: t.changePct >= 0 ? "#00d084" : "#ff4757"
            }}
          >
            {t.changePct.toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  )}

  {/* CENTER CHART */}
  <div style={styles.center}>
    <ProChart
      candles={candles}
      loading={chartLoading}
      onRequestMoreHistory={loadMoreHistory}
      trades={trades}
      symbol={sel}
      timeframe={iv}
      onTimeframeChange={setIv}
      onTradeClick={setSelectedTrade}
      orderBook={orderBook}
      signalOverlay={signalOverlay}
      backtestOverlay={backtestOverlay}
      onUpdateTpSl={async (tradeId, data) => {
        if (!auth.token) return;
        try {
          const updated = await tradesApi.updateTpSl(auth.token, tradeId, data);
          setTrades(prev => prev.map(t => (t.id === updated.id ? updated : t)));
        } catch (e: any) {
          notify(e.message, "error");
        }
      }}
    />

    {selectedTrade && (
      <TradeModal
        trade={selectedTrade}
        currentPrice={candles[candles.length - 1]?.close || 0}
        token={auth.token}
        notify={notify}
        onClose={() => setSelectedTrade(null)}
        onUpdate={(updated) => {
          setTrades(prev =>
            prev.map(t =>
              t.id === updated.id
                ? updated
                : t
            )
          )
        }}
      />
    )}
  </div>

  {/* RIGHT PANEL */}
  <div style={styles.rightPanel}>
    {renderOrderPanel()}
  </div>
</div>
{/* MOBILE PAIRS BUTTON */}
{isMobile && (
  <>
    <button
      style={styles.mobilePairsButton}
      onClick={() => setShowPairsModal(true)}
    >
      Pairs
    </button>

    {showPairsModal && (
      <div
        style={styles.mobileModal}
        onClick={() => setShowPairsModal(false)}
      >
        <div
          style={styles.mobileModalContent}
          onClick={(e) => e.stopPropagation()}
        >
          {tickers.map(t => (
            <div
              key={t.symbol}
              onClick={() => {
                setSel(t.symbol);
                setShowPairsModal(false);
              }}
              style={styles.pair}
            >
              <div>{PAIR_DISPLAY[t.symbol]}</div>

              <div
                style={{
                  color:
                    t.changePct >= 0
                      ? "#00d084"
                      : "#ff4757"
                }}
              >
                {t.changePct.toFixed(2)}%
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </>
)}
      </div>
    </>

  );
}