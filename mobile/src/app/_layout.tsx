import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';

import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient, queryPersister } from '@/lib/queries';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.bg,
    card: Colors.surface,
    border: Colors.border,
    primary: Colors.accent,
    text: Colors.text,
  },
};

function RootStack() {
  const { token } = useAuth();

  useEffect(() => {
    // Keep the splash up until we know whether there's a saved session,
    // so a signed-in launch never flashes the sign-in screen.
    if (token !== undefined) SplashScreen.hideAsync();
  }, [token]);

  if (token === undefined) return null;

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: Colors.bg }, headerTintColor: Colors.text }}>
      <Stack.Protected guard={token !== null}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="matchup/[id]" options={{ title: 'Matchup', headerBackTitle: 'Back' }} />
      </Stack.Protected>
      <Stack.Protected guard={token === null}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // A different account must never see the previous one's cached data.
  const clearCache = useCallback(() => {
    queryClient.clear();
    void queryPersister.removeClient();
  }, []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister }}>
      <ThemeProvider value={theme}>
        <AuthProvider onSignOut={clearCache}>
          <StatusBar style="light" />
          <RootStack />
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
