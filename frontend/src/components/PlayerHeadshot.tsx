"use client";

import { useState } from "react";
import Image from "next/image";
import { playerHeadshotUrl, teamLogoUrl } from "@/lib/nfl-teams";

// ESPN's headshot CDN is undocumented — a URL scheme change on their
// end would 404, not error, so a plain <img> would show the browser's
// broken-image icon league-wide with no warning. onError swaps to an
// initials-in-a-circle placeholder instead, same as the app already
// does implicitly for owners without an avatar. Client component only
// because of that state; every call site above it stays server-rendered.
export function PlayerHeadshot({
  playerId,
  proTeam,
  name,
  size = 36,
}: {
  playerId: number | null | undefined;
  proTeam: string | null | undefined;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const src = playerHeadshotUrl(playerId);
  const logo = teamLogoUrl(proTeam);

  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="h-full w-full rounded-full bg-black/5 object-cover object-top dark:bg-white/10"
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
      {logo && (
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
