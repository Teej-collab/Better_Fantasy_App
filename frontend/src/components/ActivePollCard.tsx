"use client";

import { useEffect, useState } from "react";
import { listPolls, voteOnPoll, type Poll } from "@/lib/pollsApi";
import { NAV_ACCENT } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";

/**
 * Member-facing side of League Manager Polls (2026-09-03) — renders on
 * the League Overview page, where members already land, rather than
 * behind a nav tab (LeagueSubNav's row was just stabilized at a fixed
 * 3+3 this same session — no room for a 7th slot). Renders nothing at
 * all when there's no open poll, so it never adds empty chrome to a
 * league that isn't using this feature.
 */
export function ActivePollCard({ leagueId }: { leagueId: number }) {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [voteBusyId, setVoteBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setPolls(await listPolls(leagueId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load polls.");
    }
  }

  useEffect(() => {
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function vote(pollId: number, optionIndex: number) {
    setVoteBusyId(pollId);
    try {
      const updated = await voteOnPoll(leagueId, pollId, optionIndex);
      setPolls((prev) => (prev ? prev.map((p) => (p.id === pollId ? updated : p)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cast that vote.");
    } finally {
      setVoteBusyId(null);
    }
  }

  const openPolls = (polls ?? []).filter((p) => p.status === "open");
  if (openPolls.length === 0) return null;

  return (
    <div
      className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]"
      style={panelGlowStyle(NAV_ACCENT)}
    >
      <h2 className="text-sm font-semibold">League Poll</h2>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {openPolls.map((p) => {
        const total = p.results.reduce((a, b) => a + b, 0);
        return (
          <div key={p.id} className="flex flex-col gap-2">
            <p className="text-sm">{p.question}</p>
            <div className="flex flex-col gap-1.5">
              {p.options.map((opt, i) => {
                const isMine = p.my_vote === i;
                const pct = total > 0 ? Math.round((p.results[i] / total) * 100) : 0;
                return (
                  <button
                    key={i}
                    onClick={() => vote(p.id, i)}
                    disabled={voteBusyId === p.id}
                    className={`relative overflow-hidden rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60 ${
                      isMine
                        ? "border-[var(--wl-accent)] bg-[var(--wl-accent)]/10"
                        : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                    }`}
                  >
                    {p.my_vote !== null && (
                      <span
                        className="absolute inset-y-0 left-0 bg-black/5 dark:bg-white/5"
                        style={{ width: `${pct}%` }}
                        aria-hidden
                      />
                    )}
                    <span className="relative flex items-center justify-between gap-2">
                      <span>
                        {opt} {isMine && "✓"}
                      </span>
                      {p.my_vote !== null && (
                        <span className="tabular-nums text-black/50 dark:text-white/50">
                          {pct}% ({p.results[i]})
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
