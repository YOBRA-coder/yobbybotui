// pages/shared.ts — Shared page props type
import type { Ticker, Signal, Bot, Trade, Strategy } from "../types";

export interface PageProps {
  tickers: Ticker[];
  signals: Signal[];
  setSignals: React.Dispatch<React.SetStateAction<Signal[]>>;
  bots: Bot[];
  setBots: React.Dispatch<React.SetStateAction<Bot[]>>;
  trades: Trade[];
  setTrades: React.Dispatch<React.SetStateAction<Trade[]>>;
  strategies: Strategy[];
  setStrategies: React.Dispatch<React.SetStateAction<Strategy[]>>;
  notify: (msg: string, type?: "success" | "error" | "info") => void;
  // Forces an immediate re-pull of Binance equity/live P&L instead of
  // waiting for the top bar's own 30s poll — call this right after any
  // action that could move real exchange balance (a live order, a live
  // close) so the pill reflects it within the same second, not up to 30s
  // later.
  refreshAccount: () => Promise<void>;
}
