import { useCallback, useEffect, useRef, useState } from "react";
import { marketApi } from "../api/client";
import type { MtfMode, MtfResponse } from "../types";

/** Polls the top-down read for one pair. Keeps the last good answer on screen while refreshing. */
export function useMtf(symbol: string, tfs: string[], entryTf: string, mode?: MtfMode, everyMs = 20_000) {
  const [data, setData] = useState<MtfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState(0);
  const key = `${symbol}|${tfs.join(",")}|${entryTf}|${mode ?? ""}`;
  const keyRef = useRef(key);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    try {
      const r = await marketApi.mtf(symbol, { tfs, entry_tf: entryTf, mode }, c.signal);
      if (c.signal.aborted) return;
      if (!r.ok) { setError(r.error ?? "No data"); }
      else { setData(r); setError(null); setUpdated(Date.now()); }
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (keyRef.current !== key) { keyRef.current = key; }
    load();
    const t = setInterval(load, everyMs);
    return () => { clearInterval(t); ctl.current?.abort(); };
  }, [key, load, everyMs]);

  return { data, error, loading, updated, reload: load };
}
