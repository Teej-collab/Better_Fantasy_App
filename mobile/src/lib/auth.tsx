import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { API_BASE_URL, api, setSessionToken, setUnauthorizedHandler } from '@/lib/api';

const TOKEN_KEY = 'weekend-league.session';

// Must match app.json's "scheme" and the backend's
// NATIVE_APP_CUSTOM_SCHEME (default "weekendleague"). The backend's
// native OAuth callback redirects here with a one-time ticket
// (backend/app/routers/auth.py, _native_completion_url).
const CALLBACK_URL = 'weekendleague://auth';

const ERROR_MESSAGES: Record<string, string> = {
  not_a_league_member: "That Discord account isn't linked to a league member yet.",
};

type SignInResult = { ok: true } | { ok: false; canceled: boolean; message?: string };

type AuthState = {
  // undefined while the saved token is still being read.
  token: string | null | undefined;
  signInWithDiscord: () => Promise<SignInResult>;
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
    if (next) await SecureStore.setItemAsync(TOKEN_KEY, next);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const signOut = useCallback(async () => {
    // Ends the session server-side too; signing out locally still
    // happens if the network call fails.
    await api.logout().catch(() => {});
    await applyToken(null);
    onSignOut();
  }, [applyToken, onSignOut]);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((saved) => {
        setSessionToken(saved);
        setToken(saved);
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

  const signInWithDiscord = useCallback(async (): Promise<SignInResult> => {
    // iOS runs this in an in-app sign-in sheet (ASWebAuthenticationSession)
    // that closes itself when the backend redirects to CALLBACK_URL.
    const result = await WebBrowser.openAuthSessionAsync(
      `${API_BASE_URL}/auth/discord/login?client=native`,
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

  const value = useMemo(() => ({ token, signInWithDiscord, signOut }), [token, signInWithDiscord, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
