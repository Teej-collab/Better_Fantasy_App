"use client";

import { useCallback, useEffect, useState } from "react";
import { approveTv, disconnectTv, listTvs, type PairedTv } from "@/lib/tvApi";

const ACCENT = { background: "var(--user-accent, var(--wl-accent))" };

/**
 * Connect a TV (2026-11-14, The Weekend TV): type the code your
 * Chromecast shows and it signs in as you, watch-only. Also the list of
 * connected TVs, each one disconnectable on its own. The TV's QR code
 * opens this page with ?c=<code> filled in.
 */
export default function ConnectTvPage() {
  const [code, setCode] = useState("");
  const [tvs, setTvs] = useState<PairedTv[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => setTvs(await listTvs()), []);

  useEffect(() => {
    const fromQr = new URLSearchParams(window.location.search).get("c");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromQr) setCode(fromQr.toUpperCase());
    refresh().catch(() => setError("Couldn't load your TVs. Are you signed in?"));
  }, [refresh]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { device_name } = await approveTv(code);
      setDone(`${device_name} is connected. It'll go live in a few seconds.`);
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(tv: PairedTv) {
    if (!window.confirm(`Disconnect ${tv.name}? It'll need a new code to come back.`)) return;
    try {
      await disconnectTv(tv.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again in a moment.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Connect a TV</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Open The Weekend on your TV and type the code it shows. The TV can only watch: no lineups, trades or chat.
        </p>
      </div>

      <form onSubmit={connect} className="flex flex-col gap-3">
        <label htmlFor="tv-code" className="text-xs font-bold uppercase tracking-widest text-black/50 dark:text-white/50">
          Code on your TV
        </label>
        <input
          id="tv-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="K7QM-4XPR"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          className="rounded-lg border border-black/10 bg-transparent px-3 py-3 font-mono text-2xl tracking-[0.3em] dark:border-white/10"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-full px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
          style={ACCENT}
        >
          {busy ? "Connecting…" : "Connect TV"}
        </button>
        {done && <p className="text-sm text-green-600 dark:text-green-400">{done}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-black/50 dark:text-white/50">Your TVs</h2>
        {tvs === null ? (
          <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>
        ) : tvs.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No TVs connected.</p>
        ) : (
          tvs.map((tv) => (
            <div key={tv.id} className="flex items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
              <div className="flex-1">
                <p className="font-semibold">{tv.name}</p>
                <p className="text-xs text-black/50 dark:text-white/50">
                  Connected {new Date(tv.created_at).toLocaleDateString()}
                  {tv.last_seen_at ? ` · last on ${new Date(tv.last_seen_at).toLocaleString()}` : ""}
                </p>
              </div>
              <button
                onClick={() => disconnect(tv)}
                className="shrink-0 rounded-full border border-black/10 px-3.5 py-1.5 text-xs font-bold text-red-500 dark:border-white/10"
              >
                Disconnect
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
