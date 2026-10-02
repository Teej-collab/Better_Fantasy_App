// Seasonal logos (like Snapchat's spider-web icon each October). Each
// season names a date window and its own copy of the emblem; outside
// every window the normal logo shows. Kept in step with the native app's
// mobile/src/lib/seasonal.ts.

export type Season = "halloween";

const SEASONS: { season: Season; from: [number, number]; to: [number, number]; emblem: string }[] = [
  // Oct 1 – Nov 1 (month is 1-based here).
  { season: "halloween", from: [10, 1], to: [11, 1], emblem: "/images/weekend-league-emblem-halloween.png" },
];

function inWindow(date: Date, from: [number, number], to: [number, number]): boolean {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  return md >= from[0] * 100 + from[1] && md <= to[0] * 100 + to[1];
}

export function currentSeason(now: Date = new Date()): Season | null {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.season ?? null;
}

export function seasonalEmblem(now: Date = new Date()): string {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.emblem ?? "/images/weekend-league-emblem.png";
}
