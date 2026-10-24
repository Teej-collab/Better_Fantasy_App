"use client";

import { useEffect, useState } from "react";
import { getLeagueSwitch, type LeagueSwitchStatus } from "@/lib/leaguesApi";

// Mirror mode (2026-10-24, backend app/domain/league_mode.py): a league
// still on ESPN/Sleeper. Roster moves are locked here and copied over from
// there, so say so where people would try to make one. Same as the app's.
export function MirrorBanner() {
  const [s, setS] = useState<LeagueSwitchStatus | null>(null);
  useEffect(() => {
    getLeagueSwitch()
      .then(setS)
      .catch(() => setS(null));
  }, []);
  if (!s?.mirrored) return null;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-2xl border border-sky-400/50 bg-sky-400/10 p-4">
      <strong className="text-sm">Your league runs on {s.platform_name} for now</strong>
      <span className="text-sm text-black/70 dark:text-white/75">
        Make lineup moves, adds, drops and trades there. They show up here within a few minutes.
        {s.pending ? ` Moving to The Weekend for good in Week ${s.pending.effective_week}.` : ""}
      </span>
    </div>
  );
}
