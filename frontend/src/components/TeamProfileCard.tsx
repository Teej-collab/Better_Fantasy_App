"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  getSeasonProfile,
  type CareerProfile,
  type Owner,
  type OwnerBadges,
  type PeriodSummary,
  type SeasonProfile,
} from "@/lib/api";

/**
 * "Trading card" look, per a reference photo the project owner shared:
 * neon gradient border, starfield/nebula background, owner photo up
 * top, dark glass stat panels below. See globals.css's .cosmic-frame/
 * .cosmic-bg for the background implementation.
 *
 * Tap-to-flip: the front face is just identity (photo, team/owner
 * name, champion ribbon) so browsing CardDeck.tsx's Cover Flow deck
 * never needs any vertical scrolling; every stat box lives on the
 * back, revealed only when `flipped` is true. `flipped` and the actual
 * tap handling both live in CardDeck.tsx, not here — this component is
 * purely presentational about which face shows (see globals.css's
 * .flip-outer/.flip-inner/.flip-face for the 3D mechanics). The season/
 * career selector and the "View full profile" link both live on the
 * back and stop click propagation, so using them doesn't also flip the
 * card shut (CardDeck.tsx toggles flip from a click anywhere else on
 * the card).
 *
 * Career/season toggle mirrors Fantasy_Helper's Discord /team_profile
 * embed exactly on purpose (dropdown: "Overall (Career)" + each season) —
 * that's the reference the project owner pointed to originally. Career
 * data is fetched server-side (see app/page.tsx) since every card needs
 * it up front; season data is fetched client-side, lazily, only when a
 * season is actually selected — fetching all owners × all seasons up
 * front would be the same N+1 mistake made (and fixed) on the weekly
 * awards page.
 */
