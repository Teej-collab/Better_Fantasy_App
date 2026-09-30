import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function SignInScreen() {
  const { signInWithDiscord } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDiscord() {
    setBusy(true);
    setError(null);
    const result = await signInWithDiscord();
    // On success the root layout's guard swaps to the tabs; nothing to do.
    if (!result.ok && !result.canceled) setError(result.message ?? 'Something went wrong signing you in.');
    setBusy(false);
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
  screen: { flex: 1, backgroundColor: Colors.bg, justifyContent: 'center', padding: Spacing.xl },
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
