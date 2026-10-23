"use client";

import { useEffect, useState } from "react";
import { commishApi, type CommishChange } from "@/lib/commishApi";

// What the commissioner has changed (2026-10-23, backend app/domain/
// commish_log.py), on League Activity, unless the commissioner made the
// log private. Same as the app's CommishChanges in
// mobile/src/components/league/Sections.tsx.
export function CommishChanges() {
  const [changes, setChanges] = useState<CommishChange[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    commishApi
      .leagueChanges()
      .then((d) => setChanges(d.public ? d.changes : []))
      .catch(() => setChanges([]));
  }, []);

  if (changes.length === 0) return null;
  const shown = all ? changes : changes.slice(0, 5);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-extrabold tracking-widest text-black/55 uppercase dark:text-white/55">Commissioner changes</h2>
      <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
        {shown.map((c) => (
          <li key={c.id} className="flex flex-col px-4 py-2.5">
            <span className="text-sm font-semibold">{c.summary}</span>
            <span className="text-xs text-black/55 dark:text-white/55">
              {c.actor_name} · {new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </li>
        ))}
      </ul>
      {changes.length > 5 && !all && (
        <button type="button" onClick={() => setAll(true)} className="self-center rounded-full border border-black/15 px-4 py-1.5 text-sm font-semibold dark:border-white/15">
          Show all {changes.length}
        </button>
      )}
    </section>
  );
}
