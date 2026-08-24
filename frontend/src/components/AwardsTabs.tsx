import Link from "next/link";

const TAB_CLASS = "text-black/60 hover:underline dark:text-white/60";
const ACTIVE_TAB_CLASS = "font-semibold underline";

/**
 * The tab row at the top of every Awards page — one tab per season plus
 * a pinned "All-Time Records" tab, all real navigations (not client-side
 * tab state), matching how the rest of this app's tabs work. Shared
 * between seasons/[season]/awards/page.tsx (a specific season's awards)
 * and seasons/[season]/awards/all-time/page.tsx (the league's all-time
 * record book, not season-scoped, but still keyed on `activeSeason` so
 * the URL you land back on after leaving All-Time Records is whichever
 * season you were last looking at) so both pages render the identical
 * row rather than two copies drifting apart.
 */
export function AwardsTabs({
  seasons,
  activeSeason,
  activeTab,
}: {
  seasons: number[];
  activeSeason: string;
  activeTab: "season" | "all-time";
}) {
  return (
    <div className="flex flex-wrap gap-x-3 text-sm">
      <Link
        href={`/seasons/${activeSeason}/awards/all-time`}
        className={activeTab === "all-time" ? ACTIVE_TAB_CLASS : TAB_CLASS}
      >
        All-Time Records
      </Link>
      {[...seasons].reverse().map((s) => (
        <Link
          key={s}
          href={`/seasons/${s}/awards`}
          className={activeTab === "season" && String(s) === activeSeason ? ACTIVE_TAB_CLASS : TAB_CLASS}
        >
          {s}
        </Link>
      ))}
    </div>
  );
}
