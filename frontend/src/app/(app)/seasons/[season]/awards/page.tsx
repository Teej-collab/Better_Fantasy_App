import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getActiveLeagueName, getMe, getSeasonAwards, listSeasons } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { ANTON, ELITE, EliteCard, EliteLabel, EliteSeasonChips, EliteTitle, Hex, initials } from "@/components/elite/Elite";
import type { SeasonAward } from "@/lib/api";
import { BackButton } from "@/components/BackButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string }>;
}): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} Awards — The Weekend` };
}

export default async function SeasonAwardsPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const [{ seasons }, { champion, awards }, activeLeagueName] = await Promise.all([
    listSeasons(sessionCookie),
    getSeasonAwards(Number(season), sessionCookie),
    getActiveLeagueName(sessionCookie),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/history" label="History" />
      <LeagueSubNav active="history" awardsHref={`/seasons/${season}/awards`} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker={`The ${season}`} title="Trophy Wall" />
      <EliteSeasonChips
        seasons={seasons}
        activeSeason={season}
        hrefFor={(s) => `/seasons/${s}/awards`}
        extraTab={{ label: "All-Time Records", href: `/seasons/${season}/awards/all-time`, active: false }}
      />

      {champion ? (
        <EliteCard tone="orange" className="flex items-center gap-4 p-4">
          <TrophyCell />
          <div className="min-w-0">
            <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
              CHAMPION
            </span>
            <p className={`${ANTON} text-[26px] leading-tight uppercase`}>{champion.team_name}</p>
            <Link href={`/owners/${champion.owner_id}`} className="text-sm hover:underline" style={{ color: ELITE.soft }}>
              {champion.owner_name}
            </Link>
          </div>
        </EliteCard>
      ) : (
        Number(season) === Math.max(...seasons) && (
          <EliteCard tone="orange" className="flex items-center gap-4 p-4">
            <TrophyCell />
            <div>
              <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
                CHAMPION
              </span>
              <p className={`${ANTON} text-[26px] leading-tight`}>STILL UP FOR GRABS</p>
              <p className="text-xs" style={{ color: ELITE.soft }}>
                Crowned after the title game
              </p>
            </div>
          </EliteCard>
        )
      )}

      {awards.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No awards recorded for {season} yet.</p>
      ) : (
        <TrophyWall awards={awards} />
      )}
    </div>
  );
}

// The awards nobody wants, on the Shame side of the wall.
const SHAME = new Set(["Bust Week", "Choke Artist", "Cold Streak", "Luckiest Win", "Snakebit Award", "Underachiever", "League Loser"]);
const HERO = "Boom Week";

type Award = SeasonAward;

// The number an award is about ("179.18 pts" → 179.18, "+177.59 pts vs.
// expected" → +178), short enough for a cell; the winner's initials when
// there isn't one.
function cellValue(a: Award): string {
  const m = a.detail?.match(/([+\-−]?)(\d+(?:\.\d+)?)/);
  if (!m) return initials(a.owner_name);
  const n = Number(m[2]);
  const sign = m[1] === "+" ? "+" : m[1] ? "−" : "";
  const body = n >= 100 ? String(Math.round(n)) : m[2].includes(".") ? n.toFixed(1) : String(n);
  return `${sign}${body}`;
}

function TrophyCell() {
  return (
    <Hex size={78} color={ELITE.peach} fill={ELITE.orange} glow>
      <span className="text-3xl" aria-hidden>
        🏆
      </span>
    </Hex>
  );
}

// Elite pass (2026-10-31): Boom Week up top, then Glory and Shame cells.
function TrophyWall({ awards }: { awards: Award[] }) {
  const hero = awards.find((a) => a.award_type === HERO) ?? null;
  const rest = awards.filter((a) => a !== hero);
  const glory = rest.filter((a) => !SHAME.has(a.award_type));
  const shame = rest.filter((a) => SHAME.has(a.award_type));
  return (
    <div className="flex flex-col gap-4">
      {hero && (
        <Link href={`/owners/${hero.owner_id}`} className="block">
          <EliteCard tone="green" className="flex items-center gap-4 p-4 transition-colors hover:border-[#39ff14]">
            <Hex size={72} color={ELITE.green} fill="#0f1a12" glow>
              <span className={`${ANTON} text-[22px]`} style={{ color: ELITE.green }}>
                {cellValue(hero)}
              </span>
            </Hex>
            <div className="min-w-0">
              <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.green }}>
                {hero.award_type.toUpperCase()}
              </span>
              <p className="text-xl font-extrabold">{hero.owner_name}</p>
              {hero.detail && (
                <p className="text-xs" style={{ color: ELITE.soft }}>
                  {hero.detail}
                </p>
              )}
            </div>
          </EliteCard>
        </Link>
      )}
      {glory.length > 0 && <AwardGrid label="Glory" color={ELITE.green} awards={glory} />}
      {shame.length > 0 && <AwardGrid label="Shame" color={ELITE.orange} awards={shame} />}
    </div>
  );
}

function AwardGrid({ label, color, awards }: { label: string; color: string; awards: Award[] }) {
  return (
    <section className="flex flex-col gap-2">
      <EliteLabel color={color === ELITE.orange ? "#ff9a4a" : color}>{label}</EliteLabel>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {awards.map((a, i) => (
          <li key={`${a.award_type}-${i}`}>
            <Link
              href={`/owners/${a.owner_id}`}
              className="flex h-full flex-col items-center gap-1 rounded-[18px] border border-white/[0.07] bg-[#141a22] px-3 pt-3.5 pb-3 text-center text-[#f5f4ec] transition-colors hover:border-white/20"
            >
              <Hex size={58} color={color}>
                <span className={`${ANTON} text-lg`} style={{ color }}>
                  {cellValue(a)}
                </span>
              </Hex>
              <span className="mt-1 text-[13px] font-extrabold">{a.award_type}</span>
              <span className="text-[15px] font-bold">{a.owner_name}</span>
              {a.detail && (
                <span className="text-[11.5px]" style={{ color: ELITE.soft }}>
                  {a.detail}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
