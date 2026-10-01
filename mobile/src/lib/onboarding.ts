// What a brand-new account said it came to do on the sign-in screen
// ("Join a League" / "Create a League"). The no-league screen
// (components/NeedsLeague.tsx) picks it up once they're signed in and
// opens Leagues at that step, like the web's /leagues#join-league link.
export type LeagueIntent = 'join' | 'create';

let pendingIntent: LeagueIntent | null = null;

export function setPendingLeagueIntent(intent: LeagueIntent | null) {
  pendingIntent = intent;
}

export function takePendingLeagueIntent(): LeagueIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}
