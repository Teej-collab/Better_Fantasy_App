"use client";

import { useState } from "react";
import {
  getSeasonProfile,
  type CareerProfile,
  type OwnerBadges,
  type Owner,
  type PeriodSummary,
  type SeasonProfile,
} from "@/lib/api";

/**
 * Career/season toggle mirrors Fantasy_Helper's Discord /team_profile
 * embed exactly on purpose (dropdown: "Overall (Career)" + each season) —
 * that's the reference the project owner pointed to. Career data is
 * fetched server-side (see app/page.tsx) since every card needs it up
 * front; season data is fetched client-side, lazily, only when a season
 * is actually selected — fetching all owners × all seasons up front
 * would be the same N+1 mistake made (and fixed) on the weekly awards
 * page.
 */
export function TeamProfileCard({
  owner,
  initialCareer,
  initialBadges,
}: {
  owner: Owner;
  initialCareer: CareerProfile;
  initialBadges: OwnerBadges;
}) {
  const [selected, setSelected] = useState<"career" | number>("career");
  const [seasonCache, setSeasonCache] = useState<Record<number, SeasonProfile | null>>({});
  const [loading, setLoading] = useState(false);

  async function selectSeason(value: string) {
    if (value === "career") {
      setSelected("career");
      return;
    }
    const season = Number(value);
    setSelected(season);
    if (season in seasonCache) return;

    setLoading(true);
    const profile = await getSeasonProfile(owner.owner_id, season);
    setSeasonCache((prev) => ({ ...prev, [season]: profile }));
    setLoading(false);
  }

  const isChampion = initialBadges.championship_years.length > 0;
  const seasonProfile = typeof selected === "number" ? seasonCache[selected] : null;

  return (
    <div
      className={
        "flex flex-col gap-4 rounded-lg border p-4 " +
        (isChampion
          ? "border-amber-300 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-400/10"
          : "border-black/10 dark:border-white/10")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <a href={`/owners/${owner.owner_id}`} className="font-semibold hover:underline">
            {owner.latest_team_name}
          </a>
          <p className="text-sm text-black/60 dark:text-white/60">{owner.display_name}</p>
        </div>
        <select
          value={String(selected)}
          onChange={(e) => selectSeason(e.target.value)}
          className="shrink-0 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
        >
          <option value="career">Career</option>
          {[...owner.seasons].reverse().map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {isChampion && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-200 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-300">
          🏆 {initialBadges.championship_years.length > 1
            ? `${initialBadges.championship_years.length}x Champion`
            : "Champion"}{" "}
          ({initialBadges.championship_years.join(", ")})
        </span>
      )}

      {selected === "career" ? (
        <CareerView profile={initialCareer} badges={initialBadges} />
      ) : loading ? (
        <p className="text-sm text-black/50 dark:text-white/50">Loading {selected}…</p>
      ) : seasonProfile ? (
        <SeasonView profile={seasonProfile} season={selected} />
      ) : (
        <p className="text-sm text-black/50 dark:text-white/50">No data for {selected}.</p>
      )}
    </div>
  );
}

function CareerView({ profile, badges }: { profile: CareerProfile; badges: OwnerBadges }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-black/50 dark:text-white/50">
        Seasons played: {profile.seasons.join(", ")}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeriodCard title="Regular season" summary={profile.regular} />
        {profile.playoff ? (
          <PeriodCard title="Playoffs" summary={profile.playoff} />
        ) : (
          <div className="rounded-md border border-black/10 p-3 text-sm text-black/50 dark:border-white/10 dark:text-white/50">
            Never made the playoffs (yet)
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat
          label="Best week ever"
          value={profile.best_week ? `${profile.best_week.season} Wk ${profile.best_week.week} — ${profile.best_week.score}` : "—"}
        />
        <Stat
          label="Worst week ever"
          value={profile.worst_week ? `${profile.worst_week.season} Wk ${profile.worst_week.week} — ${profile.worst_week.score}` : "—"}
        />
        <Stat
          label="Best season"
          value={profile.best_season ? `${profile.best_season.season} (${profile.best_season.record})` : "—"}
        />
        <Stat
          label="Worst season"
          value={profile.worst_season ? `${profile.worst_season.season} (${profile.worst_season.record})` : "—"}
        />
      </dl>

      {Object.keys(badges.award_summary).length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-black/50 dark:text-white/50">🎖️ Career Awards</h4>
          <ul className="flex flex-col gap-0.5 text-sm">
            {Object.entries(badges.award_summary)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([awardType, years]) => (
                <li key={awardType}>
                  <span className="font-medium">
                    {years.length > 1 ? `${years.length}x ${awardType}` : awardType}
                  </span>{" "}
                  <span className="text-black/50 dark:text-white/50">({years.join(", ")})</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SeasonView({ profile, season }: { profile: SeasonProfile; season: number }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-black/50 dark:text-white/50">{season} season</p>

      {profile.season_awards.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {profile.season_awards.map((a, i) => (
            <li key={i}>
              🎖️ <span className="font-medium">{a.award_type}</span>
              {a.detail && <span className="text-black/50 dark:text-white/50"> — {a.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PeriodCard title="Regular season" summary={profile.regular} />
        {profile.playoff ? (
          <PeriodCard title="Playoffs" summary={profile.playoff} />
        ) : (
          <div className="rounded-md border border-black/10 p-3 text-sm text-black/50 dark:border-white/10 dark:text-white/50">
            Didn&apos;t make the playoffs this season
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Best week" value={profile.best_week ? `Wk ${profile.best_week.week} — ${profile.best_week.score}` : "—"} />
        <Stat label="Worst week" value={profile.worst_week ? `Wk ${profile.worst_week.week} — ${profile.worst_week.score}` : "—"} />
        <Stat label="Avg luck" value={profile.avg_luck ?? "—"} />
        <Stat label="Power rank" value={profile.current_power_rank ? `#${profile.current_power_rank}` : "—"} />
      </dl>
    </div>
  );
}

function PeriodCard({ title, summary }: { title: string; summary: PeriodSummary | null }) {
  return (
    <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
      <h4 className="mb-1.5 text-xs font-medium text-black/50 dark:text-white/50">{title}</h4>
      {summary ? (
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <Stat label="Record" value={summary.record} />
          <Stat label="PF" value={summary.pf} />
          <Stat label="PA" value={summary.pa} />
        </dl>
      ) : (
        <p className="text-sm text-black/40 dark:text-white/40">No games</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-black/50 dark:text-white/50">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}
