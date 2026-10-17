// pages/MarketPage.tsx — every pair, scanned with the same top-down engine.
import { useNavigate } from "react-router-dom";
import { useMtf } from "../context/MtfContext";
import { PAIR_DISPLAY } from "../types";
import { fmtPrice } from "../components/MtfChart";
import { DOWN, UP, Pill, STATE_META, biasColor, card, cardHead } from "../components/ui";

export default function MarketPage() {
  const { rows, setSymbol, symbol, entryTf, minAgree } = useMtf();
  const nav = useNavigate();
  const th = { textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--text-mute)", padding: "6px 8px", textTransform: "uppercase", whiteSpace: "nowrap" } as const;
  const td = { padding: "8px", borderTop: "1px solid var(--border)", fontSize: 11.5, whiteSpace: "nowrap" } as const;
  return (
    <div style={card}>
      <div style={cardHead}>Market scanner · entry {entryTf.toUpperCase()} · min agreement {minAgree}%</div>
      {!rows.length && <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Scanning all pairs…</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr><th style={th}>Pair</th><th style={th}>Price</th><th style={th}>24h</th><th style={th}>Bias</th><th style={th}>State</th><th style={th}>Agree</th><th style={th}>Grade</th><th style={th}>What it needs</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.symbol} onClick={() => { setSymbol(r.symbol); nav("/"); }} style={{ cursor: "pointer", background: r.symbol === symbol ? "var(--surface)" : undefined }}>
                <td style={{ ...td, fontWeight: 800 }}>{PAIR_DISPLAY[r.symbol] || r.symbol}</td>
                <td style={td}>{r.price != null ? fmtPrice(r.price) : "–"}</td>
                <td style={{ ...td, color: (r.changePct ?? 0) >= 0 ? UP : DOWN }}>{r.changePct != null ? `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%` : "–"}</td>
                <td style={{ ...td, color: biasColor(r.direction), fontWeight: 700 }}>{r.direction}</td>
                <td style={td}><Pill color={STATE_META[r.state].color}>{r.state === "SIGNAL" ? r.type : r.state.replace("_", " ")}</Pill></td>
                <td style={td}>{r.agreement}%</td>
                <td style={td}>{r.grade}</td>
                <td style={{ ...td, whiteSpace: "normal", color: "var(--text-dim)", fontSize: 10.5, minWidth: 220 }}>{r.watch}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--text-mute)", marginTop: 8 }}>Click a pair to open it on the dashboard.</div>
    </div>
  );
}
