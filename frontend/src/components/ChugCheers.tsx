"use client";

import { useState } from "react";
import { toggleChugCheers, type ChugFeedEntry } from "@/lib/api";

type Cheer = { owner_id: number; name: string };

// "A, B and 3 others"
function cheeredBy(cheers: Cheer[]): string {
  const names = cheers.map((c) => c.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

// Cheers on a chug (2026-11-09): we watched it, we liked it. Your own
// chug shows who cheered it, with no button. The app's twin is
// mobile/src/components/ChugCheers.tsx.
export function ChugCheers({ chug, className = "" }: { chug: ChugFeedEntry; className?: string }) {
  const [cheers, setCheers] = useState<Cheer[]>(chug.cheers ?? []);
  const [cheered, setCheered] = useState(chug.cheered ?? false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !cheered;
    setCheered(next);
    setBusy(true);
    try {
      const res = await toggleChugCheers(chug.id);
      setCheered(res.cheered);
      setCheers(res.cheers);
    } catch {
      setCheered(!next);
    } finally {
      setBusy(false);
    }
  }

  if (chug.mine && cheers.length === 0) return null;
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      {!chug.mine && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={cheered}
          aria-label={cheered ? `Take back your cheers for ${chug.owner_name}` : `Cheers ${chug.owner_name}'s chug`}
          className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold transition-colors ${
            cheered
              ? "border-[#ffb27a]/60 bg-[#ff7a1a]/15 text-[#ffb27a]"
              : "border-white/15 bg-[#10151c] text-[#f5f4ec] hover:bg-white/5"
          }`}
        >
          <span aria-hidden>🍻</span>
          {cheered ? "Cheers!" : "Cheers"}
          {cheers.length > 0 && <span className="tabular-nums opacity-80">{cheers.length}</span>}
        </button>
      )}
      {cheers.length > 0 && (
        <span className="truncate text-xs text-[#f5f4ec]/50">
          {chug.mine ? `🍻 ${cheeredBy(cheers)} cheered this` : cheeredBy(cheers)}
        </span>
      )}
    </div>
  );
}
