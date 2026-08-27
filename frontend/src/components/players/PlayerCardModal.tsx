"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getPlayerCard, type PlayerCard } from "@/lib/playerCardApi";
import { nflTeamColor, nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";

// Click a player's name anywhere it's rendered inside a
// PlayerCardModal.Provider-less caller — this modal is self-contained
// (fetches on mount, owns its own loading/error state) so any list
// (draft pool, roster, free agents) can open it with nothing more than
// a sleeper_player_id.
export function PlayerCardModal({ sleeperPlayerId, onClose }: { sleeperPlayerId: string; onClose: () => void }) {
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headshotFailed, setHeadshotFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlayerCard(sleeperPlayerId)
      .then((c) => {
        if (!cancelled) setCard(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load player");
      });
    return () => {
      cancelled = true;
    };
  }, [sleeperPlayerId]);

  const accent = card ? nflTeamColor(card.pro_team) : null;
  const logo = card ? teamLogoUrl(card.pro_team) : null;
  const initials = card
    ? card.full_name
        .split(/\s+/)
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="neon-panel flex w-full max-w-sm flex-col gap-4 rounded-2xl p-5"
        style={accent ? ({ "--user-accent": accent } as React.CSSProperties) : undefined}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-auto text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
        >
          ✕
        </button>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {!card && !error && <p className="py-8 text-center text-sm text-black/50 dark:text-white/50">Loading…</p>}

        {card && (
          <>
            <div className="flex items-center gap-4">
              <span className="relative inline-flex h-20 w-20 shrink-0">
                {card.headshot_url && !headshotFailed ? (
                  <Image
                    src={card.headshot_url}
                    alt={card.full_name}
                    width={80}
                    height={80}
                    onError={() => setHeadshotFailed(true)}
                    className="h-full w-full rounded-full bg-black/5 object-cover object-top dark:bg-white/10"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-black/10 text-xl font-semibold text-black/50 dark:bg-white/10 dark:text-white/50">
                    {initials || card.position}
                  </span>
                )}
                {logo && (
                  <Image
                    src={logo}
                    alt=""
                    aria-hidden
                    width={28}
                    height={28}
                    className="absolute -right-1 -bottom-1 rounded-full border-2 border-[var(--background)] bg-white object-contain p-0.5"
                  />
                )}
              </span>
              <div className="flex min-w-0 flex-col">
                <h2 className="truncate text-lg font-semibold">{card.full_name}</h2>
                <p className="text-xs text-black/50 dark:text-white/50">
                  {card.position} · {nflTeamName(card.pro_team) ?? card.pro_team ?? "Free agent"}
                  {card.jersey_number && ` · #${card.jersey_number}`}
                </p>
                {card.injury_status && (
                  <span className="mt-1 w-fit rounded-full bg-red-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-red-500">
                    {card.injury_status}
                  </span>
                )}
              </div>
            </div>

            {(card.age || card.height || card.weight || card.years_exp !== null) && (
              <div className="grid grid-cols-4 gap-2 rounded-xl bg-black/5 p-3 text-center dark:bg-white/5">
                <BioStat label="Age" value={card.age ?? "—"} />
                <BioStat label="Height" value={formatHeight(card.height)} />
                <BioStat label="Weight" value={card.weight ? `${card.weight} lbs` : "—"} />
                <BioStat label="Exp" value={card.years_exp ?? "—"} />
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
              <Row label="Bye week" value={card.projection?.bye_week ?? "—"} />
              <Row
                label={card.projection ? `Week ${card.projection.current_week} opponent` : "Next opponent"}
                value={card.projection?.next_opponent ? `@ ${card.projection.next_opponent}` : "—"}
              />
              <Row
                label="Projected points (season)"
                value={card.projection ? card.projection.season_projected_points.toFixed(1) : "—"}
              />
              <Row
                label="Rostered %"
                value={card.projection ? `${card.projection.percent_owned.toFixed(1)}%` : "—"}
              />
            </div>
            {!card.projection && (
              <p className="text-center text-[0.7rem] text-black/40 dark:text-white/40">
                Live ESPN projections aren&apos;t available for this player right now.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BioStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.65rem] uppercase tracking-wide text-black/40 dark:text-white/40">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black/50 dark:text-white/50">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatHeight(height: string | null): string {
  if (!height) return "—";
  const inches = Number(height);
  if (Number.isNaN(inches)) return height;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
