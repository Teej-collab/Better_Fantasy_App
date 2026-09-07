// "2026-09-21T20:00Z" -> "Sun 3:00 PM" — real ISO8601 from the backend
// (app/providers/nfl_scoreboard.py), formatted client-side so it
// renders in the visitor's own local time zone. Shared by MyTeamApp.tsx
// and FreeAgentsList.tsx — both render a player's next real game the
// same way.
export function formatGameTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${weekday} ${time}`;
}