export function TeamProfileCard({
  owner,
  initialCareer,
  initialBadges,
  flipped,
}: {
  owner: Owner;
  initialCareer: CareerProfile;
  initialBadges: OwnerBadges;
  flipped: boolean;
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
    <div className="cosmic-frame overflow-hidden rounded-2xl">
      <div className="cosmic-bg relative rounded-[13px] p-4">
        <div className="flip-outer relative z-10 h-[460px] sm:h-[500px]">
          <div className={`flip-inner ${flipped ? "flip-inner--flipped" : ""}`}>
            <div className="flip-face flex flex-col items-center justify-center gap-3 overflow-hidden">
              <CardFront owner={owner} isChampion={isChampion} championYears={initialBadges.championship_years} />
            </div>

            <div className="flip-face flip-face--back flex flex-col gap-3 overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/owners/${owner.owner_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 truncate text-sm font-semibold text-amber-300 hover:underline"
                  style={{ textShadow: "0 0 10px rgba(252,211,77,0.45)" }}
                >
                  View full profile →
                </Link>
                <select
                  value={String(selected)}
                  onChange={(e) => selectSeason(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-md border border-white/20 bg-black/50 px-2 py-1 text-sm text-white backdrop-blur-sm"
                >
                  <option value="career" className="bg-black text-white">
                    Career
                  </option>
                  {[...owner.seasons].reverse().map((s) => (
                    <option key={s} value={s} className="bg-black text-white">
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {selected === "career" ? (
                <CosmicCareerView profile={initialCareer} badges={initialBadges} />
              ) : loading ? (
                <p className="text-center text-sm text-white/60">Loading {selected}…</p>
              ) : seasonProfile ? (
                <CosmicSeasonView profile={seasonProfile} season={selected} />
              ) : (
                <p className="text-center text-sm text-white/60">No data for {selected}.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardFront({
  owner,
  isChampion,
  championYears,
}: {
  owner: Owner;
  isChampion: boolean;
  championYears: number[];
}) {
  return (
    <>
      <div className="min-w-0 max-w-full text-center">
        <p
          className="truncate text-lg font-bold text-amber-300"
          style={{ textShadow: "0 0 10px rgba(252,211,77,0.45)" }}
        >
          {owner.latest_team_name}
        </p>
        <p className="text-sm text-sky-200">{owner.display_name}</p>
      </div>
      <OwnerPhoto name={owner.display_name} ownerId={owner.owner_id} />
      {isChampion && <ChampionRibbon years={championYears} />}
      <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-medium text-white/50">
        Tap for stats
      </span>
    </>
  );
}

// No `photo_url` field on Owner yet — real photos are dropped in here
// one at a time as owners send them in, keyed by owner_id. Everyone
// else keeps the circular-initials placeholder below.
const OWNER_PHOTOS: Record<number, string> = {
  5: "/images/owners/clay-felice.png", // Clay Felice
};

function OwnerPhoto({ name, ownerId }: { name: string; ownerId: number }) {
  const photo = OWNER_PHOTOS[ownerId];

  if (photo) {
    // Baseball-card style: a tall rectangular portrait filling most of
    // the card's width, rather than the cropped circle everyone else
    // gets. The reference photo already has its own neon-rainbow frame
    // baked in (matches this app's own cosmic-frame look exactly), so
    // no extra CSS border/glow is added here — that would just draw a
    // second, competing frame around the one already in the image.
    return (
      <div className="flex justify-center py-1">
        <Image src={photo} alt={name} width={337} height={462} className="h-auto w-full rounded-lg" />
      </div>
    );
  }

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="flex justify-center py-1">
      {/* Placeholder until a real photo exists for this owner — add it
          to OWNER_PHOTOS above once one comes in. */}
      <div
        className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-white/25 bg-gradient-to-br from-fuchsia-500/50 via-orange-400/40 to-sky-400/50 text-3xl font-bold text-white"
        style={{ boxShadow: "0 0 30px rgba(255,255,255,0.15)" }}
      >
        {initials}
      </div>
    </div>
  );
}

function ChampionRibbon({ years }: { years: number[] }) {
  return (
    <span className="mx-auto inline-flex w-fit items-center gap-1 rounded-full bg-amber-400/20 px-3 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-300/40">
      🏆 {years.length > 1 ? `${years.length}x Champion` : "Champion"} ({years.join(", ")})
    </span>
  );
}

function CosmicCareerView({ profile, badges }: { profile: CareerProfile; badges: OwnerBadges }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-[11px] text-white/40">Seasons played: {profile.seasons.join(", ")}</p>

      <div className="grid grid-cols-2 gap-2">
        <RecordBox title="Regular season" summary={profile.regular} />
        <RecordBox title="Playoffs" summary={profile.playoff} emptyText="Never made the playoffs (yet)" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <BestWorstBox
          topLabel="Best week ever"
          topValue={
            profile.best_week
              ? `${profile.best_week.season} Wk ${profile.best_week.week} — ${profile.best_week.score}`
              : "—"
          }
          bottomLabel="Best season"
          bottomValue={profile.best_season ? `${profile.best_season.season} (${profile.best_season.record})` : "—"}
        />
        <BestWorstBox
          topLabel="Worst week ever"
          topValue={
            profile.worst_week
              ? `${profile.worst_week.season} Wk ${profile.worst_week.week} — ${profile.worst_week.score}`
              : "—"
          }
          bottomLabel="Worst season"
          bottomValue={
            profile.worst_season ? `${profile.worst_season.season} (${profile.worst_season.record})` : "—"
          }
        />
      </div>

      <CareerAwardsBox awardSummary={badges.award_summary} />
    </div>
  );
}

function CosmicSeasonView({ profile, season }: { profile: SeasonProfile; season: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-[11px] text-white/40">{season} season</p>

      <div className="grid grid-cols-2 gap-2">
        <RecordBox title="Regular season" summary={profile.regular} />
        <RecordBox title="Playoffs" summary={profile.playoff} emptyText="Didn't make the playoffs this season" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DarkBox>
          <MiniStat
            label="Best week"
            value={profile.best_week ? `Wk ${profile.best_week.week} — ${profile.best_week.score}` : "—"}
          />
        </DarkBox>
        <DarkBox>
          <MiniStat
            label="Worst week"
            value={profile.worst_week ? `Wk ${profile.worst_week.week} — ${profile.worst_week.score}` : "—"}
          />
        </DarkBox>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DarkBox>
          <MiniStat label="Avg luck" value={profile.avg_luck ?? "—"} />
        </DarkBox>
        <DarkBox>
          <MiniStat
            label="Power rank"
            value={profile.current_power_rank ? `#${profile.current_power_rank}` : "—"}
          />
        </DarkBox>
      </div>

      {profile.season_awards.length > 0 && (
        <DarkBox>
          <h4 className="mb-1 text-xs font-semibold text-amber-300">Season Awards</h4>
          <ul className="flex flex-col gap-0.5 text-sm text-amber-100">
            {profile.season_awards.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-amber-400">★</span>
                <span>
                  {a.award_type}
                  {a.detail && <span className="text-amber-200/70"> — {a.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </DarkBox>
      )}
    </div>
  );
}

function DarkBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-sm">{children}</div>;
}

function RecordBox({
  title,
  summary,
  emptyText = "No games",
}: {
  title: string;
  summary: PeriodSummary | null;
  emptyText?: string;
}) {
  return (
    <DarkBox>
      <h4 className="mb-1.5 text-xs font-semibold text-pink-300">{title}</h4>
      {summary ? (
        <div className="grid grid-cols-3 gap-1">
          <MiniStat label="Record" value={summary.record} />
          <MiniStat label="PF" value={summary.pf} valueClassName="text-sky-300" />
          <MiniStat label="PA" value={summary.pa} valueClassName="text-orange-300" />
        </div>
      ) : (
        <p className="text-xs text-white/40">{emptyText}</p>
      )}
    </DarkBox>
  );
}

function BestWorstBox({
  topLabel,
  topValue,
  bottomLabel,
  bottomValue,
}: {
  topLabel: string;
  topValue: string;
  bottomLabel: string;
  bottomValue: string;
}) {
  return (
    <DarkBox>
      <h4 className="text-xs font-semibold text-white/60">{topLabel}</h4>
      <p className="mb-2 text-sm font-medium tabular-nums text-white">{topValue}</p>
      <h4 className="text-xs font-semibold text-white/60">{bottomLabel}</h4>
      <p className="text-sm font-medium tabular-nums text-white">{bottomValue}</p>
    </DarkBox>
  );
}

function CareerAwardsBox({ awardSummary }: { awardSummary: OwnerBadges["award_summary"] }) {
  // Flattened to one line per (award, year) — matches the reference
  // card's "Heater (2024)" / "Overachiever (2025)" style, rather than
  // this app's usual "3x Overachiever (2023, 2024, 2025)" grouping.
  const entries = Object.entries(awardSummary)
    .flatMap(([type, years]) => years.map((year) => ({ type, year })))
    .sort((a, b) => b.year - a.year || a.type.localeCompare(b.type));

  if (entries.length === 0) return null;

  return (
    <DarkBox>
      <h4 className="mb-1 text-xs font-semibold text-amber-300">Career Awards</h4>
      <ul className="flex flex-col gap-0.5 text-sm text-amber-100">
        {entries.map((e, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="text-amber-400">★</span>
            {e.type} ({e.year})
          </li>
        ))}
      </ul>
    </DarkBox>
  );
}

function MiniStat({
  label,
  value,
  valueClassName = "text-white",
}: {
  label: string;
  value: string | number;
  valueClassName?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-white/40 uppercase">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${valueClassName}`}>{value}</dd>
    </div>
  );
}
