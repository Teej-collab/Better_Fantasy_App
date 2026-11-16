import { markOpenedByLink } from '@/lib/freshStart';
import { appPathForLink, rememberLinkForAfterSignIn } from '@/lib/inviteLinks';
import { isShareLink } from '@/lib/shareIntent';

// Every link that opens the app — a universal link from the website
// (https://…/start?join=CODE) or a weekendleague:// link — passes through
// here first, and comes out as the app screen it means (lib/inviteLinks.ts).
// A bet slip shared from a sportsbook app opens Add a Bet (lib/shareIntent.ts).
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  // The Discord/Google sign-in callback (lib/auth.tsx) belongs to the
  // sign-in sheet that's waiting for it, not to a screen. iOS's sheet
  // catches it before the router ever sees it; Android's browser tab
  // hands it to the app like any other link, and it landed on "Unmatched
  // Route" (2026-11-16, first Android build). Stay put instead.
  if (/^(weekendleague:\/\/)?\/?auth\/native-complete/i.test(path)) return initial ? '/' : null;
  try {
    const appPath = isShareLink(path) ? `/bets/add?shared=${Date.now()}` : appPathForLink(path);
    markOpenedByLink();
    // Remembered in case you're signed out: the sign-in screen shows
    // first, and the link opens right after (app/_layout.tsx).
    if (appPath !== '/' && appPath !== '/?' && !appPath.startsWith('/auth')) rememberLinkForAfterSignIn(appPath);
    return appPath;
  } catch {
    return '/';
  }
}
