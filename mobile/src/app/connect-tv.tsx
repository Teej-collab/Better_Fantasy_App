import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import type { PairedTv } from '@/lib/types';

// Connect a TV (2026-11-14, The Weekend TV): type the code your
// Chromecast shows (or scan its QR code, which opens this screen with the
// code filled in) and it signs in as you, watch-only. Also your connected
// TVs, each one disconnectable. Same screen as the website's /tv.

function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function shown(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export default function ConnectTvScreen() {
  const accent = useAppearance().accent;
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() => cleanCode(params.code ?? ''));
  const [tvs, setTvs] = useState<PairedTv[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTvs(await api.listTvs());
    } catch {
      setError("Couldn't load your TVs.");
    }
  }, []);

  useEffect(() => {
    api
      .listTvs()
      .then(setTvs)
      .catch(() => setError("Couldn't load your TVs."));
  }, []);

  async function connect() {
    if (busy || code.length < 8) return;
    haptics.tap();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { device_name } = await api.approveTv(code);
      haptics.success();
      setDone(`${device_name} is connected. It'll go live in a few seconds.`);
      setCode('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  function disconnect(tv: PairedTv) {
    Alert.alert(`Disconnect ${tv.name}?`, "It'll need a new code to come back.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.disconnectTv(tv.id);
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Try again in a moment.');
          }
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Connect a TV' }} />

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Put your league on the big screen</Text>
        <Text style={styles.heroBody}>
          Open The Weekend on your TV and type the code it shows, or point your camera at the TV&apos;s QR code. The TV can only watch: no lineups, trades or chat.
        </Text>
      </View>

      <View style={styles.gap}>
        <Text style={styles.section}>CODE ON YOUR TV</Text>
        <TextInput
          value={shown(code)}
          onChangeText={(t) => setCode(cleanCode(t))}
          placeholder="K7QM-4XPR"
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="go"
          onSubmitEditing={() => void connect()}
          maxLength={9}
          style={[styles.code, code.length === 8 && { borderColor: accent }]}
          accessibilityLabel="Code on your TV"
        />
        <Pressable
          onPress={() => void connect()}
          disabled={busy || code.length < 8}
          style={[styles.cta, { backgroundColor: accent }, (busy || code.length < 8) && styles.disabled]}
          accessibilityRole="button">
          {busy ? <ActivityIndicator color="#06110a" /> : <Text style={styles.ctaText}>Connect TV</Text>}
        </Pressable>
        {done && <Text style={[styles.done, { color: accent }]}>{done}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.gap}>
        <Text style={styles.section}>YOUR TVS</Text>
        {tvs === null ? (
          <ActivityIndicator color={accent} />
        ) : tvs.length === 0 ? (
          <Text style={styles.muted}>No TVs connected.</Text>
        ) : (
          tvs.map((tv) => (
            <View key={tv.id} style={styles.tv}>
              <View style={styles.tvText}>
                <Text style={styles.name}>{tv.name}</Text>
                <Text style={styles.muted}>
                  Connected {new Date(tv.created_at).toLocaleDateString()}
                  {tv.last_seen_at ? ` · last on ${new Date(tv.last_seen_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => disconnect(tv)} style={styles.btn} accessibilityRole="button" accessibilityLabel={`Disconnect ${tv.name}`}>
                <Text style={styles.btnText}>Disconnect</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  gap: { gap: Spacing.sm },
  hero: { gap: 6, padding: Spacing.lg, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  heroTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  heroBody: { color: '#c7ccd6', fontSize: 14, lineHeight: 20 },
  section: { color: '#9aa3b2', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  code: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    color: Colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: 14,
  },
  cta: { minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#06110a', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  done: { fontSize: 14, fontWeight: '600' },
  error: { color: Colors.loss, fontSize: 14 },
  muted: { color: '#9aa3b2', fontSize: 12 },
  tv: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tvText: { flex: 1, gap: 2 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  btn: { minHeight: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,90,90,0.4)', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: Colors.loss, fontSize: 12, fontWeight: '800' },
});
