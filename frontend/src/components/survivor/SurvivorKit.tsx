import Image from "next/image";

import { ELITE, HEX_CLIP } from "@/components/elite/Elite";
import { teamLogoUrl } from "@/lib/nfl-teams";

// Shared pieces of the web's survivor pages (2026-11-07, canvas "Elite
// Survivor Pools"), the same as the app's components/survivor/SurvivorKit.

export const SURVIVOR_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WSH",
];

/** A win chance's color: neon for big favorites, orange for underdogs. */
export function pctColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return ELITE.blue;
  return pct >= 70 ? ELITE.green : pct >= 58 ? ELITE.mint : pct >= 50 ? ELITE.cream : ELITE.peach;
}

export function TeamLogo({ team, size = 28, dim = false }: { team: string | null; size?: number; dim?: boolean }) {
  const src = teamLogoUrl(team);
  if (!src) return <span style={{ width: size, height: size }} className="inline-block shrink-0" />;
  return <Image src={src} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ opacity: dim ? 0.3 : 1, filter: dim ? "grayscale(1)" : undefined }} />;
}

export function LivesPips({ left, total }: { left: number; total: number }) {
  return (
    <span className="inline-flex gap-[3px]" aria-label={`${left} of ${total} ${total === 1 ? "life" : "lives"} left`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="inline-block h-[12px] w-[10px]" style={{ clipPath: HEX_CLIP, background: i < left ? ELITE.green : "#2a323d" }} />
      ))}
    </span>
  );
}

export function livesText(left: number): string {
  return `${left} ${left === 1 ? "life" : "lives"} left`;
}

export function rulesLine(pool: { lives: number; tie_counts_as: string; double_from_week: number | null; buyback_until_week: number | null; missed_pick: string }): string {
  return [
    `${pool.lives} ${pool.lives === 1 ? "life" : "lives"}`,
    `ties count as ${pool.tie_counts_as === "win" ? "wins" : "losses"}`,
    pool.double_from_week ? `two picks a week from week ${pool.double_from_week}` : null,
    pool.buyback_until_week ? `buyback through week ${pool.buyback_until_week}` : null,
    pool.missed_pick === "auto" ? "a missed pick gets the biggest favorite you have left" : "a missed pick is a loss",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function kickoffText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
