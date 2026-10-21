import type { MatchupContextSide, NflGame, RosterEntry, YourWeek } from "@/lib/api";

// The Living Home (2026-10-20): the website's copy of the app's
// mobile/src/lib/livingHome.ts, so both show the same screen for the
// same moment. Keep the two in step.

// The home switch: Living Home unless this cookie says classic. Read
// server-side by app/(home)/page.tsx; set from either home's footer.
export const HOME_LAYOUT_COOKIE = "wl_home";

export function setHomeLayout(layout: "living" | "classic") {
  document.cookie = `${HOME_LAYOUT_COOKIE}=${layout}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

// The fantasy week's moods, in the order a week goes.
export type HomePhase =
  | "recap" // Tuesday after the flip: last week's story
  | "waivers" // Wednesday: what the 3 AM run did, the new matchup
  | "lock" // a game today with one of your starters in it
  // Each other day its own screen: Thursday through Monday before your
  // players' games.
  | "thu"
  | "fri"
  | "sat"
  | "sun"
  | "mon"
  | "live" // games on with your players in them
  | "sweat" // Sunday night or Monday with your matchup undecided
  | "final"; // your matchup is done, the week hasn't flipped yet

// Eastern time, the league's clock, worked out by hand (same as the app).
// US rules: EDT from the second Sunday in March, 2 AM, to the first
// Sunday in November, 2 AM.
function nthSundayUtc(year: number, month: number, n: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - firstDay) % 7) + 7 * (n - 1);
}

function etOffsetHours(when: Date): number {
  const year = when.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthSundayUtc(year, 2, 2), 7);
  const dstEnd = Date.UTC(year, 10, nthSundayUtc(year, 10, 1), 6);
  const t = when.getTime();
  return t >= dstStart && t < dstEnd ? -4 : -5;
}

function etWall(when: Date): Date {
  return new Date(when.getTime() + etOffsetHours(when) * 60 * 60 * 1000);
}

export function etDayHour(when: Date): { day: number; hour: number } {
  const wall = etWall(when);
  return { day: wall.getUTCDay(), hour: wall.getUTCHours() };
}

export function sameEtDay(a: Date, b: Date): boolean {
  return etWall(a).toISOString().slice(0, 10) === etWall(b).toISOString().slice(0, 10);
}

// The next time it's `day` at `hour`:00 Eastern, stepping an hour at a time.
export function nextEt(day: number, hour: number, from = new Date()): Date {
  const t = new Date(from);
  t.setMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    t.setTime(t.getTime() + 60 * 60 * 1000);
    const et = etDayHour(t);
    if (et.day === day && et.hour === hour) return t;
  }
  return t;
}

// The betting weekend: Thursday 6 AM Eastern until Tuesday 6 AM.
export function inBetsWeekend(now = new Date()): boolean {
  const { day, hour } = etDayHour(now);
  if (day === 4) return hour >= 6;
  if (day === 2) return hour < 6;
  return day === 5 || day === 6 || day === 0 || day === 1;
}

export function isStarter(slot: string | null | undefined): boolean {
  return !!slot && !["BE", "IR", "TAXI"].includes(slot);
}

export function matchupDone(myWeek: YourWeek | null): boolean {
  const m = myWeek?.matchup;
  return !!m && m.started && m.my_yet_to_play + m.my_in_play + m.opponent_yet_to_play + m.opponent_in_play === 0;
}

export function startersPlayingToday(roster: RosterEntry[], now = new Date()): RosterEntry[] {
  return roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.game_time && sameEtDay(new Date(p.game_time), now));
}

export function homePhase({
  now = new Date(),
  myWeek,
  games,
  roster,
}: {
  now?: Date;
  myWeek: YourWeek | null;
  games: NflGame[];
  roster: RosterEntry[];
}): HomePhase {
  const { day } = etDayHour(now);
  const m = myWeek?.matchup;
  if (matchupDone(myWeek)) return "final";
  const live = games.some((g) => g.state === "in");
  if (m?.started && live) return day === 1 ? "sweat" : "live";
  if (m?.started && day === 1) return "sweat";
  const moreToday = games.some((g) => g.state === "pre" && g.date && sameEtDay(new Date(g.date), now));
  if (m?.started && day === 0 && !moreToday) return "sweat";
  if (day === 2) return "recap";
  if (day === 3) return "waivers";
  if (startersPlayingToday(roster, now).length > 0) return "lock";
  return (["sun", "mon", "recap", "waivers", "thu", "fri", "sat"] as const)[day];
}

export const PHASE_COLOR: Record<HomePhase, string> = {
  recap: "#f5b942",
  waivers: "#4cc3ff",
  lock: "#ff8a3d",
  thu: "#2dd4bf",
  fri: "#f472b6",
  sat: "#c084fc",
  sun: "#facc15",
  mon: "#60a5fa",
  live: "#39ff14",
  sweat: "#ff8a3d",
  final: "#39ff14",
};

export function dayName(now = new Date()): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][etDayHour(now).day];
}

export function untilText(target: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmt(points: number | null | undefined): string {
  return points == null ? "–" : points.toFixed(1);
}

export function sideFor<T extends { home: MatchupContextSide; away: MatchupContextSide }>(
  items: T[],
  teamId: number,
): { item: T; me: MatchupContextSide; them: MatchupContextSide } | null {
  for (const item of items) {
    if (item.home.team_id === teamId) return { item, me: item.home, them: item.away };
    if (item.away.team_id === teamId) return { item, me: item.away, them: item.home };
  }
  return null;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
