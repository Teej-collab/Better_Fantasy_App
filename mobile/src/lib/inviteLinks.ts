import { toNativePath } from '@/lib/localNotifications';

// Universal links (2026-10): the website's links open the app when it's
// installed (frontend/public/.well-known/apple-app-site-association lists
// which ones). They arrive as web paths, so each maps to its app screen.
// app/+native-intent.tsx calls this for every link that opens the app.

/**
 * The app path for a website URL, a weekendleague:// link, or a path.
 * Always a single-slash app path: a plain home-screen launch arrives as
 * "weekendleague:///", and a path starting "//" would be read as an
 * outside web address and opened in Safari (a real bug in build 2).
 */
export function appPathForLink(url: string): string {
  let path = url.trim();
  const web = path.match(/^https?:\/\/[^/?#]+([^#]*)/i);
  if (web) path = web[1];
  const custom = path.match(/^weekendleague:\/\/(.*)$/i);
  if (custom) path = custom[1];
  // Anything else with a scheme isn't ours to open.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return '/';
  path = `/${path.replace(/^\/+/, '')}`;

  const query = (name: string) => path.match(new RegExp(`[?&]${name}=([^&#]+)`))?.[1];

  // A league invite: the web's Join flow with the code filled in.
  if (/^\/start(\/join)?(\?|$)/.test(path)) {
    const code = query('join') ?? query('code');
    return code ? `/start/join?code=${code}` : '/start';
  }
  // A co-owner invite: Leagues, with the code in its co-owner box.
  if (/^\/join-co-owner(\?|$)/.test(path)) {
    const code = query('code');
    return code ? `/leagues?coOwner=${code}` : '/leagues';
  }
  // A Lounge room.
  const lounge = path.match(/^\/lounge\/([^/?#]+)/);
  if (lounge) return `/lounge-room/${lounge[1]}`;
  const mapped = toNativePath(path);
  return mapped.startsWith('/') && !mapped.startsWith('//') ? mapped : '/';
}

// A link tapped while signed out waits here until sign-in finishes
// (app/_layout.tsx opens it then), so the invite isn't lost.
// Only a link from the last few minutes counts, so one tapped while
// already signed in never resurfaces at some later sign-in.
const PENDING_LINK_MS = 10 * 60_000;
let pendingLink: { path: string; at: number } | null = null;

export function rememberLinkForAfterSignIn(path: string): void {
  pendingLink = { path, at: Date.now() };
}

export function takeLinkForAfterSignIn(): string | null {
  const link = pendingLink;
  pendingLink = null;
  return link && Date.now() - link.at < PENDING_LINK_MS ? link.path : null;
}
