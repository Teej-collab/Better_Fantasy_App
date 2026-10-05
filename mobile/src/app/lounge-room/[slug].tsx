import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { nativeLoungeAvailable, partyIdFromSlug, takeLoungeTicket, type LoungeTicket } from '@/lib/loungeSession';
import { useWatchPartyRooms } from '@/lib/queries';
import { useWatchPartySocket } from '@/lib/watchPartySocket';

// The native video room, full screen — Watch Parties (League Lounge
// included, slug "party-<id>") and password Lounges. Only reachable in a
// build with LiveKit's native module (callers check
// nativeLoungeAvailable() first); the room component is required lazily
// so this route file is still safe to load in Expo Go.
export default function LoungeRoomScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const partyId = partyIdFromSlug(slug);
  const [ticket, setTicket] = useState<LoungeTicket | null>(() => takeLoungeTicket(slug));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ticket || !nativeLoungeAvailable()) return;
    // No token handed over (e.g. reopened directly) — your own room
    // lets you straight back in without the password.
    let cancelled = false;
    (partyId !== null ? api.watchPartyToken(partyId) : api.joinLounge(slug))
      .then((r) => {
        if (!cancelled) setTicket({ token: r.token, url: r.url, roomName: partyId !== null ? 'League Lounge' : 'Lounge', slug });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't join the lounge.");
      });
    return () => {
      cancelled = true;
    };
  }, [slug, ticket, partyId]);

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  if (!nativeLoungeAvailable() || error) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.error}>{error ?? 'Video calls need the full app build.'}</Text>
        <Pressable onPress={leave} style={styles.back}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!ticket) return <LoadingState />;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {partyId !== null ? (
        <PartyRoom roomId={partyId} ticket={ticket} onLeave={leave} />
      ) : (
        <Room ticket={ticket} party={null} tvGameId={null} delaySeconds={45} onLeave={leave} />
      )}
    </>
  );
}

/** A Watch Party: its chat is the league conversation, and the TV game
 *  and delay live on the room (changed by whoever's sharing, live). */
function PartyRoom({ roomId, ticket, onLeave }: { roomId: number; ticket: LoungeTicket; onLeave: () => void }) {
  const rooms = useWatchPartyRooms().data;
  const room = rooms ? [rooms.open_room, ...rooms.private_rooms].find((r) => r.id === roomId) : undefined;
  const { tv } = useWatchPartySocket(roomId, { gameId: room?.tv_game_id ?? null, delaySeconds: room?.tv_delay_seconds ?? 45 });
  if (!room) return <LoadingState />;
  return (
    <Room
      ticket={ticket}
      party={{ roomId, conversationId: room.conversation_id }}
      tvGameId={tv.gameId ?? room.tv_game_id ?? null}
      delaySeconds={tv.delaySeconds}
      onLeave={onLeave}
    />
  );
}

function Room({
  ticket,
  party,
  tvGameId,
  delaySeconds,
  onLeave,
}: {
  ticket: LoungeTicket;
  party: { roomId: number; conversationId: number } | null;
  tvGameId: string | null;
  delaySeconds: number;
  onLeave: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LeagueLoungeRoom } = require('@/components/lounge/LeagueLoungeRoom') as typeof import('@/components/lounge/LeagueLoungeRoom');
  return (
    <LeagueLoungeRoom
      token={ticket.token}
      url={ticket.url}
      roomName={ticket.roomName}
      party={party}
      tvGameId={tvGameId}
      delaySeconds={delaySeconds}
      onLeave={onLeave}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, backgroundColor: Colors.bg, padding: Spacing.xl },
  error: { color: Colors.text, fontSize: 15, textAlign: 'center' },
  back: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.pill, paddingHorizontal: 18, paddingVertical: 8 },
  backText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
});
