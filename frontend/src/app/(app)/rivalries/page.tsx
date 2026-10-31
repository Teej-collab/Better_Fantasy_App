import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { awardsHrefFor, getActiveLeagueName, getMe, listOwners, listRivalries, listSeasons, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { ANTON, ELITE, EliteCard, EliteTitle, Hex, initials, SATISFY } from "@/components/elite/Elite";
import { ReadMore } from "@/components/elite/ReadMore";
import type { Rivalry } from "@/lib/api";

export const metadata: Metadata = { title: "Rivalries — The Weekend" };

export default async function RivalriesPage() {
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

  const [{ rivalries }, { seasons }, activeLeagueName, { owners }] = await Promise.all([
    listRivalries(sessionCookie),
    listSeasons(sessionCookie),
    getActiveLeagueName(sessionCookie),
    listOwners(sessionCookie).catch(() => ({ owners: [] })),
  ]);
  // Each owner's profile picture (Settings > Team Logo) for the cells.
  const photoByOwner = new Map(owners.filter((o) => o.logo_url).map((o) => [o.owner_id, o.logo_url!]));

  const latestSeason = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="rivalries" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker="The" title="Fight Card" subtitle="Every rivalry, all-time series" />

      {rivalries.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No rivalries recorded.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {orderForFightCard(rivalries).map(({ rivalry, main }) => (
            <li key={rivalry.id}>
              <RivalryCard rivalry={rivalry} main={main} myOwnerId={me.owner_id} photoByOwner={photoByOwner} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TIER_HEAT: Record<string, number> = { Developing: 1, Historic: 2, Legendary: 3 };

// The Main Event: the closest series that's been played (the most
// meetings breaks a tie), first on the card.
function orderForFightCard(rivalries: Rivalry[]): { rivalry: Rivalry; main: boolean }[] {
  const played = rivalries.filter((r) => r.all_time_wins_a + r.all_time_wins_b > 0);
  const main = played.reduce<Rivalry | null>((best, r) => {
    if (!best) return r;
    const gap = Math.abs(r.all_time_wins_a - r.all_time_wins_b);
    const bestGap = Math.abs(best.all_time_wins_a - best.all_time_wins_b);
    const games = r.all_time_wins_a + r.all_time_wins_b;
    const bestGames = best.all_time_wins_a + best.all_time_wins_b;
    return gap < bestGap || (gap === bestGap && games > bestGames) ? r : best;
  }, null);
  const rest = rivalries.filter((r) => r.id !== main?.id).map((r) => ({ rivalry: r, main: false }));
  return main ? [{ rivalry: main, main: true }, ...rest] : rest;
}

function RivalryCard({
  rivalry: r,
  main,
  myOwnerId,
  photoByOwner,
}: {
  rivalry: Rivalry;
  main: boolean;
  myOwnerId: number | null;
  photoByOwner: Map<number, string>;
}) {
  const heat = TIER_HEAT[r.tier ?? ""] ?? 1;
  const name = r.name ?? `${r.owner_a_name} vs ${r.owner_b_name}`;
  return (
    <EliteCard tone={main ? "orange" : "plain"} className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        {main ? (
          <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
            MAIN EVENT · CLOSEST SERIES
          </span>
        ) : (
          <span />
        )}
        {r.tier && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: ELITE.soft }} aria-label={`${r.tier} rivalry`}>
            {r.tier}
            {[1, 2, 3].map((n) => (
              <i key={n} className="h-1.5 w-4 rounded-full" style={{ background: n <= heat ? ELITE.orange : "rgba(245,244,236,.15)" }} />
            ))}
          </span>
        )}
      </div>
      <div className={main ? "text-center" : ""}>
        <h2 className={`${ANTON} leading-tight uppercase ${main ? "text-3xl" : "text-2xl"}`}>
          {r.emoji && <span className="mr-1.5">{r.emoji}</span>}
          {name}
        </h2>
        {r.tagline && (
          <p className={`${SATISFY} text-lg`} style={{ color: "#ffd0a0" }}>
            {r.tagline}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Fighter id={r.owner_a_id} name={r.owner_a_name} leads={r.all_time_wins_a > r.all_time_wins_b} mine={r.owner_a_id === myOwnerId} photo={photoByOwner.get(r.owner_a_id)} />
        <div className="flex flex-col items-center">
          <span
            className={`${ANTON} leading-none tracking-wider ${main ? "text-5xl" : "text-4xl"}`}
            style={main ? { color: ELITE.peach, textShadow: "0 0 12px rgba(255,122,26,.7)" } : undefined}
          >
            {r.all_time_wins_a}–{r.all_time_wins_b}
          </span>
          <span className="mt-1 text-[11px] font-bold tracking-wider" style={{ color: ELITE.soft }}>
            ALL-TIME
          </span>
        </div>
        <Fighter id={r.owner_b_id} name={r.owner_b_name} leads={r.all_time_wins_b > r.all_time_wins_a} mine={r.owner_b_id === myOwnerId} photo={photoByOwner.get(r.owner_b_id)} />
      </div>
      {r.description && <ReadMore text={r.description} more="Read the whole story" className="text-sm leading-relaxed text-[#f5f4ec]/85" />}
    </EliteCard>
  );
}

function Fighter({ id, name, leads, mine, photo }: { id: number; name: string; leads: boolean; mine: boolean; photo?: string }) {
  const color = mine ? ELITE.orange : leads ? ELITE.green : ELITE.grey;
  return (
    <Link href={`/owners/${id}`} className="flex w-24 flex-col items-center gap-1.5 text-center hover:underline" aria-label={`${name}${leads ? ", leads the series" : ""}`}>
      <Hex size={60} color={color} glow={leads || mine} image={photo}>
        <span className={`${ANTON} text-xl`} style={{ color: leads || mine ? color : ELITE.cream }}>
          {initials(name)}
        </span>
      </Hex>
      <span className="text-[13px] font-bold leading-tight">{name}</span>
    </Link>
  );
}
