import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { API_BASE_URL, api, setSessionToken, setUnauthorizedHandler } from '@/lib/api';
import { endAll as endAllLiveActivities } from '@/lib/liveActivity';
import { unregisterForPush } from '@/lib/pushRegistration';

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

// RN's URL.searchParams isn't reliable across engines; the callback is
// always weekendleague://auth/native-complete?ticket=… or ?error=….
function queryParam(url: string, name: string): string | null {
  const match = url.match(new RegExp(`[?&]${name}=([^&#]+)`));
  return match ? decodeURIComponent(match[1]) : null;
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
    onSignOut();
  }, [applyToken, onSignOut]);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((saved) => {
        setSessionToken(saved);
        setToken(saved);
        // Sessions saved before 2026-10 were locked with the phone; re-save them.
        if (saved) void saveToken(saved).catch(() => {});
      })
      .catch(() => setToken(null));
  }, []);

  useEffect(() => {
    // An expired or revoked session anywhere in the app signs out.
    // The session is already dead server-side, so just forget it here
    // (calling signOut would make another request that 401s).
    setUnauthorizedHandler(() => {
      void applyToken(null).then(onSignOut);
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
