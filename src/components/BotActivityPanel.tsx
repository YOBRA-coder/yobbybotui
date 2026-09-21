// components/BotActivityPanel.tsx
//
// Live "what is the bot doing, and why" feed. Every bot cycle the backend
// writes one row per process step — SCAN → STRUCTURE → SWEEP → ZONES →
// RETEST → DECISION, then whichever gate stopped a trade (GATE) or the
// ORDER / ENTRY / EXIT that followed (backend/app/services/botlog.py).
// This panel polls that feed and shows it, newest first.
//
// Two ways to use it:
//   <BotActivityPanel token={t} pair="BTCUSDT" bots={bots} />   // chart: every bot on this pair
//   <BotActivityPanel token={t} botId={id} />                    // bot page: just that bot
import { useEffect, useMemo, useRef, useState } from "react";
import { botsApi } from "../api/client";
import type { Bot, BotLog } from "../types";

interface Props {
  token: string | null;
  pair?: string;
  botId?: string;
  bots?: Pick<Bot, "id" | "name">[];
  /** Height of the scrolling list. */
  height?: number;
  /** Start expanded (the chart starts it collapsed to leave room for candles). */
  defaultOpen?: boolean;
  /** Hide the collapse header — for a page where the log IS the content. */
  alwaysOpen?: boolean;
}

const POLL_MS = 4000;
const MAX_ROWS = 400;

const STEP_COLOR: Record<string, string> = {
  SCAN: "#6b7a90",
  DATA: "#6b7a90",
  STRUCTURE: "#0094ff",
  SWEEP: "#b57bff",
  ZONES: "#00b8d9",
  RETEST: "#ffb020",
  DECISION: "#00d084",
  GATE: "#ff9f43",
  ORDER: "#ff9f43",
  ENTRY: "#00d084",
  EXIT: "#ffd700",
  ERROR: "#ff4757",
};
const LEVEL_TEXT: Record<BotLog["level"], string> = {
  info: "var(--text-dim)",
  ok: "#00d084",
  warn: "#ffb020",
  error: "#ff4757",
};

// Steps that describe how the bot READ the market vs. what it DID about it.
const PROCESS_STEPS = new Set(["SCAN", "DATA", "STRUCTURE", "SWEEP", "ZONES", "RETEST", "DECISION"]);

type Filter = "all" | "process" | "actions";

function clock(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour12: false });
}

export default function BotActivityPanel({
  token, pair, botId, bots = [], height = 190, defaultOpen = false, alwaysOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen);
  const [rows, setRows] = useState<BotLog[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastId = useRef(0);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bots) m.set(b.id, b.name);
    return m;
  }, [bots]);

  // Reset when the thing being watched changes.
  useEffect(() => {
    setRows([]);
    setLoaded(false);
    setError(null);
    lastId.current = 0;
  }, [pair, botId, token]);

  // Poll. Runs while the panel is open OR collapsed — the count in the
  // header should stay live either way — but stops when there's no token.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = botId
          ? await botsApi.logs(token, botId, { sinceId: lastId.current, limit: lastId.current ? 200 : 250 })
          : await botsApi.logsFeed(token, { pair, sinceId: lastId.current, limit: lastId.current ? 200 : 250 });
        if (cancelled) return;
        setError(null);
        setLoaded(true);
        if (fresh.length) {
          lastId.current = Math.max(lastId.current, ...fresh.map(r => r.id));
          setRows(prev => [...prev, ...fresh].slice(-MAX_ROWS));
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoaded(true);
          setError(e?.message || "Could not load the bot log");
        }
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, pair, botId]);

  const shown = useMemo(() => {
    const filtered = rows.filter(r =>
      filter === "all" ? true : filter === "process" ? PROCESS_STEPS.has(r.step) : !PROCESS_STEPS.has(r.step)
    );
    return filtered.slice().reverse(); // newest first
  }, [rows, filter]);

  if (!token) return null;

  const last = rows[rows.length - 1];
  const multiBot = !botId && new Set(rows.map(r => r.bot_id)).size > 1;

  return (
    <div style={{
      margin: "4px", borderRadius: 8, background: "var(--surface)",
      border: "1px solid var(--border2)", fontSize: 11, overflow: "hidden",
    }}>
      {!alwaysOpen && (
        <button onClick={() => setOpen(o => !o)} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
          background: "transparent", border: "none", cursor: "pointer", color: "var(--text)",
          fontFamily: "inherit", fontSize: 11, textAlign: "left",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: error ? "#ff4757" : "#00d084", flexShrink: 0 }} />
          <b>Bot activity</b>
          <span style={{ color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
            {error
              ? "unavailable"
              : last
                ? `${clock(last.ts)} · ${last.step} · ${last.message}`
                : loaded ? "no activity yet" : "loading…"}
          </span>
          <span style={{ color: "var(--text-dim)" }}>{open ? "▾" : "▸"}</span>
        </button>
      )}

      {open && (
        <div style={{ borderTop: alwaysOpen ? "none" : "1px solid var(--border2)" }}>
          <div style={{ display: "flex", gap: 6, padding: "6px 10px", alignItems: "center" }}>
            {([["all", "All"], ["process", "How it read the market"], ["actions", "Orders & gates"]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                padding: "2px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                background: filter === k ? "#0094ff22" : "transparent",
                color: filter === k ? "#0094ff" : "var(--text-dim)",
                border: `1px solid ${filter === k ? "#0094ff" : "var(--border2)"}`,
              }}>{label}</button>
            ))}
            <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>
              {rows.length} events · updates every {POLL_MS / 1000}s
            </span>
          </div>

          <div style={{ maxHeight: height, overflowY: "auto", padding: "0 10px 8px", fontFamily: "monospace" }}>
            {error && (
              <div style={{ color: "#ff9f43", padding: "6px 0" }}>
                Couldn't load the bot log: {error}. If the backend was updated, restart it so the new
                <code> bot_logs </code> table and endpoints exist.
              </div>
            )}
            {!error && shown.length === 0 && (
              <div style={{ color: "var(--text-dim)", padding: "6px 0", fontFamily: "inherit" }}>
                {loaded
                  ? "Nothing logged yet. A RUNNING or PAUSED bot writes its first entries on its next cycle (every ~15s)."
                  : "Loading…"}
              </div>
            )}
            {shown.map(r => (
              <div key={r.id} style={{ display: "flex", gap: 8, padding: "2px 0", alignItems: "baseline", lineHeight: 1.4 }}>
                <span style={{ color: "var(--text-mute, var(--text-dim))", flexShrink: 0 }}>{clock(r.ts)}</span>
                <span style={{
                  flexShrink: 0, minWidth: 66, textAlign: "center", fontSize: 9, fontWeight: 700, borderRadius: 3,
                  padding: "0 4px", color: STEP_COLOR[r.step] ?? "var(--text-dim)",
                  border: `1px solid ${(STEP_COLOR[r.step] ?? "#6b7a90")}55`,
                }}>{r.step}</span>
                {multiBot && (
                  <span style={{ color: "#0094ff", flexShrink: 0, fontSize: 10 }}>{nameById.get(r.bot_id) ?? "Bot"}</span>
                )}
                <span style={{ color: LEVEL_TEXT[r.level] ?? "var(--text-dim)", wordBreak: "break-word" }}>{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
