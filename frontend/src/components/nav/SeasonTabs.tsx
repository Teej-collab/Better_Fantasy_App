import Link from "next/link";

const TAB_CLASS = "text-black/60 hover:underline dark:text-white/60";
const ACTIVE_TAB_CLASS = "font-semibold underline";

/**
 * The shared "pick a season" row — replaces AwardsTabs.tsx and eight
 * separately hand-rolled inline season-year link rows (Standings,
 * League, Owner profile, Player Cards, Chug) that used to each
 * implement the same idea slightly differently. Deliberately plain
 * (underlined text, no color/glow) so it reads as a clearly secondary
 * row underneath LeagueSubNav's pill-shaped primary tabs, instead of
 * two rows competing in the same visual language.
 *
 * `extraTab` covers the one case that isn't just "a season" — Awards'
 * "All-Time Records" and Chug's "All-Time" — rendered first, matching
 * where AwardsTabs always put it.
 */
export function SeasonTabs({
  seasons,
  activeSeason,
  hrefFor,
  extraTab,
}: {
  seasons: number[];
  activeSeason: number | string | null;
  hrefFor: (season: number) => string;
  extraTab?: { label: string; href: string; active: boolean };
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {extraTab && (
        <Link href={extraTab.href} className={extraTab.active ? ACTIVE_TAB_CLASS : TAB_CLASS}>
          {extraTab.label}
        </Link>
      )}
      {[...seasons].reverse().map((s) => (
        <Link key={s} href={hrefFor(s)} className={String(s) === String(activeSeason) ? ACTIVE_TAB_CLASS : TAB_CLASS}>
          {s}
        </Link>
      ))}
    </div>
  );
}
