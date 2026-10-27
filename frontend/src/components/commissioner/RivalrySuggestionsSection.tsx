"use client";

import { useEffect, useState } from "react";
import { getMyLeagues, type League } from "@/lib/leaguesApi";
import {
  approveRivalry,
  dismissRivalry,
  listRivalrySuggestions,
  type RivalrySuggestion,
} from "@/lib/rivalriesApi";

/** Rivalries the league's history suggests (2026-10-27, backend
 * app/domain/rivalry_detection.py). The commissioner edits the name and
 * tagline, then makes it official or dismisses it for good. Same as the
 * app's mobile/src/app/commissioner/rivalries.tsx. */
export function RivalrySuggestionsSection() {
  const [league, setLeague] = useState<League | null>(null);
  const [suggestions, setSuggestions] = useState<RivalrySuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { leagues, activeLeagueId } = await getMyLeagues();
      const active = leagues.find((l) => l.id === activeLeagueId) ?? null;
      setLeague(active);
      if (!active) return;
      setSuggestions(await listRivalrySuggestions(active.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load suggestions.");
    }
  }

  useEffect(() => {
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, []);

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
      {suggestions === null ? (
        <p className="text-sm text-black/50 dark:text-white/50">Looking through your league&apos;s history…</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">
          No new rivalries to review. New ones show up here as your league plays more games.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              leagueId={league.id}
              suggestion={s}
              onDone={refresh}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({
  leagueId,
  suggestion: s,
  onDone,
  onError,
}: {
  leagueId: number;
  suggestion: RivalrySuggestion;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(s.suggested_name ?? `${s.owner_a_name} vs ${s.owner_b_name}`);
  const [tagline, setTagline] = useState(s.suggested_tagline ?? "");
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);

  async function act(kind: "approve" | "dismiss") {
    setBusy(kind);
    try {
      if (kind === "approve") await approveRivalry(leagueId, s.id, name.trim(), tagline.trim());
      else await dismissRivalry(leagueId, s.id);
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save that.");
      setBusy(null);
    }
  }

  return (
    <li className="neon-panel flex flex-col gap-3 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {s.owner_a_name} <span className="text-black/40 dark:text-white/40">vs</span> {s.owner_b_name}
        </span>
        <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
          {s.tier}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 text-sm text-black/70 dark:text-white/70">
        {s.reasons.map((reason) => (
          <li key={reason}>· {reason}</li>
        ))}
      </ul>
      <label className="flex flex-col gap-1 text-xs text-black/50 dark:text-white/50">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm text-current dark:border-white/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-black/50 dark:text-white/50">
        Tagline
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={200}
          placeholder="Optional"
          className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm text-current dark:border-white/10"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => act("approve")}
          disabled={busy !== null || !name.trim()}
          className="rounded-full bg-[var(--wl-accent-dim)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy === "approve" ? "Saving…" : "Make it official"}
        </button>
        <button
          onClick={() => act("dismiss")}
          disabled={busy !== null}
          className="rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
        >
          {busy === "dismiss" ? "Dismissing…" : "Not a rivalry"}
        </button>
      </div>
    </li>
  );
}
