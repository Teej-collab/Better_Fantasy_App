// Same format as the web app's formatGameTime (frontend/src/lib/gameTime.ts).
export function formatGameTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${weekday} ${time}`;
}

export function formatPoints(points: number | null | undefined): string {
  return points === null || points === undefined ? '–' : points.toFixed(1);
}
