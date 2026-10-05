import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { LiveDot } from '@/components/watchparty/WatchPartyBar';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useMe, useWatchPartyRooms } from '@/lib/queries';
import type { WatchPartyRoom } from '@/lib/types';
import { nativeLoungeAvailable, partySlug, setLoungeTicket } from '@/lib/loungeSession';
import { useWatchPartySocket } from '@/lib/watchPartySocket';
import { openSignedInWeb } from '@/lib/webHandoff';

function useFantasyDigest(roomId: number) {
  const { digest, connected } = useWatchPartySocket(roomId);
  return { digest, connected };
}

// A Watch Party room. The web runs the call inside Chat (LiveKit's
// VideoConference with chat, volume and scores panels); here the room
// is a native screen with its chat and the fantasy ticker, and the
// call itself opens in the in-app browser, signed in.
export default function WatchPartyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = Number(id);
  const rooms = useWatchPartyRooms();
  const room = rooms.data && [rooms.data.open_room, ...rooms.data.private_rooms].find((r) => r.id === roomId);

  if (rooms.isPending) return <LoadingState />;
  if (!room) return <MessageState message="This party isn't available — it may have ended, or you weren't invited." />;
  return <RoomBody room={room} />;
}

function RoomBody({ room }: { room: WatchPartyRoom }) {
  const accent = useAppearance().accent;
  const myOwnerId = useMe().data?.owner_id;
  const { digest, connected } = useFantasyDigest(room.id);
  const [opening, setOpening] = useState(false);
  const isOpenRoom = room.kind === 'open';
  const title = isOpenRoom ? 'League Lounge' : room.name;

  async function joinVideo() {
    setOpening(true);
    try {
      if (nativeLoungeAvailable()) {
        // In our own app builds the call runs natively (app/lounge-room/[slug].tsx).
        const r = await api.watchPartyToken(room.id);
        const slug = partySlug(room.id);
        setLoungeTicket({ token: r.token, url: r.url, roomName: title, slug });
        router.push(`/lounge-room/${slug}` as Href);
        return;
      }
      await openSignedInWeb(`/chat?party=${room.id}`);
    } catch (e) {
      Alert.alert("Couldn't join the call", e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setOpening(false);
      void queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] });
    }
  }

  function openChat() {
    router.push({ pathname: '/chat/[id]', params: { id: String(room.conversation_id), title } });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title }} />
      <View style={styles.gapSm}>
        <View style={styles.titleRow}>
          {!isOpenRoom && <Text style={styles.lock}>🔒</Text>}
          <Display style={styles.title}>{title}</Display>
          {room.is_live && <LiveDot />}
        </View>
        <Text style={styles.soft}>
          {room.is_live
            ? "Someone's in the room now"
            : isOpenRoom
              ? `${room.member_count} in your league · always open`
              : `${room.member_count} invited`}
        </Text>
      </View>

      <NeonPanel color={SectionColors.gamecast} contentStyle={styles.gap}>
        <Text style={styles.heading}>🎥 Video call</Text>
        <Text style={styles.soft}>
          {nativeLoungeAvailable()
            ? 'Joins the call right here with your camera and mic. Tap Leave to come back.'
            : 'Opens in the in-app browser with your camera and mic. Tap Done to come back here.'}
        </Text>
        <Pressable onPress={joinVideo} disabled={opening} style={[styles.primary, { backgroundColor: accent }, opening && styles.disabled]}>
          {opening ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Join video</Text>}
        </Pressable>
      </NeonPanel>

      <NeonPanel color={SectionColors.chat} contentStyle={styles.gap}>
        <View style={styles.headRow}>
          <Text style={[styles.heading, styles.flex]}>💬 Room Chat</Text>
        </View>
        <Text style={styles.soft}>Talk while you watch, even without joining the call.</Text>
        <Pressable onPress={openChat} style={styles.secondary}>
          <Text style={styles.secondaryText}>Open chat</Text>
        </Pressable>
      </NeonPanel>

      <NeonPanel color={SectionColors.matchups} contentStyle={styles.gap}>
        <View style={styles.headRow}>
          <Text style={[styles.label, styles.flex]}>
            Sweating it out{digest ? ` — Week ${digest.week}` : ''}
          </Text>
          {!connected && <Text style={styles.small}>Connecting…</Text>}
        </View>
        {!digest || digest.matchups.length === 0 ? (
          <Text style={styles.muted}>No close matchups right now.</Text>
        ) : (
          digest.matchups.map((m) => (
            <View key={m.matchup_id} style={styles.matchup}>
              <Text style={styles.matchupText}>
                {m.home.owner_name} {m.home.score?.toFixed(1) ?? '—'} · {m.away.owner_name} {m.away.score?.toFixed(1) ?? '—'}
              </Text>
              {m.sweat.label && <Text style={styles.sweat}>{m.sweat.label}</Text>}
            </View>
          ))
        )}
      </NeonPanel>

      {room.kind === 'private' && room.created_by_owner_id === myOwnerId && (
        <Pressable
          onPress={() => router.push({ pathname: '/watch-party/manage/[id]', params: { id: String(room.id), name: room.name } })}
          style={styles.secondary}>
          <Text style={styles.secondaryText}>⚙ Manage party</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  gap: { gap: Spacing.md },
  gapSm: { gap: 4 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  lock: { fontSize: 18 },
  title: { flexShrink: 1, fontSize: 24, textTransform: 'none', letterSpacing: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heading: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  label: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  soft: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  primary: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minWidth: 130, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  secondary: { backgroundColor: Colors.surface, alignSelf: 'flex-start', borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  secondaryText: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  matchup: { borderRadius: Radius.md, backgroundColor: Colors.tileRaised, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  matchupText: { color: Colors.text, fontSize: 13 },
  sweat: { color: '#f87171', fontSize: 11, fontWeight: '600' },
});
