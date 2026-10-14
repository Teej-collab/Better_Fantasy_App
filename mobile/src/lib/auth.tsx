import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { API_BASE_URL, api, setSessionToken, setUnauthorizedHandler } from '@/lib/api';
import { endAll as endAllLiveActivities } from '@/lib/liveActivity';
import { unregisterForPush } from '@/lib/pushRegistration';
import { updateMatchupWidget } from '@/lib/homeWidget';

export const TOKEN_KEY = 'weekend-league.session';
// Readable after the phone's first unlock since boot, not only while it's
// unlocked: the background widget refresh (lib/backgroundTasks.ts) runs
// with the phone locked. Still never leaves the device or its backups.
export const TOKEN_STORE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// Saves the session with TOKEN_STORE_OPTIONS. iOS keeps an existing item's
// accessibility on update, so the old entry is removed first.
async function saveToken(token: string) {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  await SecureStore.setItemAsync(TOKEN_KEY, token, TOKEN_STORE_OPTIONS);
}

// Must match app.json's "scheme" and the backend's
// NATIVE_APP_CUSTOM_SCHEME (default "weekendleague"). The backend's
// native OAuth callback redirects here with a one-time ticket
// (backend/app/routers/auth.py, _native_completion_url).
const CALLBACK_URL = 'weekendleague://auth';

const ERROR_MESSAGES: Record<string, string> = {
  not_a_league_member: "That Discord account isn't linked to a league member yet.",
  link_failed: "Couldn't link your accounts. Ask your commissioner for help.",
};

type SignInResult = { ok: true } | { ok: false; canceled: boolean; message?: string };

type AuthState = {
  // undefined while the saved token is still being read.
  token: string | null | undefined;
  signInWithDiscord: () => Promise<SignInResult>;
  signInWithGoogle: () => Promise<SignInResult>;
  signInWithApple: () => Promise<SignInResult>;
  // Signed in with a newer login (Apple/Google/email) but your history is on
  // your original Discord account: verify with Discord and this login moves
  // onto that account (backend/app/domain/account_link.py).
  linkWithDiscord: () => Promise<SignInResult>;
  // For a session token from email sign-in/sign-up, or the refreshed one
  // claiming a team or redeeming a co-owner invite hands back.
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Seconds until the session expires, from its JWT `exp` claim; null if
// it can't be read (then it's just never refreshed early).
function secondsLeft(token: string): number | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))) as { exp?: number };
    return typeof exp === 'number' ? exp - Date.now() / 1000 : null;
  } catch {
    return null;
  }
}

// Sessions last 30 days from when they were issued. Swapping in a fresh
// one once a day while the app is in use keeps an active owner signed
// in for good (2026-10-14: Niko kept being signed out a month after
// signing in, however much he used the app).
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_AFTER_SECONDS = 24 * 60 * 60;

