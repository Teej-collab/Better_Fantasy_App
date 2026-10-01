import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveTicker } from '@/components/home/LiveTicker';
import { IntroOverlay } from '@/components/IntroOverlay';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useNflScoreboard } from '@/lib/queries';
import { buildNflTickerItems } from '@/lib/ticker';

export default function SignInScreen() {
  const { signInWithDiscord } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The front door (the web's OpeningExperience): the intro, then Enter
  // Here, before the sign-in buttons. Real NFL scores run along the
  // bottom the whole time (a public endpoint, fine while signed out).
  const [entered, setEntered] = useState(false);
  const games = useNflScoreboard().data ?? [];

  async function onDiscord() {
    setBusy(true);
    setError(null);
    const result = await signInWithDiscord();
    // On success the root layout's guard swaps to the tabs; nothing to do.
    if (!result.ok && !result.canceled) setError(result.message ?? 'Something went wrong signing you in.');
    setBusy(false);
  }

  if (!entered) {
    return (
      <IntroOverlay
        mode="enter"
        onDone={() => setEntered(true)}
        footer={<LiveTicker items={buildNflTickerItems(games)} fast={games.some((g) => g.state === 'in')} interactive={false} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Weekend League</Text>
        <Text style={styles.title}>Welcome back</Text>
      </View>

      <Pressable
        onPress={onDiscord}
        disabled={busy}
        style={({ pressed }) => [styles.discord, (pressed || busy) && styles.discordPressed]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.discordText}>Continue with Discord</Text>}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  hero: { alignItems: 'center', marginBottom: Spacing.xl * 2 },
  kicker: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  title: { color: Colors.text, fontSize: 32, fontWeight: '800', marginTop: Spacing.sm, textTransform: 'uppercase' },
  discord: {
    backgroundColor: Colors.discord,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  discordPressed: { opacity: 0.8 },
  discordText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: Colors.loss, textAlign: 'center', marginTop: Spacing.lg },
});
