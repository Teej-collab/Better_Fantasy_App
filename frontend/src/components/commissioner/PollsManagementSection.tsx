"use client";

import { useEffect, useState } from "react";
import { getMyLeagues, type League } from "@/lib/leaguesApi";
import { closePoll, createPoll, listPolls, type Poll } from "@/lib/pollsApi";

/** Commissioner-side of League Manager Polls (2026-09-03) — create,
 * watch live results, close. Members vote from the compact
 * ActivePollCard on the League Overview page instead, not here. */
export function PollsManagementSection() {
  const [league, setLeague] = useState<League | null>(null);
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [createBusy, setCreateBusy] = useState(false);
  const [closeBusyId, setCloseBusyId] = useState<number | null>(null);

  async function refresh() {
    try {
      const { leagues, activeLeagueId } = await getMyLeagues();
      const active = leagues.find((l) => l.id === activeLeagueId) ?? null;
      setLeague(active);
      if (!active) return;
      setPolls(await listPolls(active.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load polls.");
    }
  }

  useEffect(() => {
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, []);

  async function submitCreate() {
    if (!league) return;
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOptions.length < 2) return;
    setCreateBusy(true);
    try {
      await createPoll(league.id, question.trim(), cleanOptions);
      setQuestion("");
      setOptions(["", ""]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that poll.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitClose(pollId: number) {
    if (!league) return;
    setCloseBusyId(pollId);
    try {
      await closePoll(league.id, pollId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't close that poll.");
    } finally {
      setCloseBusyId(null);
    }
  }

  if (league === null) {
    return error ? <p className="text-sm text-red-500">{error}</p> : null;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
        <h3 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          New poll
        </h3>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask your league a question…"
          className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
        />
        {options.map((opt, i) => (
          <input
            key={i}
            value={opt}
            onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
            placeholder={`Option ${i + 1}`}
            className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
          />
        ))}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOptions((prev) => [...prev, ""])}
            className="w-fit rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          >
            + Add option
          </button>
          <button
            onClick={submitCreate}
            disabled={createBusy || !question.trim() || options.map((o) => o.trim()).filter(Boolean).length < 2}
            className="w-fit rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {createBusy ? "Creating…" : "Create poll"}
          </button>
        </div>
      </div>

      {polls === null || polls.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No polls yet.</p>
      ) : (
        <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
          {polls.map((p) => {
            const total = p.results.reduce((a, b) => a + b, 0);
            return (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.question}{" "}
                    <span className="text-xs text-black/50 dark:text-white/50">
                      {p.status === "closed" ? "· Closed" : "· Open"}
                    </span>
                  </span>
                  {p.status === "open" && (
                    <button
                      onClick={() => submitClose(p.id)}
                      disabled={closeBusyId === p.id}
                      className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
                    >
                      {closeBusyId === p.id ? "Closing…" : "Close"}
                    </button>
                  )}
                </div>
                <ul className="flex flex-col gap-1">
                  {p.options.map((opt, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs text-black/70 dark:text-white/70">
                      <span>{opt}</span>
                      <span className="tabular-nums text-black/50 dark:text-white/50">
                        {p.results[i]} {p.results[i] === 1 ? "vote" : "votes"}
                        {total > 0 ? ` (${Math.round((p.results[i] / total) * 100)}%)` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
