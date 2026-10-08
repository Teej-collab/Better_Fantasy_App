// Coming back after a long time away starts fresh, like ESPN's app: Home,
// new data, and the full intro (app/_layout.tsx). A notification or link
// that brought you back wins, though — you land where it points — so
// those mark the moment they open something.
export const AWAY_RESET_MS = 30 * 60_000;

let openedByLinkAt = 0;

export function markOpenedByLink(): void {
  openedByLinkAt = Date.now();
}

export function openedByLinkRecently(withinMs = 3_000): boolean {
  return Date.now() - openedByLinkAt < withinMs;
}
