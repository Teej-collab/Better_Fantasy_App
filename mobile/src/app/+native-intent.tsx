import { markOpenedByLink } from '@/lib/freshStart';
import { appPathForLink, rememberLinkForAfterSignIn } from '@/lib/inviteLinks';
import { isShareLink } from '@/lib/shareIntent';

// Every link that opens the app — a universal link from the website
// (https://…/start?join=CODE) or a weekendleague:// link — passes through
// here first, and comes out as the app screen it means (lib/inviteLinks.ts).
// A bet slip shared from a sportsbook app opens Add a Bet (lib/shareIntent.ts).
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
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
