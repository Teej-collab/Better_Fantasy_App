"use client";

import { useState } from "react";
import Image from "next/image";
import { playerHeadshotUrl, sleeperHeadshotUrl, teamLogoUrl } from "@/lib/nfl-teams";

// ESPN's and Sleeper's headshot CDNs are both undocumented — a URL
// scheme change on either end would 404, not error, so a plain <img>
// would show the browser's broken-image icon league-wide with no
// warning. onError swaps to an initials-in-a-circle placeholder
// instead, same as the app already does implicitly for owners without
// an avatar. Client component only because of that state; every call
// site above it stays server-rendered.
export function PlayerHeadshot({
  playerId,
  sleeperPlayerId,
  proTeam,
  name,
  size = 36,
}: {
  // ESPN's numeric id — legacy call sites (real ESPN box-score data).
  playerId?: number | null;
  // Sleeper's own string id — current_rosters/free-agents call sites,
  // which never have an ESPN id at all. Takes priority over playerId
  // when both happen to be passed.
  sleeperPlayerId?: string | null;
  proTeam: string | null | undefined;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  // D/ST rows use a negative synthetic ESPN player id (there's no real
  // person to have a headshot) — playerHeadshotUrl's own !playerId
  // check doesn't catch this (a negative number is truthy), so it used
  // to build a real request to ESPN's CDN for e.g. player id -16014
  // every single time, a guaranteed 404 on every matchup/roster page
  // load (2026-08-31 audit). Treated the same as "no headshot exists"
  // up front — skips the doomed request entirely and goes straight to
  // the team-logo-as-primary path below instead of initials.
  const isSyntheticId = typeof playerId === "number" && playerId < 0;
  const src = isSyntheticId ? null : sleeperPlayerId ? sleeperHeadshotUrl(sleeperPlayerId) : playerHeadshotUrl(playerId);
  const logo = teamLogoUrl(proTeam);

  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const hasRealHeadshot = Boolean(src) && !failed;

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {hasRealHeadshot ? (
        <Image
          src={src!}
          alt={name}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="h-full w-full rounded-full bg-black/5 object-cover object-top dark:bg-white/10"
        />
      ) : logo ? (
        // No real headshot to show (a D/ST "player" is a whole team,
        // not a person) — the team logo as the primary image is a far
        // more honest, recognizable fallback than generic initials
        // when we already know exactly which team this is.
        <Image
          src={logo}
          alt={name}
          width={size}
          height={size}
          className="h-full w-full rounded-full border border-black/10 bg-white object-contain p-0.5 dark:border-white/10 dark:bg-neutral-900"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-black/10 text-[0.6rem] font-semibold text-black/50 dark:bg-white/10 dark:text-white/50"
          style={{ fontSize: Math.max(size * 0.32, 9) }}
          aria-hidden
        >
          {initials || "?"}
        </span>
      )}
      {/* The small corner team-logo badge only adds information when
          the primary image is a person's real headshot — once the
          logo IS the primary image (the branch above), repeating it
          as a corner badge on top of itself is redundant. */}
      {logo && hasRealHeadshot && (
        <Image
          src={logo}
          alt=""
          aria-hidden
          width={Math.round(size * 0.42)}
          height={Math.round(size * 0.42)}
          className="absolute -right-0.5 -bottom-0.5 rounded-full border border-white bg-white object-contain dark:border-neutral-900 dark:bg-neutral-900"
          style={{ width: size * 0.42, height: size * 0.42, padding: size * 0.04 }}
        />
      )}
    </span>
  );
}
