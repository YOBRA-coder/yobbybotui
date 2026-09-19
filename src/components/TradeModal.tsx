import { useMemo, useState } from "react"
import { S } from "../pages/styles"
import { tradesApi } from "../api/client"
import { useAuth } from "../context/AuthContext"
import type { Trade } from "../types"

interface TradeModalProps {
  trade: Trade;
  currentPrice: number;
  token: string | null;
  onClose: () => void;
  onUpdate: (updated: Trade) => void;
  notify?: (msg: string, kind: "success" | "error" | "info") => void;
  // Closing a LIVE trade (or placing/replacing its exchange OCO) moves
  // real Binance balance — this lets the caller refresh the top-bar
  // equity/P&L pill immediately instead of it sitting stale until the
  // next scheduled poll.
  onAccountChange?: () => void;
}

export default function TradeModal({ trade, currentPrice, token, onClose, onUpdate, notify, onAccountChange }: TradeModalProps) {

  const { updateUser } = useAuth();
  const [tp, setTp] = useState(trade.take_profit != null ? String(trade.take_profit) : "")
  const [sl, setSl] = useState(trade.stop_loss != null ? String(trade.stop_loss) : "")
  const [busy, setBusy] = useState(false)

  const pnl = useMemo(() => {
    if (trade.status === "CLOSED") return trade.pnl;
    return trade.side === "BUY"
      ? (currentPrice - trade.price) * trade.amount
      : (trade.price - currentPrice) * trade.amount
  }, [trade, currentPrice])

  const modal = { background: "var(--border2)", borderRadius: 12, padding: 20, maxWidth: 400, width: "90%" }
  const header = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }
  const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }
  const input = {
    flex: 1,
    padding: 8,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    width: "100%",
    color: "var(--text)",
    marginBottom: 8,
  };

  const notifySafe = (msg: string, kind: "success" | "error" | "info") => notify?.(msg, kind);

  const handleUpdate = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      const updated = await tradesApi.updateTpSl(token, trade.id, {
        stop_loss: sl === "" ? undefined : parseFloat(sl),
        take_profit: tp === "" ? undefined : parseFloat(tp),
      });
      onUpdate(updated);
      if (trade.live) onAccountChange?.();
      notifySafe(
        updated.sl_tp_venue === "EXCHANGE"
          ? "Stop loss / take profit updated and placed on Binance"
          : trade.live
            ? "Stop loss / take profit updated — monitored by the app, not resting on Binance"
            : "Stop loss / take profit updated",
        "success",
      );
      onClose();
    } catch (e: any) {
      notifySafe(e.message || "Failed to update trade", "error");
    }
    setBusy(false);
  };

  const handleClose = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      const closed = await tradesApi.close(token, trade.id);
      onUpdate(closed);
      if (typeof (closed as any).balance === "number") updateUser({ balance: (closed as any).balance });
      if (trade.live) onAccountChange?.();
      notifySafe(`Position closed — realized P&L $${closed.pnl.toFixed(2)}`, "info");
      onClose();
    } catch (e: any) {
      notifySafe(e.message || "Failed to close trade", "error");
    }
    setBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>

        <div style={header}>
          <div>
            <div style={{ fontWeight: 800 }}>
              {trade.pair}
            </div>

            <div style={{
              color: trade.side === "BUY"
                ? "#00d084"
                : "#ff4757"
            }}>
              {trade.side} · {trade.status}
            </div>
          </div>

          <button onClick={onClose} style={S.btnO}>
            ✕
          </button>
        </div>

        {/* Real money vs paper, and — for a live trade — whether the exits
            are actually resting on Binance or only being watched by this
            app. Both were previously invisible here, so a live position and
            a demo one looked identical in the one dialog you use to close
            them. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: "3px 8px", borderRadius: 4,
            background: trade.live ? "#ffd70018" : "var(--surface2)",
            border: `1px solid ${trade.live ? "#ffd70055" : "var(--border)"}`,
            color: trade.live ? "#ffd700" : "var(--text-mute)",
          }}>{trade.live ? "LIVE · BINANCE" : "DEMO"}</span>
          {trade.live && trade.status !== "CLOSED" && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 1, padding: "3px 8px", borderRadius: 4,
              background: trade.exchange_order_list_id ? "#00d08415" : "#ff475715",
              border: `1px solid ${trade.exchange_order_list_id ? "#00d08455" : "#ff475755"}`,
              color: trade.exchange_order_list_id ? "#00d084" : "#ff4757",
            }}>
              {trade.exchange_order_list_id ? "STOP ON EXCHANGE" : "APP-MONITORED STOP"}
            </span>
          )}
        </div>

        {trade.live && trade.status !== "CLOSED" && !trade.exchange_order_list_id && (
          <div style={{
            background: "#ff475710", border: "1px solid #ff475740", borderRadius: 8,
            padding: "8px 11px", marginBottom: 14, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.5,
          }}>
            This position's stop and target are not resting on Binance — they only trigger while this app's
            backend is running. Set BOTH a stop loss and a take profit below to place a real exchange order.
            {trade.exchange_exit_error && (
              <div style={{ color: "#ff4757", marginTop: 5 }}>Binance said: {trade.exchange_exit_error}</div>
            )}
          </div>
        )}

        {trade.reason && (
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 11px", marginBottom: 14, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.5 }}>
            <span style={{ color: "var(--text-mute)", fontWeight: 700, fontSize: 9, letterSpacing: 1 }}>REASON — </span>{trade.reason}
          </div>
        )}

        <div style={grid}>
          <Stat label="Entry" value={trade.price.toFixed(2)} />
          <Stat label="Current" value={currentPrice.toFixed(2)} />
          <Stat label="Amount" value={trade.amount} />
          <Stat
            label={trade.status === "CLOSED" ? "Realized PnL" : "Unrealized PnL"}
            value={pnl.toFixed(2)}
            color={pnl >= 0 ? "#00d084" : "#ff4757"}
          />
        </div>

        {trade.status !== "CLOSED" && (
          <div style={{ marginTop: 16 }}>

            <input
              placeholder="Take Profit"
              value={tp}
              onChange={e => setTp(e.target.value)}
              style={input}
              type="number"
            />

            <input
              placeholder="Stop Loss"
              value={sl}
              onChange={e => setSl(e.target.value)}
              style={input}
              type="number"
            />

            <button style={S.btn} onClick={handleUpdate} disabled={busy}>
              {busy ? "Updating..." : "Update Trade"}
            </button>

            <button style={{ ...S.danger, marginTop: 8 }} onClick={handleClose} disabled={busy}>
              {busy ? "Closing..." : "Close Position"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: any) {
  return (
    <div style={{
      background: "var(--surface2)",
      padding: 10,
      borderRadius: 8
    }}>
      <div style={{
        color: "var(--text-dim)",
        fontSize: 11
      }}>
        {label}
      </div>

      <div style={{
        color: color || "#fff",
        fontWeight: 700
      }}>
        {value}
      </div>
    </div>
  )
}
