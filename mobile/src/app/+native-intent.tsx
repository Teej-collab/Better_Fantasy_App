import { appPathForLink, rememberLinkForAfterSignIn } from '@/lib/inviteLinks';

// Every link that opens the app — a universal link from the website
// (https://…/start?join=CODE) or a weekendleague:// link — passes through
// here first, and comes out as the app screen it means (lib/inviteLinks.ts).
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const appPath = appPathForLink(path);
    // Remembered in case you're signed out: the sign-in screen shows
    // first, and the link opens right after (app/_layout.tsx).
    if (appPath !== '/' && !appPath.startsWith('/auth')) rememberLinkForAfterSignIn(appPath);
    return appPath;
  } catch {
    return '/';
  }
}
