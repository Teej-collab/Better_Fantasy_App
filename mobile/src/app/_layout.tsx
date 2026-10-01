import { GeistMono_500Medium, GeistMono_700Bold } from '@expo-google-fonts/geist-mono';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';

import { HoneycombBackground } from '@/components/HoneycombBackground';
import { Colors, Fonts } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ChatSocketProvider } from '@/lib/chatSocket';
import { queryClient, queryPersister } from '@/lib/queries';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    // Screens are see-through so the honeycomb behind the navigator
    // shows, like the web's fixed CinematicHoneycombBackground.
    background: 'transparent',
    card: Colors.surface,
    border: Colors.border,
    primary: Colors.accent,
    text: Colors.text,
  },
};

function RootStack() {
  const { token } = useAuth();
  const [fontsLoaded] = useFonts({
    Oswald_500Medium,
    Oswald_600SemiBold,
    Oswald_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    GeistMono_500Medium,
    GeistMono_700Bold,
  });
  const ready = token !== undefined && fontsLoaded;

  useEffect(() => {
    // Keep the splash up until the fonts are in and we know whether
    // there's a saved session, so a signed-in launch never flashes the
    // sign-in screen or a system font.
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.bg },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontFamily: Fonts.display },
        contentStyle: { backgroundColor: 'transparent' },
      }}>
      <Stack.Protected guard={token !== null}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="matchup/[id]" options={{ title: 'Matchup', headerBackTitle: 'Back' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat', headerBackTitle: 'Chat' }} />
        <Stack.Screen name="waivers" options={{ title: 'My claims', headerBackTitle: 'Players' }} />
        <Stack.Screen name="player/[id]" options={{ title: 'Player', headerBackTitle: 'Back' }} />
        <Stack.Screen name="draft" options={{ title: 'Draft Room', headerBackTitle: 'Home' }} />
        <Stack.Screen name="gamecast/[id]" options={{ title: 'Gamecast', headerBackTitle: 'Back' }} />
        <Stack.Screen name="chug" options={{ title: 'Chug', headerBackTitle: 'Back' }} />
        <Stack.Screen name="owner/[id]" options={{ title: 'Owner', headerBackTitle: 'Back' }} />
        <Stack.Screen name="team/[id]" options={{ title: 'Team', headerBackTitle: 'Back' }} />
        <Stack.Screen name="awards/[season]" options={{ title: 'Awards', headerBackTitle: 'History' }} />
        <Stack.Screen name="cards" options={{ title: 'Player Cards', headerBackTitle: 'History' }} />
        <Stack.Screen name="draft-grades/[season]" options={{ title: 'Draft', headerBackTitle: 'History' }} />
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
          <ChatSocketProvider>
            <View style={{ flex: 1, backgroundColor: Colors.bg }}>
              <HoneycombBackground />
              <StatusBar style="light" />
              <RootStack />
            </View>
          </ChatSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
