// Same format as the web app's formatGameTime (frontend/src/lib/gameTime.ts).
export function formatGameTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${weekday} ${time}`;
}

// The compact form for tight rows (2026-10-29: "Sun 12:00 PM" ran off a
// roster row at larger text sizes): "Sun 12p", "Mon 7:15p".
export function formatGameTimeShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const h = date.getHours();
  const m = date.getMinutes();
  return `${weekday} ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
}

export function formatPoints(points: number | null | undefined): string {
  return points === null || points === undefined ? '–' : points.toFixed(1);
}
