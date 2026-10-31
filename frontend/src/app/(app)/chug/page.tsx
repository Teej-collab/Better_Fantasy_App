import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { awardsHrefFor, getActiveLeagueName, getChugDeadline, getChugFeed, getChugLeaderboard, getChugLedger, getChugSeasons, getMe, listSeasons, safeLatestSeason } from "@/lib/api";
import { ChugBreakdown } from "@/components/ChugBreakdown";
import { ChugUpload } from "@/components/ChugUpload";
import { ChugFineButton } from "@/components/ChugFineButton";
import { ChugCommishActions } from "@/components/ChugCommishActions";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Chug — The Weekend" };
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { ELITE, EliteCard, EliteLabel, EliteSeasonChips, EliteTitle, HEX_CLIP } from "@/components/elite/Elite";
import { ChugOwe, EliteChugFeed } from "@/components/elite/EliteChug";

// Elite pass (2026-10-31): the Chug Board — what you owe as a lit cell
// with the doubling countdown, Submit, The Tab (owed chugs as cells) and
// each chug's score in a hex with its quote and hype grade.
const PIPS_SHOWN = 8;

export default async function ChugLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : undefined;

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

  const [{ seasons }, { leaderboard }, { chugs }, { seasons: allSeasons }, activeLeagueName, ledger, deadline] = await Promise.all([
    getChugSeasons(),
    getChugLeaderboard(sessionCookie, season),
    getChugFeed(sessionCookie, season),
    listSeasons(sessionCookie),
    getActiveLeagueName(sessionCookie),
    // Each row's "Why?" history — this season's when no season is picked.
    getChugLedger(sessionCookie, season).catch(() => ({ season: season ?? 0, owners: {} as Record<string, never[]> })),
    getChugDeadline(sessionCookie).catch(() => null),
  ]);
  const latestSeason = safeLatestSeason(allSeasons);
  // Chug balance tools (Paid, Correction, Remove doubling): commissioner or site admin.
  const canManage = me.is_commissioner || me.is_site_owner;

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="history" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker="The" title="Chug Board" />
      {deadline?.mine && <ChugOwe deadline={deadline.deadline} isPast={deadline.is_past} mine={deadline.mine} />}
      <ChugUpload
        variant="elite"
        creditableOwners={
          me.is_commissioner
            ? leaderboard.map((r) => ({ owner_id: r.owner_id, owner_name: r.owner_name }))
            : undefined
        }
      />

      <EliteSeasonChips
        seasons={seasons}
        activeSeason={season ?? null}
        hrefFor={(s) => `/chug?season=${s}`}
        extraTab={{ label: "All-Time", href: "/chug", active: season === undefined }}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <EliteLabel>The Tab</EliteLabel>
        </div>
        <details className="group text-sm">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-[#39ff14] hover:underline">
            <span className="group-open:hidden">House rules</span>
            <span className="hidden group-open:inline">Hide house rules</span>
          </summary>
          <p className="mt-2 text-xs text-black/50 dark:text-white/55">
            The rule: any active roster spot (not bench, not IR) that scores 0 or fewer points owes its owner one chug. Not paid down by Monday
            Night Football kickoff? The remaining balance doubles — up to 3 weeks running, after which it converts to a $10/chug fine only a
            commissioner can clear.
          </p>
        </details>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No chug data yet.</p>
        ) : (
          <EliteCard className="overflow-hidden">
            <ol className="flex flex-col divide-y divide-white/[0.06]">
              {leaderboard.map((row) => {
                const owed = row.outstanding_owed;
                return (
                  <li key={row.owner_id} className="flex flex-col gap-1.5 px-3.5 py-3 text-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`/owners/${row.owner_id}`} className="min-w-0 wrap-break-word font-bold hover:underline">
                          {row.owner_name}
                        </Link>
                        <p className="text-xs tabular-nums" style={{ color: ELITE.soft }}>
                          {[
                            `${row.completed}/${row.owed} done`,
                            row.avg_grade !== null ? `avg ${row.avg_grade}` : null,
                            `lifetime ${row.lifetime_completed}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {owed > 0 ? (
                        <span className="flex items-center gap-[3px]" aria-label={`${owed} owed right now`}>
                          {Array.from({ length: Math.min(owed, PIPS_SHOWN) }, (_, i) => (
                            <i key={i} className="h-3.5 w-3" style={{ clipPath: HEX_CLIP, background: ELITE.orange }} />
                          ))}
                          {owed > PIPS_SHOWN && (
                            <span className="ml-0.5 text-xs font-extrabold" style={{ color: ELITE.peach }}>
                              +{owed - PIPS_SHOWN}
                            </span>
                          )}
                        </span>
                      ) : (
                        row.fined_owed === 0 && (
                          <span className="text-xs font-bold" style={{ color: ELITE.green }}>
                            Paid up
                          </span>
                        )
                      )}
                      {owed > 0 && (row.doubled_weeks ?? []).length > 0 && (
                        <span className="rounded-md px-1.5 py-0.5 text-[11px] font-extrabold text-[#1a0b00]" style={{ background: ELITE.peach }}>
                          ×2
                        </span>
                      )}
                    </div>

                    {(row.fined_owed > 0 || canManage) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {row.fined_owed > 0 && (
                          <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-400">
                            ${row.fine_amount} fine ({row.fined_owed} chugs)
                            {canManage && <ChugFineButton ownerId={row.owner_id} fineAmount={row.fine_amount} />}
                          </span>
                        )}
                        {canManage && (
                          <ChugCommishActions
                            ownerId={row.owner_id}
                            ownerName={row.owner_name}
                            outstandingOwed={row.outstanding_owed}
                            doubledWeeks={row.doubled_weeks ?? []}
                          />
                        )}
                      </div>
                    )}
                    <ChugBreakdown events={ledger.owners[String(row.owner_id)] ?? []} />
                  </li>
                );
              })}
            </ol>
          </EliteCard>
        )}
      </section>

      <EliteChugFeed chugs={chugs} />
    </div>
  );
}
