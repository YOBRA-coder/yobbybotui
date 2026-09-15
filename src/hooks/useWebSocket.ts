// hooks/useWebSocket.ts — Real-time WebSocket connection to Python backend

import { useEffect, useRef, useCallback, useState } from "react";
import type { WSMessage, Ticker, Bot, Trade, Signal, KlineMessage, KlineUpdate,  } from "../types";

// FIX: was hardcoded to "wss://cryptobotapi.onrender.com" — the same stale
// remote deployment as client.ts. Live prices, bot updates, new trades and
// signals were all coming from someone else's old hosted instance, never
// from the backend actually being run locally. Now derives from
// VITE_WS_URL, or from VITE_API_URL with http(s) swapped for ws(s), or
// finally localhost.
const envWs = import.meta.env.VITE_WS_URL as string | undefined;
const envApi = import.meta.env.VITE_API_URL as string | undefined;
const WS_BASE = envWs || (envApi ? envApi.replace(/^http/, "ws") : "ws://localhost:8000");
interface WSState {
  connected: boolean;
  reconnecting: boolean;
  lastPing: number;
}

interface WSHandlers {
  onTickers?: (tickers: Ticker[]) => void;
  onBotsUpdate?: (bots: Bot[]) => void;
  onNewTrade?: (trade: Trade) => void;
  onNewSignals?: (signals: Signal[]) => void;
  onBotError?: (data: { bot_id: string; message: string }) => void;
  onInit?: (data: { bots: Bot[]; trades: Trade[]; signals: Signal[] }) => void;
  onKline?: (msg: KlineUpdate) => {}; }

export function useWebSocket(token: string | null, handlers: WSHandlers) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WSState>({ connected: false, reconnecting: false, lastPing: 0 });
  const reconnectTimer = useRef<number>();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState(s => ({ ...s, reconnecting: true }));
    const ws = new WebSocket(`${WS_BASE}/ws/${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState({ connected: true, reconnecting: false, lastPing: Date.now() });
      console.log("[WS] Connected to NexusAI backend");
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        const h = handlersRef.current;
        switch (msg.type) {
          case "TICKERS":    h.onTickers?.(msg.data); break;
          case "BOTS_UPDATE": h.onBotsUpdate?.(msg.data); break;
          case "NEW_TRADE":  h.onNewTrade?.(msg.data); break;
          case "NEW_SIGNALS": h.onNewSignals?.(msg.data); break;
          case "BOT_ERROR": h.onBotError?.(msg.data); break;
          case "INIT":       h.onInit?.(msg.data); break;
          //case "KLINE": h.onKline?.(msg.data); break;
          case "PING":
            ws.send(JSON.stringify({ type: "PONG" }));
            setState(s => ({ ...s, lastPing: Date.now() }));
            break;
        }
      } catch (e) {
        console.warn("[WS] Parse error:", e);
      }
    };

    ws.onclose = (ev) => {
      setState(s => ({ ...s, connected: false }));
      console.log(`[WS] Disconnected (code=${ev.code})`);
      if (ev.code !== 4001) {
        // Auto-reconnect with backoff
        const delay = state.reconnecting ? 5000 : 2000;
        reconnectTimer.current = window.setTimeout(() => {
          setState(s => ({ ...s, reconnecting: true }));
          connect();
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error("[WS] Error:", err);
    };
  }, [token]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { ...state, send };
}
