// components/SmcDecisionPanel.tsx
//
// The Smart Money Concepts strategy's verdict on the NEWEST bar, with its
// working shown as a checklist: structure → sweep → zones → retest →
// decision. It renders `decision` from GET /market/smc, which is produced by
// smc.evaluate_entry() — the very function the bot (and its backtest) call —
// so this is the bot's actual reasoning for this pair/timeframe, not a
// separate estimate. Works whether or not any bot is running on the pair.
import { useState } from "react";
import type { SMCDecision, SMCDecisionStep } from "../types";

const ICON: Record<SMCDecisionStep["status"], { glyph: string; color: string }> = {
  pass: { glyph: "✓", color: "#00d084" },
  wait: { glyph: "○", color: "var(--text-dim)" },
  block: { glyph: "✕", color: "#ff4757" },
  info: { glyph: "•", color: "#0094ff" },
};

export default function SmcDecisionPanel({ decision }: { decision: SMCDecision | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!decision) return null;

  const buy = decision.type === "BUY";
  const color = buy ? "#00d084" : "var(--text-dim)";
  // Headline chips: one per condition the entry rule actually tests. SWEEP
  // and RETEST can also carry an informational line (a bearish sweep, a
  // bearish zone) — the chip should reflect the condition line, not that note.
  const chips = ["STRUCTURE", "SWEEP", "RETEST"]
    .map(name => decision.steps.find(s => s.step === name && (name === "STRUCTURE" || s.status !== "info")))
    .filter((s): s is SMCDecisionStep => !!s);

  return (
    <div style={{
      margin: "4px", borderRadius: 8, background: "var(--surface)", fontSize: 11,
      border: `1px solid ${buy ? "#00d08466" : "var(--border2)"}`, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "6px 10px", background: "transparent", border: "none", cursor: "pointer",
        color: "var(--text)", fontFamily: "inherit", fontSize: 11, textAlign: "left",
      }}>
        <b>SMC strategy</b>
        <span style={{
          fontWeight: 800, fontSize: 10, padding: "1px 7px", borderRadius: 4,
          background: buy ? "#00d084" : "transparent", color: buy ? "#000" : color,
          border: `1px solid ${buy ? "#00d084" : "var(--border2)"}`,
        }}>
          {buy ? `BUY ${decision.confidence}%` : "HOLD"}
        </span>
        {chips.map(s => (
          <span key={s.step} style={{ color: ICON[s.status].color, fontFamily: "monospace" }}>
            {ICON[s.status].glyph} {s.step.toLowerCase()}
          </span>
        ))}
        <span style={{ color: "var(--text-dim)", flex: 1, minWidth: 120 }}>{decision.reason}</span>
        <span style={{ color: "var(--text-dim)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--border2)", padding: "6px 10px 8px", fontFamily: "monospace" }}>
          {decision.steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0", lineHeight: 1.4 }}>
              <span style={{ color: ICON[s.status].color, width: 12, flexShrink: 0 }}>{ICON[s.status].glyph}</span>
              <span style={{ color: "var(--text-dim)", width: 74, flexShrink: 0 }}>{s.step}</span>
              <span style={{ color: s.status === "block" ? "#ff4757" : "var(--text)" }}>{s.message}</span>
            </div>
          ))}
          {buy && decision.invalidation != null && (
            <div style={{ color: "var(--text-dim)", paddingTop: 4 }}>
              Setup is invalidated below {decision.invalidation}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
