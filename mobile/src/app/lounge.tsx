import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { Colors, Fonts, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api, WEB_BASE_URL } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useLoungeRooms } from '@/lib/queries';
import type { LoungeRoom } from '@/lib/types';
import { openSignedInWeb } from '@/lib/webHandoff';

function shareUrl(slug: string) {
  return `${WEB_BASE_URL}/lounge/${slug}`;
}

// Port of the web's /lounge: start a password-protected video room
// anyone can join from the link (no league or account needed), and
// manage the ones you've made. The call itself opens in the in-app
// browser; as the room's creator you go straight in, no password.
export default function LoungeScreen() {
  const accent = useAppearance().accent;
  const rooms = useLoungeRooms();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canCreate = !busy && !!name.trim() && !!password;

  function enter(slug: string) {
    const nameParam = displayName.trim() ? `&name=${encodeURIComponent(displayName.trim())}` : '';
    return openSignedInWeb(`/lounge/${slug}?join=1${nameParam}`).finally(() => {
      void queryClient.invalidateQueries({ queryKey: ['lounge-rooms'] });
    });
  }

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const room = await api.createLoungeRoom(name.trim(), password);
      setName('');
      setPassword('');
      void queryClient.invalidateQueries({ queryKey: ['lounge-rooms'] });
      await enter(room.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the lounge.");
    } finally {
      setBusy(false);
    }
  }

  async function rejoin(room: LoungeRoom) {
    setJoiningRoomId(room.id);
    setError(null);
    try {
      await enter(room.slug);
    } finally {
      setJoiningRoomId(null);
    }
  }

  function confirmClose(room: LoungeRoom) {
    Alert.alert(`Close "${room.name}"?`, 'Its link stops working for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => {
          api
            .closeLoungeRoom(room.id)
            .then(() => queryClient.invalidateQueries({ queryKey: ['lounge-rooms'] }))
            .catch((e) => setError(e instanceof Error ? e.message : "Couldn't close the lounge."));
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl />} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Lounge' }} />
      <View style={styles.intro}>
        <Display style={styles.title}>Lounge</Display>
        <Text style={styles.introText}>
          Start a password-protected video room and share the link with anyone — no league required, and no account needed
          to join.
        </Text>
      </View>

      <NeonPanel color={SectionColors.chat} contentStyle={styles.gap}>
        <TextInput value={name} onChangeText={setName} placeholder="Room name" placeholderTextColor="rgba(255,255,255,0.4)" style={styles.input} />
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your display name (optional)"
          placeholderTextColor="rgba(255,255,255,0.4)"
          maxLength={40}
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Set a password"
          placeholderTextColor="rgba(255,255,255,0.4)"
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable onPress={create} disabled={!canCreate} style={[styles.primary, { backgroundColor: accent }, !canCreate && styles.disabled]}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Create & enter lounge</Text>}
        </Pressable>
      </NeonPanel>

      {!!rooms.data?.length && (
        <View style={styles.gap}>
          <Text style={styles.heading}>Your lounges</Text>
          {rooms.data.map((room) => (
            <View key={room.id} style={styles.room}>
              <View style={styles.roomHead}>
                <Text style={styles.roomName}>{room.name}</Text>
                {room.closed ? (
                  <Text style={styles.closed}>Closed</Text>
                ) : (
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => rejoin(room)}
                      disabled={joiningRoomId === room.id}
                      style={[styles.join, { backgroundColor: accent }, joiningRoomId === room.id && styles.disabled]}>
                      <Text style={styles.joinText}>{joiningRoomId === room.id ? 'Joining…' : 'Join'}</Text>
                    </Pressable>
                    <Pressable onPress={() => confirmClose(room)} style={styles.outline}>
                      <Text style={styles.outlineText}>Close</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              {!room.closed && (
                <View style={styles.linkRow}>
                  <Text style={styles.link} numberOfLines={1}>
                    {shareUrl(room.slug)}
                  </Text>
                  <Pressable onPress={() => Share.share({ url: shareUrl(room.slug), message: shareUrl(room.slug) })} style={styles.outlineSm}>
                    <Text style={styles.outlineSmText}>Share link</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  gap: { gap: Spacing.md },
  intro: { alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: 30, textTransform: 'none', letterSpacing: 0 },
  introText: { maxWidth: 340, color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  input: { backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  error: { color: Colors.loss, fontSize: 14 },
  primary: { borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: 10, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  heading: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  room: { backgroundColor: Colors.surface, gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: Spacing.lg },
  roomHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  roomName: { flexShrink: 1, color: Colors.text, fontSize: 15, fontWeight: '600' },
  closed: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  join: { borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  joinText: { color: '#000', fontSize: 12, fontWeight: '600' },
  outline: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4 },
  outlineText: { color: Colors.text, fontSize: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  link: { flex: 1, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: Fonts.mono },
  outlineSm: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 2 },
  outlineSmText: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
});
