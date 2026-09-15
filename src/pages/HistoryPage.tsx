// pages/HistoryPage.tsx
import { useEffect, useState } from "react";
import type { PageProps } from "./shared";
import { PAIR_DISPLAY, type OHLCV } from "../types";
import { tradesApi, marketApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import ProChart from "../components/ProChart";
import { S } from "./styles";

export default function HistoryPage({ trades, setTrades, notify, tickers }: PageProps) {
  const { auth, updateUser } = useAuth();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [filter, setFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const filtered = filter === "ALL" ? trades : trades.filter(t => t.side === filter);
  // Only count trades that actually settled — a CANCELLED trade has no
  // real PnL and shouldn't drag down the win rate denominator.
  const settled = trades.filter(t => t.status === "FILLED" || t.status === "CLOSED");
  const pnl = settled.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = settled.filter(t => (t.pnl || 0) > 0).length;
  const ts = (t: typeof trades[0]) => t.created_at ? t.created_at * 1000 : t.timestamp || 0;
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const [editing, setEditing] = useState<any | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [modalCandles, setModalCandles] = useState<OHLCV[]>([]);
  // BUG FIX: lightweight-charts draws no time-axis labels at all when a
  // series has zero data points — this modal's chart used to render with
  // `candles={[]}` for the moment between opening and the fetch resolving,
  // which showed a completely blank grid with no timestamps ("time not
  // shown in some screens"). Reusing ProChart's own `loading` overlay
  // covers that gap instead of ever rendering the chart against empty data.
  const [modalCandlesLoading, setModalCandlesLoading] = useState(false);
  const ticker = tickers.find(t => t.symbol === editing?.pair);

  // Fetch candles for the embedded "how this trade is going" chart whenever
  // the edit modal opens for a trade — previously the modal was text-only.
  useEffect(() => {
    if (!editing) { setModalCandles([]); return; }
    let cancelled = false;
    setModalCandlesLoading(true);
    marketApi.klines(editing.pair, "1h", 100)
      .then(data => { if (!cancelled) setModalCandles(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setModalCandlesLoading(false); });
    return () => { cancelled = true; };
  }, [editing?.id]);
  useEffect(() => {
    setPage(1);
  }, [filter]);

  const getPages = () => {
    const pages: number[] = [];

    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    return pages;
  };

  const overlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999};

const panel = {
  width: 460,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  maxHeight: "90vh",
  overflowY: "auto" as const,
};

const box = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  padding: 10,
  borderRadius: 8,
  marginTop: 10,
  fontSize: 12,
  color: "var(--text-dim)"
};

const value = {
  color: "var(--text)",
  fontWeight: 700,
  fontSize: 14
};

const input = {
  flex: 1,
  padding: 8,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  width: "100%",
  color: "var(--text)"
};

const primary = {
  flex: 1,
  padding: 10,
  background: "#00d084",
  border: 0,
  borderRadius: 6,
  fontWeight: 700
};

const danger = {
  flex: 1,
  padding: 10,
  background: "#ff4757",
  border: 0,
  borderRadius: 6,
  fontWeight: 700,
  color: "#000"
};
  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div style={{ display: "flex", gap: 9, marginBottom: 13, flexWrap: "wrap", alignItems: "center" }}>
        {(["ALL", "BUY", "SELL"] as const).map(f => (
          <div key={f} style={{ background: filter === f ? "#00d08422" : "var(--surface)", border: `1px solid ${filter === f ? "#00d084" : "var(--border)"}`, color: filter === f ? "#00d084" : "var(--text-dim)", borderRadius: 7, padding: "6px 13px", cursor: "pointer", fontSize: 11 }} onClick={() => setFilter(f)}>{f}</div>
        ))}
        {[{ l: "P&L", v: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`, c: pnl >= 0 ? "#00d084" : "#ff4757" },
        { l: "Win %", v: `${settled.length > 0 ? ((wins / settled.length) * 100).toFixed(1) : 0}%`, c: "#0094ff" },
        { l: "Total", v: trades.length.toString(), c: "var(--text)" }].map(s => (
          <div key={s.l} style={{ display: "flex", gap: 7, alignItems: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>
            <span style={{ color: "var(--text-mute)" }}>{s.l}</span>
            <span style={{ color: s.c, fontWeight: 700 }}>{s.v}</span>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "70px 0", color: "var(--text-mute)" }}>
          <div style={{ fontSize: 44 }}>◫</div>
          <div style={{ color: "var(--text-mute)", marginTop: 10, fontSize: 13, fontWeight: 600 }}>No trades yet</div>
        </div>
      ) : (
        <div style={S.card}>
          <div style={{ overflowX: "auto" }}>
 

            {/* table of trades with columns time, pair, side, price, amount, total, fee, pnl, source (bot/manual), status (open/closed) , pop up view and edit plus pagination */}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["Time", "Pair", "Side", "Price", "Amount", "Total", "Fee", "P&L", "Source", "Reason", "Status"].map(h => (
                  <th key={h} style={{ color: "var(--text-mute)", fontSize: 8, fontWeight: 700, letterSpacing: 1.5, padding: "7px 11px", textAlign: "left", borderBottom: "1px solid var(--border)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {paginated.map(t => (
                  <tr key={t.id} onClick={() => setEditing(t)} style={{ background: editing?.id === t.id ? "#00d08411" : "transparent", cursor: "pointer" }}>
                    <td style={{ color: "var(--text-dim)", fontSize: 10, padding: "8px 11px", whiteSpace: "nowrap" }}>{new Date(ts(t)).toLocaleString()}</td>
                    <td style={{ color: "var(--text)", fontWeight: 700, fontSize: 11, padding: "8px 11px" }}>{PAIR_DISPLAY[t.pair] || t.pair}</td>
                    <td style={{ padding: "8px 11px" }}><span style={{ color: t.side === "BUY" ? "#00d084" : "#ff4757", fontWeight: 700, fontSize: 10 }}>{t.side}</span></td>
                    <td style={{ color: "var(--text-dim)", fontSize: 10, padding: "8px 11px", fontFamily: "monospace" }}>${t.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td style={{ color: "var(--text-dim)", fontSize: 10, padding: "8px 11px", fontFamily: "monospace" }}>{t.amount.toFixed(4)}</td>
                    <td style={{ color: "var(--text-dim)", fontSize: 10, padding: "8px 11px", fontFamily: "monospace" }}>${t.total.toFixed(2)}</td>
                    <td style={{ color: "var(--text-mute)", fontSize: 10, padding: "8px 11px", fontFamily: "monospace" }}>${t.fee.toFixed(4)}</td>
                    <td style={{ padding: "8px 11px" }}><span style={{ color: (t.pnl || 0) >= 0 ? "#00d084" : "#ff4757", fontSize: 10, fontWeight: 600, fontFamily: "monospace" }}>{(t.pnl || 0) >= 0 ? "+" : ""}${(t.pnl || 0).toFixed(4)}</span></td>
                    <td style={{ color: "var(--text-mute)", fontSize: 9, padding: "8px 11px" }}>{t.bot_id ? "Bot" : "Manual"}</td>
                    <td style={{ color: "var(--text-mute)", fontSize: 9, padding: "8px 11px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.reason || undefined}>
                      {t.reason || "—"}
                    </td>
                    <td style={{ fontSize: 9, padding: "8px 11px" }}>
                      <span style={{
                        fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                        background: t.status === "FILLED" ? "#0094ff18" : t.status === "CLOSED" ? "#2e406018" : "#ffd70018",
                        color: t.status === "FILLED" ? "#0094ff" : t.status === "CLOSED" ? "var(--text-dim)" : "#ffd700",
                      }}>{t.status === "FILLED" ? "ACTIVE" : t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          </div>
          {totalPages > 1 && (
            <div style={{
              display: "flex",
              gap: 6,
              justifyContent: "center",
              marginTop: 15,
              alignItems: "center"
            }}>

              {/* Prev */}
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={S.btn}
              >
                Prev
              </button>

              {/* First page always */}
              {page > 3 && (
                <>
                  <button style={S.btn} onClick={() => setPage(1)}>1</button>
                  <span style={{ color: "var(--text-dim)" }}>...</span>
                </>
              )}

              {/* Middle pages */}
              {getPages().map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    ...S.btn,
                    background: p === page ? "#00d084" : "var(--surface)",
                    color: p === page ? "#000" : "var(--text)",
                    borderColor: p === page ? "#00d084" : "var(--border)"
                  }}
                >
                  {p}
                </button>
              ))}

              {/* Last page always */}
              {page < totalPages - 2 && (
                <>
                  <span style={{ color: "var(--text-dim)" }}>...</span>
                  <button style={S.btn} onClick={() => setPage(totalPages)}>
                    {totalPages}
                  </button>
                </>
              )}

              {/* Next */}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={S.btn}
              >
                Next
              </button>

            </div>
          )}
        </div>
      )}

  {editing && (
  <div style={{position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999}} onClick={() => setEditing(null)} >
    
    <div onClick={e => e.stopPropagation()} style={panel}>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "var(--text)", fontWeight: 700 }}>
            {editing.pair}
          </div>
          <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
            {editing.bot_id ? "Bot Trade" : "Manual Trade"}
          </div>
        </div>

        <div style={{
          color: editing.status === "FILLED" ? "#00d084" : editing.status === "PENDING" ? "#ffd700" : "var(--text-dim)",
          fontWeight: 700
        }}>
          {editing.status}
        </div>
      </div>

      {/* "let every trade taken has a reason" — why this specific trade was
          entered, whether by a bot's strategy rule, copied from a signal,
          or placed manually. */}
      {editing.reason && (
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 11px", marginTop: 10, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.5 }}>
          <span style={{ color: "var(--text-mute)", fontWeight: 700, fontSize: 9, letterSpacing: 1 }}>REASON — </span>{editing.reason}
        </div>
      )}

      {/* CHART — how this trade is going, with entry/SL/TP marked */}
      <div style={{ height: 220, margin: "10px 0", borderRadius: 8, overflow: "hidden" }}>
        <ProChart
          candles={modalCandles}
          loading={modalCandlesLoading}
          trades={trades}
          symbol={editing.pair}
          timeframe="1h"
          timeframes={[]}
          height={220}
        />
      </div>

      {editing.status === "CLOSED" ? (
        // Closed trades are history — "show only chart no buttons" — so
        // just the read-only facts of how it played out, no editable SL/TP
        // and no Save/Close actions that could never apply to it anyway.
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ ...box, flex: 1, marginTop: 0 }}>
              <div>Entry Price</div>
              <div style={value}>${editing.price.toFixed(4)}</div>
            </div>
            <div style={{ ...box, flex: 1, marginTop: 0 }}>
              <div>Closed</div>
              <div style={value}>{editing.closed_at ? new Date(editing.closed_at * 1000).toLocaleString() : "—"}</div>
            </div>
          </div>
          <div style={box}>
            <div>Realized P&L</div>
            <div style={{ ...value, color: (editing.pnl || 0) >= 0 ? "#00d084" : "#ff4757" }}>
              {(editing.pnl || 0) >= 0 ? "+" : ""}${(editing.pnl || 0).toFixed(4)}
            </div>
          </div>
        </>
      ) : (
        // Active trade — "show all buttons" — full editable SL/TP plus
        // Save/Close actions.
        <>
          {/* LIVE PRICE */}
          <div style={box}>
            <div>Live Price</div>
            <div style={value}>
              ${ticker?.price?.toFixed(4) || "—"}
            </div>
          </div>

          {/* ENTRY */}
          <div style={box}>
            <div>Entry Price</div>
            <div style={value}>
              ${editing.price.toFixed(4)}
            </div>
          </div>

          {/* PNL */}
          <div style={box}>
            <div>Unrealized P&L</div>
            <div style={{
              ...value,
              color: (editing.pnl || 0) >= 0 ? "#00d084" : "#ff4757"
            }}>
              ${(editing.pnl || 0).toFixed(4)}
            </div>
          </div>

          {/* STOP LOSS / TAKE PROFIT */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Stop Loss"
              value={editing.stop_loss ?? ""}
              onChange={e =>
                setEditing({ ...editing, stop_loss: e.target.value === "" ? null : parseFloat(e.target.value) })
              }
              style={input}
              type="number"
            />

            <input
              placeholder="Take Profit"
              value={editing.take_profit ?? ""}
              onChange={e =>
                setEditing({ ...editing, take_profit: e.target.value === "" ? null : parseFloat(e.target.value) })
              }
              style={input}
              type="number"
            />
          </div>

          {/* ACTIONS */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>

            <button
              style={primary}
              onClick={async () => {
                if (!auth.token || savingEdit) return;
                setSavingEdit(true);
                try {
                  const updated = await tradesApi.updateTpSl(auth.token, editing.id, {
                    stop_loss: editing.stop_loss ?? undefined,
                    take_profit: editing.take_profit ?? undefined,
                  });
                  setTrades((prev: any[]) => prev.map(t => (t.id === updated.id ? updated : t)));
                  setEditing(null);
                  notify("Stop loss / take profit updated", "success");
                } catch (e: any) {
                  notify(e.message, "error");
                }
                setSavingEdit(false);
              }}
            >
              {savingEdit ? "Saving..." : "Save"}
            </button>

            <button
              style={danger}
              onClick={async () => {
                if (!auth.token || savingEdit) return;
                setSavingEdit(true);
                try {
                  const closed = await tradesApi.close(auth.token, editing.id);
                  setTrades((prev: any[]) => prev.map(t => (t.id === closed.id ? closed : t)));
                  if (typeof (closed as any).balance === "number") updateUser({ balance: (closed as any).balance });
                  setEditing(null);
                  notify(`Trade closed — realized P&L $${closed.pnl.toFixed(2)}`, "info");
                } catch (e: any) {
                  notify(e.message, "error");
                }
                setSavingEdit(false);
              }}
            >
              Close Trade
            </button>

          </div>
        </>
      )}

    </div>
  </div>
)}
    </div>
  );
}
