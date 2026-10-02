// Seasonal logos (like Snapchat's spider-web icon each October). Each
// season names a date window and its own copy of the emblem; outside
// every window the normal logo shows. Kept in step with the native app's
// mobile/src/lib/seasonal.ts. A window may cross New Year (winter).

export type Season = "halloween" | "winter";

const SEASONS: { season: Season; from: [number, number]; to: [number, number]; emblem: string }[] = [
  // Month is 1-based here.
  { season: "halloween", from: [10, 1], to: [11, 1], emblem: "/images/the-weekend-emblem-halloween.png" },
  { season: "winter", from: [12, 1], to: [1, 2], emblem: "/images/the-weekend-emblem-winter.png" },
];

const DEFAULT_EMBLEM = "/images/the-weekend-emblem.png";

function inWindow(date: Date, from: [number, number], to: [number, number]): boolean {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export function currentSeason(now: Date = new Date()): Season | null {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.season ?? null;
}

export function seasonalEmblem(now: Date = new Date()): string {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.emblem ?? DEFAULT_EMBLEM;
}
