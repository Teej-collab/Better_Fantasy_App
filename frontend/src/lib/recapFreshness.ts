// The week's recap drops Tuesday at noon PT (3 PM Eastern). Home shows
// it in full from then until the 3 AM ET waiver run Wednesday; after it
// shrinks to a "Missed the recap?" link until the next one drops.
// Same rule as the app's mobile/src/lib/livingHome.ts recapIsFresh.
const RECAP_DROP_HOUR_ET = 15;

export function recapIsFresh(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return (weekday === "Tue" && hour >= RECAP_DROP_HOUR_ET) || (weekday === "Wed" && hour < 3);
}
