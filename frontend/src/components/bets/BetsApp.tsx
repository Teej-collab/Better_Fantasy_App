"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AddBetFlow } from "@/components/bets/AddBetFlow";
import { BetCard } from "@/components/bets/BetCard";
import {
  deleteBet,
  listBets,
  setBetStatus,
  setLegStatus,
  shareBet,
  unshareBet,
  type Bet,
  type BetLegStatus,
  type BetStatus,
} from "@/lib/betsApi";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";

// My Bets: your tracked bets (open first), graded live. Private unless
// you share one — sharing posts it to league chat as a live card.
const LIVE_REFRESH_MS = 30_000;

export function BetsApp() {
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listBets();
      setEnabled(data.enabled);
      setBets(data.bets);
    } catch {
      setError("Couldn't load your bets.");
      setBets((b) => b ?? []);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  // Live legs move with the games: refresh while anything is open.
  const anyOpen = (bets ?? []).some((b) => b.status === "open");
  useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(load, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [anyOpen, load]);
  useOnAppRefresh(load);

  function replace(bet: Bet) {
    setBets((all) => (all ?? []).map((b) => (b.id === bet.id ? bet : b)));
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    }
  }

  if (bets === null) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;

  if (!enabled) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-xl font-semibold">Bet tracking is off</h1>
        <p className="max-w-sm text-sm text-black/60 dark:text-white/60">
          Turn it on in Settings to track your bets here and on the Gamecast.
        </p>
        <Link href="/settings?section=bets" className="rounded-full bg-[var(--wl-accent)] px-5 py-2 text-sm font-semibold text-black">
          Open Settings
        </Link>
      </div>
    );
  }

  const open = bets.filter((b) => b.status === "open");
  const settled = bets.filter((b) => b.status !== "open");
  const record = settled.reduce(
    (r, b) => ({ won: r.won + (b.status === "won" ? 1 : 0), lost: r.lost + (b.status === "lost" ? 1 : 0) }),
    { won: 0, lost: 0 }
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Bets</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Tracked live from the box score. Only you can see these unless you share one.
            {settled.length > 0 && ` Record: ${record.won}–${record.lost}.`}
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-full bg-[var(--wl-accent)] px-5 py-2 text-sm font-semibold text-black">
            + Add a bet
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {notice && <p className="text-sm text-emerald-500">{notice}</p>}

      {adding && (
        <AddBetFlow
          onCancel={() => setAdding(false)}
          onSaved={(bet) => {
            setAdding(false);
            setBets((all) => [bet, ...(all ?? [])]);
          }}
        />
      )}

      {bets.length === 0 && !adding && (
        <div className="wl-card flex flex-col items-center gap-2 rounded-xl p-8 text-center">
          <span className="text-3xl" aria-hidden>
            🧾
          </span>
          <p className="font-semibold">No bets yet</p>
          <p className="max-w-sm text-sm text-black/60 dark:text-white/60">
            Upload a screenshot of a bet slip from any sportsbook and every leg tracks live — on this page and on that game&apos;s Gamecast.
          </p>
        </div>
      )}

      {open.length > 0 && <BetList title="Open" bets={open} onChange={replace} onRemove={(id) => setBets((all) => (all ?? []).filter((b) => b.id !== id))} run={run} setNotice={setNotice} />}
      {settled.length > 0 && <BetList title="Settled" bets={settled} onChange={replace} onRemove={(id) => setBets((all) => (all ?? []).filter((b) => b.id !== id))} run={run} setNotice={setNotice} />}

      <p className="text-center text-xs text-black/40 dark:text-white/40">
        Weekend League only tracks bets — it never places them or touches money. 21+. If gambling stops being fun, call or text 1-800-GAMBLER.
      </p>
    </div>
  );
}

function BetList(props: {
  title: string;
  bets: Bet[];
  onChange: (bet: Bet) => void;
  onRemove: (id: number) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  setNotice: (n: string | null) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{props.title}</h2>
      {props.bets.map((bet) => (
        <BetCard key={bet.id} bet={bet} footer={<BetActions bet={bet} {...props} />} />
      ))}
    </section>
  );
}

function BetActions({
  bet,
  onChange,
  onRemove,
  run,
  setNotice,
}: {
  bet: Bet;
  onChange: (bet: Bet) => void;
  onRemove: (id: number) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  setNotice: (n: string | null) => void;
}) {
  const [menu, setMenu] = useState(false);
  const untracked = bet.legs.filter((l) => !l.tracked && l.status === "open");
  return (
    <div className="flex flex-col gap-2 border-t border-black/5 pt-2 dark:border-white/5">
      {untracked.map((leg) => (
        <div key={leg.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-black/50 dark:text-white/50">Mark &ldquo;{leg.description}&rdquo;:</span>
          {(["won", "lost", "push"] as BetLegStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => run(async () => onChange(await setLegStatus(bet.id, leg.id, s)))}
              className="rounded-full border border-black/10 px-2 py-0.5 capitalize hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              {s}
            </button>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            run(async () => {
              if (bet.shared) {
                await unshareBet(bet.id);
                onChange({ ...bet, shared: false });
                setNotice("Back to private — the chat card now says it's no longer shared.");
              } else {
                const res = await shareBet(bet.id);
                onChange({ ...bet, shared: true });
                setNotice(res.posted ? "Shared to league chat." : "Shared with the league again.");
              }
            })
          }
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            bet.shared ? "bg-[var(--wl-accent)]/15 text-[var(--wl-accent-dim)]" : "border border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          }`}
          aria-pressed={bet.shared}
        >
          {bet.shared ? "✓ Shared with league" : "Share to league"}
        </button>
        <div className="relative ml-auto">
          <button type="button" onClick={() => setMenu((m) => !m)} className="rounded-full px-3 py-1 text-xs text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10" aria-expanded={menu}>
            More ▾
          </button>
          {menu && (
            <div className="absolute right-0 bottom-full z-20 mb-1 flex w-48 flex-col overflow-hidden rounded-lg border border-black/10 bg-white text-sm shadow-lg dark:border-white/10 dark:bg-[var(--wl-surface)]">
              {(["won", "lost", "cashed_out", "void"] as BetStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    run(async () => onChange(await setBetStatus(bet.id, s)));
                  }}
                  className="px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Mark {s === "cashed_out" ? "cashed out" : s}
                </button>
              ))}
              {bet.status_set_manually && (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    run(async () => onChange(await setBetStatus(bet.id, "auto")));
                  }}
                  className="px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Grade automatically
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  if (!window.confirm("Delete this bet?")) return;
                  run(async () => {
                    await deleteBet(bet.id);
                    onRemove(bet.id);
                  });
                }}
                className="px-3 py-2 text-left text-red-500 hover:bg-black/5 dark:hover:bg-white/10"
              >
                Delete bet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