// RN's URL.searchParams isn't reliable across engines; the callback is
// always weekendleague://auth/native-complete?ticket=… or ?error=….
function queryParam(url: string, name: string): string | null {
  const match = url.match(new RegExp(`[?&]${name}=([^&#]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Signed out: the Matchup widget stops showing your score. Only here — it
// used to run whenever the tabs unmounted, and an app reload (applying an
// accent color) unmounts them too, which blanked a signed-in widget to
// "No matchup this week" mid-game.
function clearWidgets(): void {
  updateMatchupWidget(null);
}

export function AuthProvider({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  const applyToken = useCallback(async (next: string | null) => {
    setSessionToken(next);
    setToken(next);
    if (next) await saveToken(next);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const signOut = useCallback(async () => {
    // Ends the session server-side too; signing out locally still
    // happens if the network call fails. This phone's push token goes
    // first, while the session still works.
    await endAllLiveActivities().catch(() => {});
    await unregisterForPush().catch(() => {});
    await api.logout().catch(() => {});
    await applyToken(null);
    clearWidgets();
    onSignOut();
  }, [applyToken, onSignOut]);

  useEffect(() => {
    // A read that fails isn't "signed out". iOS can wake the app in the
    // background (the game-day widget refresh) while the phone is locked,
    // when the keychain may refuse the read; treating that as no session
    // left the app sitting on the sign-in screen for the next open, with
    // the saved session still there (2026-10-14). Retry instead: right
    // away a few times, and again whenever the app comes to the front.
    // Only a read that keeps failing while the app is open gives up.
    let cancelled = false;
    let failures = 0;
    let sub: { remove: () => void } | null = null;
    const load = () => {
      SecureStore.getItemAsync(TOKEN_KEY)
        .then((saved) => {
          if (cancelled) return;
          sub?.remove();
          setSessionToken(saved);
          setToken(saved);
          // Sessions saved before 2026-10 were locked with the phone; re-save them.
          if (saved) void saveToken(saved).catch(() => {});
        })
        .catch(() => {
          if (cancelled) return;
          failures += 1;
          if (AppState.currentState !== 'active') {
            sub ??= AppState.addEventListener('change', (state) => {
              if (state === 'active') load();
            });
          } else if (failures < 4) {
            setTimeout(load, 300 * failures);
          } else {
            sub?.remove();
            setToken(null);
          }
        });
    };
    load();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // Keep the session rolling: on open and on every return to the app,
  // swap in a fresh one if this one is more than a day old. A failure
  // here never signs out on its own (offline, server busy); only the
  // server saying the session is over does, through request()'s 401.
  const refreshing = useRef(false);
  useEffect(() => {
    if (!token) return;
    const maybeRefresh = () => {
      if (refreshing.current || AppState.currentState !== 'active') return;
      const left = secondsLeft(token);
      if (left === null || SESSION_SECONDS - left < REFRESH_AFTER_SECONDS) return;
      refreshing.current = true;
      api
        .refreshSession()
        .then(({ token: fresh }) => applyToken(fresh))
        .catch(() => {})
        .finally(() => {
          refreshing.current = false;
        });
    };
    maybeRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeRefresh();
    });
    return () => sub.remove();
  }, [token, applyToken]);

  useEffect(() => {
    // An expired or revoked session anywhere in the app signs out.
    // The session is already dead server-side, so just forget it here
    // (calling signOut would make another request that 401s).
    setUnauthorizedHandler(() => {
      void applyToken(null).then(() => {
        clearWidgets();
        onSignOut();
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [applyToken, onSignOut]);

  // Discord and Google run the same flow (backend /auth/{provider}/login
  // ?client=native → a ticket on the weekendleague:// callback).
  const signInWith = useCallback(async (provider: 'discord' | 'google'): Promise<SignInResult> => {
    // iOS runs this in an in-app sign-in sheet (ASWebAuthenticationSession)
    // that closes itself when the backend redirects to CALLBACK_URL.
    const result = await WebBrowser.openAuthSessionAsync(
      `${API_BASE_URL}/auth/${provider}/login?client=native`,
      CALLBACK_URL,
    );
    if (result.type !== 'success') return { ok: false, canceled: true };

    const error = queryParam(result.url, 'error');
    if (error) return { ok: false, canceled: false, message: ERROR_MESSAGES[error] ?? 'Something went wrong signing you in.' };
    const ticket = queryParam(result.url, 'ticket');
    if (!ticket) return { ok: false, canceled: false, message: 'Something went wrong signing you in.' };

    try {
      const { token: sessionToken } = await api.redeemNativeTicket(ticket);
      await applyToken(sessionToken);
      return { ok: true };
    } catch {
      return { ok: false, canceled: false, message: 'That sign-in link expired. Try again.' };
    }
  }, [applyToken]);
  const signInWithDiscord = useCallback(() => signInWith('discord'), [signInWith]);
  const signInWithGoogle = useCallback(() => signInWith('google'), [signInWith]);

  // Sign in with Apple (2026-10, required by App Review alongside
  // Google and Discord): the system sheet hands back an identity token
  // the backend verifies with Apple — no browser round trip. The name
  // only comes on the very first authorization, so it rides along.
  const signInWithApple = useCallback(async (): Promise<SignInResult> => {
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { ok: false, canceled: true };
      return { ok: false, canceled: false, message: "Couldn't sign in with Apple. Try again." };
    }
    if (!credential.identityToken) return { ok: false, canceled: false, message: "Couldn't sign in with Apple. Try again." };
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ') || null;
    try {
      const { token: sessionToken } = await api.appleSignIn(credential.identityToken, fullName, credential.authorizationCode);
      await applyToken(sessionToken);
      return { ok: true };
    } catch (e) {
      return { ok: false, canceled: false, message: e instanceof Error ? e.message : "Couldn't sign in with Apple. Try again." };
    }
  }, [applyToken]);

  const linkWithDiscord = useCallback(async (): Promise<SignInResult> => {
    let ticket: string;
    try {
      ticket = (await api.discordLinkTicket()).ticket;
    } catch {
      return { ok: false, canceled: false, message: "Couldn't start the Discord check. Try again." };
    }
    const result = await WebBrowser.openAuthSessionAsync(
      `${API_BASE_URL}/auth/discord/login?client=native&link=${encodeURIComponent(ticket)}`,
      CALLBACK_URL,
    );
    if (result.type !== 'success') return { ok: false, canceled: true };
    const error = queryParam(result.url, 'error');
    if (error) return { ok: false, canceled: false, message: ERROR_MESSAGES[error] ?? 'Something went wrong with Discord.' };
    const confirm = queryParam(result.url, 'link');
    if (!confirm) return { ok: false, canceled: false, message: 'Something went wrong with Discord.' };
    try {
      const { token: sessionToken } = await api.confirmDiscordLink(confirm);
      await applyToken(sessionToken);
      return { ok: true };
    } catch (e) {
      return { ok: false, canceled: false, message: e instanceof Error ? e.message : "Couldn't link your accounts." };
    }
  }, [applyToken]);

  const signInWithToken = useCallback((next: string) => applyToken(next), [applyToken]);

  const value = useMemo(
    () => ({ token, signInWithDiscord, signInWithGoogle, signInWithApple, linkWithDiscord, signInWithToken, signOut }),
    [token, signInWithDiscord, signInWithGoogle, signInWithApple, linkWithDiscord, signInWithToken, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
