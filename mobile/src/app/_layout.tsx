import { Anton_400Regular } from '@expo-google-fonts/anton';
import { GeistMono_500Medium, GeistMono_700Bold } from '@expo-google-fonts/geist-mono';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Satisfy_400Regular } from '@expo-google-fonts/satisfy';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, router, Stack, ThemeProvider, usePathname, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppTickerBar } from '@/components/AppTickerBar';
import { HoneycombBackground } from '@/components/HoneycombBackground';
import { IntroOverlay } from '@/components/IntroOverlay';
import { LaunchPicker } from '@/components/LaunchPicker';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Colors } from '@/constants/theme';
import { startErrorReporter, useScreenTracking } from '@/lib/analytics';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ChatSocketProvider } from '@/lib/chatSocket';
import { takeLinkForAfterSignIn } from '@/lib/inviteLinks';
import { queryClient, queryPersister, useMe } from '@/lib/queries';

SplashScreen.preventAutoHideAsync();
// Uncaught JavaScript errors go to Admin > Errors, like the web's.
startErrorReporter();

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

// The web shows its "This Week, Live" ticker strip on every page but
// Home, Chat and the signed-out pages. Tabs pin their own
// (components/TabFrame.tsx); every other screen gets it here, pinned
// under the header.
const NO_TICKER = /^(\(tabs\)|sign-in|chat\/|watch-party\/|lounge-room\/|lounge$)/;

