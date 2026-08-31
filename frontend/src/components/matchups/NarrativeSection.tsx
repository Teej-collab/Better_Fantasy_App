// Shared by MatchupCard.tsx's accordion (short context) and the full
// matchup detail page (prominent placement near the top) — one
// component so both surfaces render the same write-up identically.
// See app/domain/narrative_engine.py for how `narrative` gets filled
// in; still null until that's wired up, in which case this renders
// the same placeholder it always has.
export function NarrativeSection({ narrative }: { narrative: string | null }) {
  return (
    <div className="rounded-md bg-black/[0.03] px-3 py-2 text-sm italic text-black/50 dark:bg-white/[0.03] dark:text-white/50">
      {narrative ?? "Recap & preview writeups aren't turned on yet — coming later."}
    </div>
  );
}