function withTickerBar({ route, children }: { route: { name: string }; children: ReactNode }) {
  // The tabs draw their own banner and ticker (components/TabFrame.tsx).
  if (route.name === '(tabs)') return <>{children}</>;
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      {!NO_TICKER.test(route.name) && <AppTickerBar nflOnly={route.name.startsWith('start/')} />}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function RootStack() {
  const { token } = useAuth();
  useScreenTracking(Boolean(token));
  // The intro plays once per cold launch for a signed-in owner — a
  // relaunch after the app was closed, like the web's page load. Decided
  // once the saved session is known; signing in later doesn't replay it.
  const [intro, setIntro] = useState<'pending' | 'playing' | 'done'>('pending');
  if (intro === 'pending' && token !== undefined) setIntro(token ? 'playing' : 'done');
  const me = useMe(Boolean(token)).data;
  const displayName = me?.display_name ?? null;
  // A cold open's intro reveals the league picker (components/LaunchPicker.tsx),
  // drawn over the tabs from the start so the bloom opens onto it, not a
  // league — unless a notification or link already opened something
  // specific. Only when there's a choice to make: no league yet
  // (Join/Create) or two or more. In exactly one, the intro opens
  // straight onto its Home. Waits for /auth/me (the intro is still
  // playing over it) so the picker never flashes up and away.
  const [picker, setPicker] = useState(false);
  if (intro === 'pending' && token) setPicker(true);
  const pathname = usePathname();
  if (picker && (pathname !== '/' || me?.league_count === 1)) setPicker(false);
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
    Anton_400Regular,
    Satisfy_400Regular,
  });
  const ready = token !== undefined && fontsLoaded;

  // An invite link tapped while signed out opens once you've signed in
  // (lib/inviteLinks.ts); one tapped while signed in already opened.
  const [wasSignedIn, setWasSignedIn] = useState<boolean | null>(null);
  if (token !== undefined && wasSignedIn !== Boolean(token)) setWasSignedIn(Boolean(token));
  useEffect(() => {
    if (wasSignedIn === null) return;
    const link = takeLinkForAfterSignIn();
    if (wasSignedIn && link && link !== pathname) router.push(link as Href);
    // Only on sign-in/out, not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasSignedIn]);

  useEffect(() => {
    // Keep the splash up until the fonts are in and we know whether
    // there's a saved session, so a signed-in launch never flashes the
    // sign-in screen or a system font.
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <Stack
        screenLayout={withTickerBar}
        screenOptions={{
          // iOS's own header: the system font for titles (Oswald stays
          // for in-page headings) and a chevron-only back button.
          headerStyle: { backgroundColor: Colors.bg },
          headerTintColor: Colors.text,
          headerTitleStyle: { fontSize: 17, fontWeight: '600' },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}>
        <Stack.Protected guard={token !== null}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="matchup/[id]" options={{ title: 'Matchup', headerBackTitle: 'Back' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat', headerBackTitle: 'Chat' }} />
          <Stack.Screen name="waivers" options={{ title: 'My claims', headerBackTitle: 'Players' }} />
          <Stack.Screen name="player/[id]" options={{ title: 'Player', headerBackTitle: 'Back' }} />
          <Stack.Screen name="draft" options={{ title: 'Draft Room', headerBackTitle: 'Home' }} />
          <Stack.Screen name="recap/[season]/[week]" options={{ title: 'Recap' }} />
          <Stack.Screen name="admin/recaps" options={{ title: 'Recaps', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="gamecast/index" options={{ title: 'Gamecast' }} />
          <Stack.Screen name="gamecast/[id]" options={{ title: 'Gamecast', headerBackTitle: 'Back' }} />
          <Stack.Screen name="chug" options={{ title: 'Chug', headerBackTitle: 'Back' }} />
          <Stack.Screen name="owner/[id]" options={{ title: 'Owner', headerBackTitle: 'Back' }} />
          <Stack.Screen name="team/[id]" options={{ title: 'Team', headerBackTitle: 'Back' }} />
          <Stack.Screen name="awards/[season]" options={{ title: 'Awards', headerBackTitle: 'History' }} />
          <Stack.Screen name="cards" options={{ title: 'Player Cards', headerBackTitle: 'History' }} />
          <Stack.Screen name="draft-grades/[season]" options={{ title: 'Draft', headerBackTitle: 'History' }} />
          <Stack.Screen name="trades" options={{ title: 'Trades', headerBackTitle: 'Team' }} />
          <Stack.Screen name="keepers" options={{ title: 'Keepers', headerBackTitle: 'Team' }} />
          <Stack.Screen name="leagues" options={{ title: 'Leagues' }} />
          <Stack.Screen name="whats-new" options={{ title: "What's New", headerBackTitle: 'Back' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Back' }} />
          <Stack.Screen name="watch-party/[id]" options={{ title: 'Watch Party', headerBackTitle: 'Chat' }} />
          <Stack.Screen name="watch-party/new" options={{ title: 'Start a Party', presentation: 'modal' }} />
          <Stack.Screen name="watch-party/manage/[id]" options={{ title: 'Manage party', presentation: 'modal' }} />
          <Stack.Screen name="lounge-private" options={{ title: 'Private Lounge', headerBackTitle: 'Back' }} />
          <Stack.Screen name="lounge" options={{ title: 'The Lounge', headerBackTitle: 'Back' }} />
          <Stack.Screen name="punishment-wheel" options={{ title: 'Punishment Wheel', headerBackTitle: 'Back' }} />
          <Stack.Screen name="lounge-room/[slug]" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
          <Stack.Screen name="commissioner/index" options={{ title: 'Commissioner Tools', headerBackTitle: 'Back' }} />
          <Stack.Screen name="commissioner/league" options={{ title: 'League Settings', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/scoring" options={{ title: 'Scoring Rules', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/members" options={{ title: 'Members', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/teams" options={{ title: 'Teams', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/roster" options={{ title: 'Roster & Keepers', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/trades" options={{ title: 'Trades', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/polls" options={{ title: 'Polls', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="commissioner/espn" options={{ title: 'ESPN Connection', headerBackTitle: 'Tools' }} />
          <Stack.Screen name="admin/index" options={{ title: 'Admin', headerBackTitle: 'Back' }} />
          <Stack.Screen name="admin/live" options={{ title: 'Live', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/engagement" options={{ title: 'Engagement', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/navigation" options={{ title: 'Navigation', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/users/index" options={{ title: 'Users', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/users/[id]" options={{ title: 'User', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/leagues/index" options={{ title: 'Leagues', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/leagues/[id]" options={{ title: 'League', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/crashes" options={{ title: 'Crashes', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/errors/index" options={{ title: 'Errors', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/errors/[fp]" options={{ title: 'Error', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/security" options={{ title: 'Security', headerBackTitle: 'Admin' }} />
          <Stack.Screen name="admin/audit" options={{ title: 'Audit Log', headerBackTitle: 'Admin' }} />
        </Stack.Protected>
        <Stack.Protected guard={token === null}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {picker && token && me && <LaunchPicker onDismiss={() => setPicker(false)} />}
      {intro === 'playing' && <IntroOverlay displayName={displayName} onDone={() => setIntro('done')} />}
    </>
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
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.bg }}>
              <HoneycombBackground />
              <StatusBar style="light" />
              <RootStack />
            </GestureHandlerRootView>
          </ChatSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
